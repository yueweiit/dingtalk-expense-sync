import express, { Request, Response } from 'express';
import cors from 'cors';
import database, { pool } from './database.ts';
import logger from './logger.ts';
import config from './config.ts';
import { normalizeCurrencyToIso } from './fxToCny.ts';
import scheduler from './scheduler.ts';
import { resolveDepartmentQuery } from './department-query.ts';
import { summarizeConnectorDepartmentInputs } from './connector-department-input-diagnostics.ts';
import { resolveSharedBudgetDepartmentIds } from './shared-budget-departments.ts';
import { approvalExpenseTimeExpr, utcDateRange } from './utc-time.ts';
import { completedApprovedExpenseSql } from './completed-expense-policy.ts';

const app = express();
const PORT = config.server.port;
const AUTHORIZED_PAYMENT_EVENT_USER_SQL = config.dingtalk.paymentEventUserIds
  .map((userId) => `'${userId}'`)
  .join(', ');
const ELIGIBLE_PAYMENT_EVENT_SOURCE_SQL = `(
  (event.rule_version = 'authorized-comment-v1'
    AND event.source_type = 'comment_explicit_amount'
    AND event.source_user_id IN (${AUTHORIZED_PAYMENT_EVENT_USER_SQL}))
  OR (
    event.rule_version = 'manual-confirmed-v1'
    AND event.source_type = 'manual_confirmed'
  )
)`;

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

    if (departmentIdMode && deptMatch) {
      departmentIds = resolveSharedBudgetDepartmentIds(deptMatch, queryMonth);
    }

    const connectorInputDiagnostics = summarizeConnectorDepartmentInputs(
      req.query as Record<string, unknown>,
    );
    logger.info(
      `查询参数: department=${department}, departmentQueryMode=${departmentQuery?.mode || 'none'}, deptMatch=${deptMatch}, month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, date_field=${timeColumn}, expense_policy=authorized-payment-comment-or-completed-approval-fallback, received_query_keys=${connectorInputDiagnostics.receivedKeys.join('|')}, connector_department_inputs=${JSON.stringify(connectorInputDiagnostics.departmentInputs)}`
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
        NULLIF(TRIM(raw_data->>'originatorDeptName'), '')
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

    const eventTimeFilter = timeFilter.replace(/\bapproval_completed_at\b/g, 'event.paid_at');
    const splitTimeFilter = timeFilter.replace(/\bapproval_completed_at\b/g, 'o.approval_completed_at');
    const eventDepartmentExpr = departmentExpr
      .replace(/\bapplicant_department\b/g, 'o.applicant_department')
      .replace(/\bcreator_department\b/g, 'o.creator_department')
      .replace(/\braw_data\b/g, 'o.raw_data');
    const paymentEventWhere = `
      AND event.status = 'confirmed'
      AND ${ELIGIBLE_PAYMENT_EVENT_SOURCE_SQL}
    `;
    let factsSql: string;

    if (isOperation) {
      const splitDeptParam = `$${paramIndex++}`;
      const eventDeptParam = `$${paramIndex++}`;
      params.push(departmentIdMode ? departmentIds : deptMatch);
      params.push(departmentIdMode ? departmentIds : (deptCodeMode
        ? `(^|[^A-Z0-9])${deptMatch.toUpperCase()}([^A-Z0-9]|$)`
        : deptMatch));
      const splitDepartmentWhere = departmentIdMode
        ? `ds.department_id = ANY(${splitDeptParam}::varchar[])`
        : `LOWER(BTRIM(ds.department)) = LOWER(BTRIM(${splitDeptParam}))`;
      const eventDepartmentWhere = departmentIdMode
        ? `o.applicant_department_id = ANY(${eventDeptParam}::varchar[])`
        : deptCodeMode
          ? `UPPER(COALESCE(${eventDepartmentExpr}, '')) ~ ${eventDeptParam}`
          : `LOWER(BTRIM(COALESCE(${eventDepartmentExpr}, ''))) = LOWER(BTRIM(${eventDeptParam}))`;
      factsSql = `
        SELECT
          ds.business_id,
          SUM(ds.amount) AS base_currency_amount,
          o.approval_completed_at AS accounting_at,
          ds.department AS department_resolved,
          o.raw_data->>'title' AS title,
          'completed_department_split'::text AS accounting_source
        FROM approval_expense_dept_split ds
        JOIN approval_expense_operation o ON o.business_id = ds.business_id
        WHERE ${splitDepartmentWhere}
        ${statusWhere}
        ${splitTimeFilter}
        GROUP BY ds.business_id, o.approval_completed_at, ds.department, o.raw_data

        UNION ALL

        SELECT
          event.business_id,
          event.base_currency_amount,
          event.paid_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          o.raw_data->>'title' AS title,
          'payment_event'::text AS accounting_source
        FROM approval_expense_payment_events event
        JOIN approval_expense_operation o ON o.business_id = event.business_id
        WHERE ${eventDepartmentWhere}
        ${paymentEventWhere}
        ${eventTimeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_dept_split ds
          WHERE ds.business_id = event.business_id
        )

        UNION ALL

        SELECT
          o.business_id,
          o.base_currency_amount,
          o.approval_completed_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          o.raw_data->>'title' AS title,
          'completed_approval_fallback'::text AS accounting_source
        FROM approval_expense_operation o
        WHERE ${eventDepartmentWhere}
        ${statusWhere}
        ${splitTimeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_dept_split ds
          WHERE ds.business_id = o.business_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_payment_events event
          WHERE event.business_id = o.business_id
          ${paymentEventWhere}
        )
      `;
    } else {
      const eventDeptParam = `$${paramIndex++}`;
      params.push(departmentIdMode ? departmentIds : (deptCodeMode
        ? `(^|[^A-Z0-9])${deptMatch.toUpperCase()}([^A-Z0-9]|$)`
        : deptMatch));
      const eventDepartmentWhere = departmentIdMode
        ? `o.applicant_department_id = ANY(${eventDeptParam}::varchar[])`
        : deptCodeMode
          ? `UPPER(COALESCE(${eventDepartmentExpr}, '')) ~ ${eventDeptParam}`
          : `LOWER(BTRIM(COALESCE(${eventDepartmentExpr}, ''))) = LOWER(BTRIM(${eventDeptParam}))`;
      factsSql = `
        SELECT
          event.business_id,
          event.base_currency_amount,
          event.paid_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          o.raw_data->>'title' AS title,
          'payment_event'::text AS accounting_source
        FROM approval_expense_payment_events event
        JOIN approval_expense_purchase o ON o.business_id = event.business_id
        WHERE ${eventDepartmentWhere}
        ${paymentEventWhere}
        ${eventTimeFilter}

        UNION ALL

        SELECT
          o.business_id,
          o.base_currency_amount,
          o.approval_completed_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          o.raw_data->>'title' AS title,
          'completed_approval_fallback'::text AS accounting_source
        FROM approval_expense_purchase o
        WHERE ${eventDepartmentWhere}
        ${statusWhere}
        ${splitTimeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_payment_events event
          WHERE event.business_id = o.business_id
          ${paymentEventWhere}
        )
      `;
    }

    const query = isDebug
      ? `SELECT * FROM (${factsSql}) actual ORDER BY accounting_at DESC`
      : `SELECT COALESCE(SUM(COALESCE(base_currency_amount, 0)), 0)::text AS total, COUNT(*)::int AS count FROM (${factsSql}) actual`;

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
            sourceTable: 'approval_expense_payment_events + completed approvals',
            timeColumn: 'paid_at / approval_completed_at',
            monthParsed: month ? parseMonthBucket(month) : null,
            expensePolicy: 'authorized-payment-comment-or-completed-approval-fallback'
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
          sourceTable: 'approval_expense_payment_events + completed approvals',
          timeColumn: 'paid_at / approval_completed_at',
          monthParsed: month ? parseMonthBucket(month) : null,
          expensePolicy: 'authorized-payment-comment-or-completed-approval-fallback'
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
      `全部门查询: month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, start_date=${start_date}, end_date=${end_date}, expense_policy=authorized-payment-comment-or-completed-approval-fallback`
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

    const eventTimeFilter = timeFilter.replace(/\bapproval_completed_at\b/g, 'event.paid_at');
    const splitTimeFilter = timeFilter.replace(/\bapproval_completed_at\b/g, 'o.approval_completed_at');
    const paymentEventWhere = `
      AND event.status = 'confirmed'
      AND ${ELIGIBLE_PAYMENT_EVENT_SOURCE_SQL}
    `;
    const factsSql = isOperation
      ? `
        SELECT
          ds.business_id,
          SUM(ds.amount) AS base_currency_amount,
          o.approval_completed_at AS accounting_at,
          ds.department AS department_resolved,
          'completed_department_split'::text AS accounting_source
        FROM approval_expense_dept_split ds
        JOIN approval_expense_operation o ON o.business_id = ds.business_id
        WHERE 1=1
        ${buildStatusFiltersForAlias('o')}
        ${splitTimeFilter}
        GROUP BY ds.business_id, o.approval_completed_at, ds.department

        UNION ALL

        SELECT
          event.business_id,
          event.base_currency_amount,
          event.paid_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          'payment_event'::text AS accounting_source
        FROM approval_expense_payment_events event
        JOIN approval_expense_operation o ON o.business_id = event.business_id
        WHERE NOT EXISTS (
          SELECT 1 FROM approval_expense_dept_split ds
          WHERE ds.business_id = event.business_id
        )
        ${paymentEventWhere}
        ${eventTimeFilter}

        UNION ALL

        SELECT
          o.business_id,
          o.base_currency_amount,
          o.approval_completed_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          'completed_approval_fallback'::text AS accounting_source
        FROM approval_expense_operation o
        WHERE 1=1
        ${buildStatusFiltersForAlias('o')}
        ${splitTimeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_dept_split ds
          WHERE ds.business_id = o.business_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_payment_events event
          WHERE event.business_id = o.business_id
          ${paymentEventWhere}
        )
      `
      : `
        SELECT
          event.business_id,
          event.base_currency_amount,
          event.paid_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          'payment_event'::text AS accounting_source
        FROM approval_expense_payment_events event
        JOIN approval_expense_purchase o ON o.business_id = event.business_id
        WHERE 1=1
        ${paymentEventWhere}
        ${eventTimeFilter}

        UNION ALL

        SELECT
          o.business_id,
          o.base_currency_amount,
          o.approval_completed_at AS accounting_at,
          COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS department_resolved,
          'completed_approval_fallback'::text AS accounting_source
        FROM approval_expense_purchase o
        WHERE 1=1
        ${buildStatusFiltersForAlias('o')}
        ${splitTimeFilter}
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_payment_events event
          WHERE event.business_id = o.business_id
          ${paymentEventWhere}
        )
      `;
    const actualClient = await pool.connect();
    try {
      const query = isDebug
        ? `SELECT * FROM (${factsSql}) actual ORDER BY accounting_at DESC`
        : `SELECT COALESCE(SUM(COALESCE(base_currency_amount, 0)), 0)::text AS total, COUNT(*)::int AS count FROM (${factsSql}) actual`;
      const result = await actualClient.query(query, params);
      const row = result.rows[0] || { total: '0', count: 0 };
      const payload: Record<string, unknown> = isDebug
        ? {
          total: result.rows.reduce((sum: number, item: Record<string, unknown>) => sum + Number(item.base_currency_amount || 0), 0).toFixed(2),
          count: result.rows.length,
          items: result.rows,
        }
        : {
          total: Number.parseFloat(row.total || 0).toFixed(2),
          count: Number(row.count || 0),
        };
      if (isOperation && !isDebug) {
        const breakdownResult = await actualClient.query(`
          SELECT department_resolved AS dept, COALESCE(SUM(base_currency_amount), 0)::text AS total
          FROM (${factsSql}) actual
          GROUP BY department_resolved
          ORDER BY SUM(base_currency_amount) DESC
        `, params);
        payload.breakdown = Object.fromEntries(
          breakdownResult.rows.map((item: { dept: string; total: string }) => [
            String(item.dept || 'Unknown'),
            Number.parseFloat(String(item.total || 0)).toFixed(2),
          ])
        );
      }
      if (wantEcho) {
        payload.resolved = {
          deptMatch: '(all)',
          deptMatchMode: 'all',
          sourceTable: 'approval_expense_payment_events + completed approvals',
          timeColumn: 'paid_at / approval_completed_at',
          monthParsed: month ? parseMonthBucket(month) : null,
          expensePolicy: 'authorized-payment-comment-or-completed-approval-fallback',
        };
        payload.receivedQuery = req.query;
      }
      res.json(payload);
      return;
    } finally {
      actualClient.release();
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
