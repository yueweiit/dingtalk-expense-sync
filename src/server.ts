import express, { Request, Response } from 'express';
import cors from 'cors';
import database, { pool } from './database.ts';
import logger from './logger.ts';
import config from './config.ts';
import { normalizeCurrencyToIso } from './fxToCny.ts';
import scheduler from './scheduler.ts';
import { resolveDepartmentQuery } from './department-query.ts';
import { getConnectorOriginator, resolveOriginatorDepartment } from './connector-originator-department.ts';
import { resolveSharedBudgetDepartmentIds } from './shared-budget-departments.ts';
import { approvalExpenseTimeExpr, utcDateRange } from './utc-time.ts';
import { completedApprovedExpenseSql } from './completed-expense-policy.ts';

const app = express();
const PORT = config.server.port;

app.use(cors());
app.use(express.json());

interface MonthBucket {
  year: string;
  monthNum: number;
}

/** 支持 month=2026-04、2026-04-30、2026-4 等 */
function parseMonthBucket(monthStr: unknown): MonthBucket | null {
  if (!monthStr || typeof monthStr !== 'string') {
    return null;
  }
  const trimmed = monthStr.trim();
  const m = trimmed.match(/^(\d{4})-(\d{1,2})(?:\b|$)/);
  if (!m) {
    return null;
  }
  const year = m[1];
  const monthNum = Number.parseInt(m[2], 10);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return null;
  }
  return { year, monthNum };
}

function parseRateDate(value: unknown): string | false | null {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const d = new Date(`${text}T00:00:00+08:00`);
  return Number.isFinite(d.getTime()) ? text : false;
}

function isDeptCodeLike(value: string | null): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  // 短英文代码（如 IT/FC/OBG/PG2/PD）按代码模式处理，避免 ILIKE '%it%' 误命中。
  return /^[A-Za-z][A-Za-z0-9]{0,5}$/.test(trimmed);
}

// 通用查询逻辑
function inferExpenseKind(value: unknown): string | null {
  const text = String(value || '').toLowerCase();
  if (text === 'operation' || text.includes('operation') || text.includes('运营') || text.includes('杩愯惀')) {
    return 'operation';
  }
  if (text === 'purchase' || text.includes('purchase') || text.includes('采购') || text.includes('閲囪喘')) {
    return 'purchase';
  }
  return null;
}

interface ExpenseQueryConfig {
  processKind: string;
  tableName: string;
  sourceAmountColumn: string;
  amountRmbExpr: string;
}

/** 为 UNION ALL 的 joined 部分生成带表别名前缀的状态过滤 SQL */
function buildStatusFiltersForAlias(
  tableAlias: string,
): string {
  return ` AND ${completedApprovedExpenseSql(tableAlias)}`;
}

/** 为 UNION ALL 的 joined 部分生成带表别名前缀的时间过滤 SQL */
function buildTimeFilterForAlias(
  tableAlias: string,
  timeFilter: string,
): string {
  if (!timeFilter) return '';
  const a = tableAlias;
  return timeFilter
    .replace(/\bsource_created_at\b/g, `${a}.source_created_at`)
    .replace(/\brequest_date\b/g, `${a}.request_date`)
    .replace(/\bapproval_completed_at\b/g, `${a}.approval_completed_at`);
}

function getExpenseQueryConfig(processKind: string): ExpenseQueryConfig {
  if (processKind === 'purchase') {
    return {
      processKind,
      tableName: 'approval_expense_purchase',
      sourceAmountColumn: 'detail_summary_amount',
      amountRmbExpr: 'COALESCE(base_currency_amount, 0)'
    };
  }

  return {
    processKind: 'operation',
    tableName: 'approval_expense_operation',
    sourceAmountColumn: 'amount',
    amountRmbExpr: 'COALESCE(base_currency_amount, 0)'
  };
}

async function queryApproved(req: Request, res: Response, processKind: string): Promise<void> {
  try {
    const {
      department,
      start_date,
      end_date,
      month: providedMonth,
      debug,
      date_field,
      echo
    } = req.query;

    // DingTalk connector parameter names can be fixed as Chinese labels.
    const month = providedMonth || req.query['\u65f6\u95f4'];

    const queryConfig = getExpenseQueryConfig(processKind);
    const timeColumn = approvalExpenseTimeExpr();

    let departmentQuery = resolveDepartmentQuery(req.query as Record<string, unknown>);
    let deptMatch = departmentQuery?.value || null;
    let departmentIdMode = departmentQuery?.mode === 'id';
    let departmentIds: string[] | null = departmentIdMode && deptMatch ? [deptMatch] : null;
    const monthBucket = parseMonthBucket(month);
    const queryMonth = monthBucket
      ? `${monthBucket.year}-${String(monthBucket.monthNum).padStart(2, '0')}`
      : '';

    if (departmentQuery?.mode === 'name') {
      const originator = getConnectorOriginator(req.query as Record<string, unknown>);
      if (originator.userId || originator.name) {
        const resolution = await resolveOriginatorDepartment({
          originatorUserId: originator.userId,
          originatorName: originator.name,
          departmentName: departmentQuery.value,
          sharedBudgetMonth: queryMonth,
        });
        if (resolution.status !== 'resolved') {
          logger.warn('Connector department resolution failed', {
            queryKeys: Object.keys(req.query),
            department: departmentQuery.value,
            originator,
            resolution: resolution.status,
            candidateCount: resolution.status === 'ambiguous' ? resolution.candidates.length : 0,
          });
          res.status(422).json({
            error: resolution.status === 'ambiguous'
              ? '部门归属不唯一，请检查提交人和部门配置'
              : '未找到提交人与部门的对应关系，请检查组织架构同步',
          });
          return;
        }
        departmentQuery = { mode: 'id', value: resolution.departmentId };
        deptMatch = resolution.departmentId;
        departmentIdMode = true;
        departmentIds = [resolution.departmentId];
      }
    }

    if (departmentIdMode && deptMatch) {
      departmentIds = resolveSharedBudgetDepartmentIds(deptMatch, queryMonth);
    }

    logger.info(
      `查询参数: department=${department}, departmentQueryMode=${departmentQuery?.mode || 'none'}, deptMatch=${deptMatch}, month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, date_field=${timeColumn}, expense_policy=completed-approved`
    );

    const wantEcho = String(echo || '') === '1';

    if (!deptMatch) {
      const payload: Record<string, unknown> = { total: '0.00', count: 0, hint: '部门无法识别：请传 code/dept_code 或 department' };
      if (wantEcho) {
        payload.receivedQuery = req.query;
      }
      res.json(payload);
      return;
    }

    const isDebug = String(debug || '') === '1';
    const departmentExpr = `
      COALESCE(
        NULLIF(TRIM(applicant_department), ''),
        NULLIF(TRIM(creator_department), ''),
        NULLIF(TRIM(raw_data->>'originatorDeptName'), ''),
        (
          SELECT NULLIF(TRIM(fc->>'value'), '')
          FROM jsonb_array_elements(COALESCE(raw_data->'formComponentValues', '[]'::jsonb)) AS fc
          WHERE LOWER(COALESCE(fc->>'componentType', '')) = 'departmentfield'
            OR COALESCE(fc->>'name', '') LIKE '部门%'
            OR COALESCE(fc->>'name', '') ILIKE '%Departamento%'
          LIMIT 1
        )
      )
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    const isOperation = queryConfig.processKind === 'operation';
    const deptCodeMode = departmentQuery?.mode === 'code' && isDeptCodeLike(deptMatch);

    // 状态过滤（通用）
    const statusWhere = `      AND ${completedApprovedExpenseSql('o')}`;

    // 时间过滤
    let timeFilter = '';
    if (month) {
      const bucket = parseMonthBucket(month);
      if (!bucket) {
        const payload: Record<string, unknown> = {
          total: '0.00', count: 0,
          hint: 'month 格式无效，请用 2026-04 或 2026-04-30（仅需年月）'
        };
        if (wantEcho) payload.receivedQuery = req.query;
        res.json(payload);
        return;
      }
      const { year, monthNum } = bucket;
      const startOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(Number(year), monthNum, 0).getDate();
      const endOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;
      const range = utcDateRange(startOfMonth, endOfMonth);
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.start, range.endExclusive);
    } else if (start_date && end_date) {
      const range = utcDateRange(String(start_date), String(end_date));
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.start, range.endExclusive);
    } else if (start_date) {
      const range = utcDateRange(String(start_date));
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz`;
      params.push(range.start);
    } else if (end_date) {
      const range = utcDateRange(String(end_date), String(end_date));
      timeFilter = ` AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.endExclusive);
    }

    let query: string;

    if (isOperation) {
      // 运营支出：通过 split 表处理部门拆分。部门 ID 存在时必须精确匹配，避免同名部门串账。
      const splitDeptParam = `$${paramIndex++}`;
      params.push(departmentIdMode ? departmentIds : deptMatch);
      const splitDepartmentWhere = departmentIdMode
        ? `ds.department_id = ANY(${splitDeptParam}::varchar[])`
        : `LOWER(BTRIM(ds.department)) = LOWER(BTRIM(${splitDeptParam}))`;
      const directDepartmentWhere = departmentIdMode
        ? `o.applicant_department_id = ANY($${paramIndex++}::varchar[])`
        : `LOWER(BTRIM(COALESCE(${departmentExpr}, ''))) = LOWER(BTRIM($${paramIndex++}))`;

      if (isDebug) {
        query = `
          SELECT o.business_id,
                 o.amount,
                 o.base_currency_amount,
                 o.approval_completed_at,
                 o.source_created_at,
                 o.request_date,
                 o.applicant_department,
                 o.creator_department,
                 o.approval_status,
                 o.raw_data->>'bizAction' AS biz_action,
                 o.raw_data->>'title' AS title,
                 ${departmentExpr} AS department_resolved
          FROM ${queryConfig.tableName} o
          LEFT JOIN (
            SELECT ds.business_id, SUM(ds.amount) AS split_total
            FROM approval_expense_dept_split ds
            JOIN ${queryConfig.tableName} o2 ON o2.business_id = ds.business_id
            WHERE ${splitDepartmentWhere}
            ${statusWhere.replace(/\bo\./g, 'o2.')}
            ${timeFilter.replace(/\bo\./g, 'o2.')}
            GROUP BY ds.business_id
          ) ds ON ds.business_id = o.business_id
          WHERE (
            (ds.business_id IS NULL AND ${directDepartmentWhere})
            OR ds.business_id IS NOT NULL
          )
          ${statusWhere}
          ${timeFilter}
          ORDER BY ${timeColumn} DESC
        `;
        params.push(departmentIdMode ? departmentIds : deptMatch);
      } else {
        query = `
          SELECT COALESCE(SUM(COALESCE(ds.split_total, o.base_currency_amount)), 0)::text AS total, COUNT(*)::int AS count
          FROM ${queryConfig.tableName} o
          LEFT JOIN (
            SELECT ds.business_id, SUM(ds.amount) AS split_total
            FROM approval_expense_dept_split ds
            JOIN ${queryConfig.tableName} o2 ON o2.business_id = ds.business_id
            WHERE ${splitDepartmentWhere}
            ${statusWhere.replace(/\bo\./g, 'o2.')}
            ${timeFilter.replace(/\bo\./g, 'o2.')}
            GROUP BY ds.business_id
          ) ds ON ds.business_id = o.business_id
          WHERE (
            (ds.business_id IS NULL AND ${directDepartmentWhere})
            OR ds.business_id IS NOT NULL
          )
          ${statusWhere}
          ${timeFilter}
        `;
        params.push(departmentIdMode ? departmentIds : deptMatch);
      }
    } else {
      // 采购支出：不涉及拆分，直接查询
      const nonSplitDeptParam = `$${paramIndex++}`;
      if (departmentIdMode) {
        params.push(departmentIds);
      } else if (deptCodeMode) {
        params.push(`(^|[^A-Z0-9])${deptMatch.toUpperCase()}([^A-Z0-9]|$)`);
      } else {
        params.push(deptMatch);
      }

      if (isDebug) {
        query = `
          SELECT o.business_id,
                 ${queryConfig.sourceAmountColumn} AS amount,
                 o.base_currency_amount,
                 o.approval_completed_at,
                 o.source_created_at,
                 o.request_date,
                 o.applicant_department,
                 o.creator_department,
                 o.approval_status,
                 o.raw_data->>'bizAction' AS biz_action,
                 o.raw_data->>'title' AS title,
                 ${departmentExpr} AS department_resolved
          FROM ${queryConfig.tableName} o
          WHERE 1=1
          ${statusWhere}
          ${timeFilter}
        `;
      } else {
        query = `
          SELECT COALESCE(SUM(${queryConfig.amountRmbExpr}), 0)::text AS total, COUNT(*)::int AS count
          FROM ${queryConfig.tableName} o
          WHERE 1=1
          ${statusWhere}
          ${timeFilter}
        `;
      }

      if (departmentIdMode) {
        query += ` AND o.applicant_department_id = ANY(${nonSplitDeptParam}::varchar[])`;
      } else if (deptCodeMode) {
        query += ` AND UPPER(COALESCE(${departmentExpr}, '')) ~ ${nonSplitDeptParam}`;
      } else {
        query += ` AND LOWER(BTRIM(COALESCE(${departmentExpr}, ''))) = LOWER(BTRIM(${nonSplitDeptParam}))`;
      }
    }

    const client = await pool.connect();
    try {
      if (!isDebug) {
        const result = await client.query(query, params);
        const row = result.rows[0] || { total: '0', count: 0 };
        const payload: Record<string, unknown> = {
          total: Number.parseFloat(row.total || 0).toFixed(2),
          count: Number(row.count || 0)
        };
        if (wantEcho) {
          payload.resolved = {
            deptMatch,
            deptMatchMode: departmentIdMode ? 'id-exact' : (deptCodeMode ? 'code-token' : 'name-exact'),
            departmentIds: departmentIdMode ? departmentIds : null,
            sourceTable: queryConfig.tableName,
            timeColumn,
            monthParsed: month ? parseMonthBucket(month) : null,
            expensePolicy: 'completed-approved'
          };
          payload.receivedQuery = req.query;
        }
        res.json(payload);
        return;
      }

      const result = await client.query(query, params);
      const rows = result.rows || [];
      const total = rows.reduce((sum: number, r: Record<string, unknown>) => {
        return sum + Number(r.base_currency_amount || 0);
      }, 0);
      const payload: Record<string, unknown> = {
        total: total.toFixed(2),
        count: rows.length,
        items: rows
      };
      if (wantEcho) {
        payload.resolved = {
          deptMatch,
          deptMatchMode: departmentIdMode ? 'id-exact' : (deptCodeMode ? 'code-token' : 'name-exact'),
          departmentIds: departmentIdMode ? departmentIds : null,
          sourceTable: queryConfig.tableName,
          timeColumn,
          monthParsed: month ? parseMonthBucket(month) : null,
          expensePolicy: 'completed-approved'
        };
        payload.receivedQuery = req.query;
      }
      res.json(payload);
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`查询失败: ${message}`);
    res.status(500).json({ total: '0', error: message });
  }
}

// 查询全部门数据（不传 department）
async function queryApprovedAll(req: Request, res: Response, processKind: string): Promise<void> {
  try {
    const {
      start_date,
      end_date,
      month,
      debug,
      echo
    } = req.query;

    const queryConfig = getExpenseQueryConfig(processKind);
    const timeColumn = approvalExpenseTimeExpr();

    logger.info(
      `全部门查询: month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, start_date=${start_date}, end_date=${end_date}, expense_policy=completed-approved`
    );

    const wantEcho = String(echo || '') === '1';
    const isDebug = String(debug || '') === '1';
    const isOperation = queryConfig.processKind === 'operation';

    // 状态过滤
    const statusWhere = `      AND ${completedApprovedExpenseSql()}`;

    const params: unknown[] = [];
    let paramIndex = 1;

    // 时间过滤
    let timeFilter = '';
    if (month) {
      const bucket = parseMonthBucket(month);
      if (!bucket) {
        const payload: Record<string, unknown> = {
          total: '0.00', count: 0,
          hint: 'month 格式无效，请用 2026-04 或 2026-04-30（仅需年月）'
        };
        if (wantEcho) payload.receivedQuery = req.query;
        res.json(payload);
        return;
      }
      const { year, monthNum } = bucket;
      const startOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(Number(year), monthNum, 0).getDate();
      const endOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;
      const range = utcDateRange(startOfMonth, endOfMonth);
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.start, range.endExclusive);
    } else if (start_date && end_date) {
      const range = utcDateRange(String(start_date), String(end_date));
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.start, range.endExclusive);
    } else if (start_date) {
      const range = utcDateRange(String(start_date));
      timeFilter = ` AND ${timeColumn} >= $${paramIndex++}::timestamptz`;
      params.push(range.start);
    } else if (end_date) {
      const range = utcDateRange(String(end_date), String(end_date));
      timeFilter = ` AND ${timeColumn} < $${paramIndex++}::timestamptz`;
      params.push(range.endExclusive);
    }

    // 总额查询：直接 SUM(base_currency_amount)
    let query: string;
    if (isDebug) {
      query = `
        SELECT business_id,
               ${queryConfig.sourceAmountColumn} AS amount,
               base_currency_amount,
               approval_completed_at,
               source_created_at,
               request_date,
               applicant_department,
               creator_department,
               approval_status,
               raw_data->>'bizAction' AS biz_action,
               raw_data->>'title' AS title
        FROM ${queryConfig.tableName}
        WHERE 1=1
        ${statusWhere}
        ${timeFilter}
        ORDER BY ${timeColumn} DESC
      `;
    } else {
      query = `
        SELECT COALESCE(SUM(COALESCE(base_currency_amount, 0)), 0)::text AS total, COUNT(*)::int AS count
        FROM ${queryConfig.tableName}
        WHERE 1=1
        ${statusWhere}
        ${timeFilter}
      `;
    }

    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      const row = result.rows[0] || { total: '0', count: 0 };
      const payload: Record<string, unknown> = {
        total: Number.parseFloat(row.total || 0).toFixed(2),
        count: Number(row.count || 0)
      };

      // 运营支出：按部门 breakdown（UNION ALL 非拆分 + 拆分）
      if (isOperation && !isDebug) {
        const breakdownSql = `
          SELECT dept, COALESCE(SUM(amount), 0)::text AS total
          FROM (
            SELECT
              COALESCE(NULLIF(TRIM(applicant_department), ''), 'Unknown') AS dept,
              COALESCE(base_currency_amount, 0) AS amount
            FROM ${queryConfig.tableName}
            WHERE NOT EXISTS (
              SELECT 1 FROM approval_expense_dept_split ds
              WHERE ds.business_id = ${queryConfig.tableName}.business_id
            )
            ${statusWhere}
            ${timeFilter}

            UNION ALL

            SELECT
              ds.department AS dept,
              ds.amount
            FROM approval_expense_dept_split ds
            JOIN ${queryConfig.tableName} o ON o.business_id = ds.business_id
            WHERE 1=1
            ${buildStatusFiltersForAlias('o')}
            ${buildTimeFilterForAlias('o', timeFilter)}
          ) combined
          GROUP BY dept
          ORDER BY SUM(amount) DESC
        `;
        const breakdownResult = await client.query(breakdownSql, params);
        payload.breakdown = Object.fromEntries(
          breakdownResult.rows.map((r: { dept: string; total: string }) => [
            String(r.dept || 'Unknown'),
            Number.parseFloat(String(r.total || 0)).toFixed(2)
          ])
        );
      } else if (isDebug) {
        payload.items = result.rows;
      }

      if (wantEcho) {
        payload.resolved = {
          deptMatch: '(all)',
          deptMatchMode: 'all',
          sourceTable: queryConfig.tableName,
          timeColumn,
          monthParsed: month ? parseMonthBucket(month) : null,
          expensePolicy: 'completed-approved'
        };
        payload.receivedQuery = req.query;
      }
      res.json(payload);
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`全部门查询失败: ${message}`);
    res.status(500).json({ total: '0', error: message });
  }
}

// 运营支出已提交审批统计（排除撤销、拒绝）
app.get('/api/approvals/approved/operation', async (req: Request, res: Response) => {
  await queryApproved(req, res, 'operation');
});

// 采购支出已提交审批统计（排除撤销、拒绝）
app.get('/api/approvals/approved/purchase', async (req: Request, res: Response) => {
  await queryApproved(req, res, 'purchase');
});

// 运营支出全部门查询（不传 department，只传 start_date + end_date）
app.get('/api/approvals/approved/operation/all', async (req: Request, res: Response) => {
  await queryApprovedAll(req, res, 'operation');
});

// 采购支出全部门查询（不传 department，只传 start_date + end_date）
app.get('/api/approvals/approved/purchase/all', async (req: Request, res: Response) => {
  await queryApprovedAll(req, res, 'purchase');
});

// 保留原有接口（同时支持运营和采购）
app.get('/api/approvals/approved', async (req: Request, res: Response) => {
  const { process_type } = req.query;
  const processKind = inferExpenseKind(process_type);
  if (processKind) {
    await queryApproved(req, res, processKind);
  } else {
    res.json({ total: '0.00', count: 0, error: '请通过 /operation 或 /purchase 查询' });
  }
});

// 健康检查
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 手动触发运营/采购支出同步，并立即补偿已入库但状态可能变化的记录
app.post('/api/sync/manual', async (req: Request, res: Response) => {
  const startedAt = new Date().toISOString();
  const runCompensation = req.body?.compensate !== false;

  try {
    await scheduler.manualSync();
    if (runCompensation) {
      await scheduler.compensatePendingApprovals();
    }

    res.json({
      success: true,
      startedAt,
      completedAt: new Date().toISOString(),
      compensation: runCompensation,
      message: runCompensation ? '支出同步和状态补偿已完成' : '支出同步已完成',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`手动触发支出同步失败: ${message}`);
    res.status(500).json({
      success: false,
      message,
    });
  }
});

// 按窗口同步运营支出部门拆分：工资、社保公积金、办公场地
app.post('/api/sync/operation-splits', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, splitTypes } = req.body || {};
    if (startTime === undefined || endTime === undefined) {
      res.status(400).json({
        success: false,
        message: 'startTime 和 endTime 必填',
      });
      return;
    }

    const result = await scheduler.syncOperationSplits({ startTime, endTime, splitTypes });
    res.json({
      ...result,
      message: `支出拆分同步完成：匹配 ${result.matched}，写入 ${result.written}，跳过 ${result.skipped}，失败 ${result.failed}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`手动触发运营支出拆分同步失败: ${message}`);
    res.status(500).json({
      success: false,
      message,
    });
  }
});

// 手动触发预算周报
app.post('/api/reports/weekly-budget', async (req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const reportSecret = process.env.REPORT_SECRET;

  if (isProduction) {
    if (!reportSecret) {
      res.status(403).json({ error: 'forbidden', message: '生产环境未配置 REPORT_SECRET，禁止访问' });
      return;
    }
    const providedSecret = req.headers['x-report-secret'];
    if (providedSecret !== reportSecret) {
      res.status(403).json({ error: 'forbidden', message: 'X-Report-Secret 不匹配' });
      return;
    }
  }

  try {
    // Fire and return immediately — the report runs in the background
    void scheduler.sendWeeklyReport();
    res.json({ status: 'accepted', message: '预算周报任务已触发，请查看日志' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`手动触发周报失败: ${message}`);
    res.status(500).json({ error: 'trigger_failed', message });
  }
});

// 启动服务器（启动前确保日汇率表存在，便于只跑 HTTP 的环境）
app.get('/api/fx-rate', async (req: Request, res: Response) => {
  try {
    const label = (req.query.currency || req.query.name || req.query.currency_name || 'CNY').toString().trim() || 'CNY';

    const iso = normalizeCurrencyToIso(label);
    if (!iso) {
      res.status(400).json({
        error: 'unknown_currency',
        currency: label,
        message: '无法识别货币名称'
      });
      return;
    }

    const rateDate = parseRateDate(req.query.date);
    if (rateDate === false) {
      res.status(400).json({
        error: 'invalid_date',
        message: 'date 格式应为 YYYY-MM-DD'
      });
      return;
    }

    if (iso === 'CNY') {
      res.json({
        currency: label,
        isoCurrency: iso,
        targetCurrency: 'CNY',
        rateToCny: 1,
        rateText: '1 CNY = 1 CNY',
        requestedDate: rateDate,
        rateDate: rateDate,
        cnyPerUnit: 1,
        usdPerUnit: null,
        usdCny: null,
        sourceUrl: 'builtin:CNY',
        fetchedAt: null
      });
      return;
    }

    await database.ensureFxRatesDailyTable();
    const rate = await database.getLatestFxRate(iso, rateDate);
    if (!rate) {
      res.status(404).json({
        error: 'rate_not_found',
        currency: label,
        isoCurrency: iso,
        date: rateDate,
        message: '数据库中没有对应汇率'
      });
      return;
    }

    res.json({
      currency: label,
      isoCurrency: iso,
      targetCurrency: 'CNY',
      rateToCny: rate.cny_per_unit,
      rateText: `1 ${iso} = ${rate.cny_per_unit} CNY`,
      requestedDate: rateDate,
      rateDate: rate.rate_date,
      cnyPerUnit: rate.cny_per_unit,
      usdPerUnit: rate.usd_per_unit,
      usdCny: rate.usd_cny,
      sourceUrl: rate.source_url,
      fetchedAt: rate.fetched_at
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`查询汇率失败: ${message}`);
    res.status(500).json({ error: 'query_fx_rate_failed', message });
  }
});

async function startServer(): Promise<void> {
  try {
    await database.ensureApprovalExpenseSchema();
    logger.info('已确保 approval_expense_* 表存在');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`ensure approval_expense_* 失败: ${message}`);
  }
  try {
    await database.ensureFxRatesDailyTable();
    logger.info('已确保 fx_rates_daily 表存在');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`ensure fx_rates_daily 失败: ${message}`);
  }
  app.listen(PORT, () => {
    logger.info(`HTTP服务已启动，端口: ${PORT}`);
  });
}

export { app, startServer };
