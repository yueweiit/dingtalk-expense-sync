import express, { Request, Response } from 'express';
import cors from 'cors';
import database, { pool } from './database.js';
import logger from './logger.js';
import config from './config.js';
import { normalizeCurrencyToIso } from './fxToCny.js';

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

/**
 * 部门解析：优先 code/dept_code（精确匹配），否则使用 department 文本匹配。
 * 允许任意部门，不再限制固定白名单。
 */
function resolveDeptMatch(req: Request): string | null {
  const { department, dept_code, code } = req.query;
  const codeRaw = (dept_code || code || '').toString().trim();
  if (codeRaw) {
    return codeRaw;
  }
  if (!department || typeof department !== 'string') {
    return null;
  }
  let deptRaw = department.trim();
  // 常见情况：前面会带公司/组织前缀，数据库里可能只存后半段（如 "YW Tech_Ai"）。
  // 例如 "悦为智能 YW Tech_Ai" => 优先匹配 "YW Tech_Ai"。
  const parts = deptRaw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    deptRaw = parts.slice(1).join(' ');
  }
  return deptRaw || null;
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
      month,
      debug,
      date_field,
      echo,
      flow_status,
      include_revoked
    } = req.query;

    const queryConfig = getExpenseQueryConfig(processKind);
    const timeColumn = 'COALESCE(source_created_at, request_date::timestamp)';

    /** 默认排除钉钉 biz_action 为撤销类（仍可能被标成流程完结）的单据 */
    const allowRevokedBiz = String(include_revoked || '').toLowerCase() === '1';

    /** 默认统计所有流程状态；如需只看归档完结，可传 flow_status=completed */
    const flowStatusCompletedOnly = String(flow_status || '').toLowerCase() === 'completed';

    const deptMatch = resolveDeptMatch(req);

    logger.info(
      `查询参数: department=${department}, deptMatch=${deptMatch}, month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, date_field=${timeColumn}, flow_status=${flowStatusCompletedOnly ? 'COMPLETED-only' : 'all'}, exclude_revoked_biz=${!allowRevokedBiz}`
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

    /** 统计口径：优先本位币人民币；运营「工资中国」按 salary_by_department 拆到匹配部门 */
    const isOperation = queryConfig.processKind === 'operation';
    const isSalaryChinaExpr = `(operation_expense ILIKE '%工资中国%' OR operation_expense ILIKE '%Salario en China%')`;
    const salaryDeptMatchParam = isOperation ? paramIndex++ : null;
    if (isOperation) {
      params.push(deptMatch);
    }
    const amountRmbExpr = isOperation
      ? `
        CASE
          WHEN ${isSalaryChinaExpr}
          THEN COALESCE(
            (
              SELECT SUM((entry->>'amount')::numeric)
              FROM jsonb_array_elements(COALESCE(salary_by_department, '[]'::jsonb)) AS entry
              WHERE entry->>'department' ILIKE '%' || $${salaryDeptMatchParam} || '%'
            ),
            0
          )
          ELSE COALESCE(base_currency_amount, 0)
        END
      `
      : queryConfig.amountRmbExpr;

    let query = isDebug
      ? `
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
             raw_data->>'title' AS title,
             ${departmentExpr} AS department_resolved
      FROM ${queryConfig.tableName}
      WHERE 1=1
    `
      : `
      SELECT COALESCE(SUM(${amountRmbExpr}), 0)::text AS total, COUNT(*)::int AS count
      FROM ${queryConfig.tableName}
      WHERE 1=1
    `;

    if (flowStatusCompletedOnly) {
      query += ` AND approval_status = 'COMPLETED'`;
    }

    query += ` AND UPPER(COALESCE(NULLIF(TRIM(approval_status), ''), NULLIF(TRIM(raw_data->>'status'), ''), 'NONE')) NOT IN ('TERMINATED', 'CANCELED', 'CANCELLED')`;

    if (!allowRevokedBiz) {
      query += ` AND UPPER(COALESCE(NULLIF(TRIM(raw_data->>'bizAction'), ''), NULLIF(TRIM(raw_data->>'biz_action'), ''), 'NONE')) NOT IN ('REVOKE', 'DELETE', 'TERMINATE', 'CANCEL', 'CANCELED', 'CANCELLED')`;
    }

    // 只要任意人工节点出现拒绝（REFUSE/REJECT），整单不应计入"已通过"
    query += `
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(raw_data->'tasks', '[]'::jsonb)) AS t
        WHERE UPPER(COALESCE(t->>'result', '')) IN ('REFUSE', 'REJECT')
      )
    `;
    query += ` AND UPPER(COALESCE(raw_data->>'flowResult', raw_data->>'result', '')) NOT IN ('REFUSE', 'REJECT')`;

    const deptCodeMode = isDeptCodeLike(deptMatch);
    const nonSalaryDeptMatchExpr = isOperation
      ? `(NOT ${isSalaryChinaExpr} AND `
      : `(`;
    const salaryDeptExistsExpr = `
      (${isSalaryChinaExpr}
        AND salary_by_department IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(salary_by_department) AS entry
          WHERE entry->>'department' ILIKE '%' || $${salaryDeptMatchParam} || '%'
        ))
    `;
    if (deptCodeMode) {
      // 代码模式：要求是独立 token（边界可为开头/结尾/空格/下划线/连字符等），避免 "it" 命中无关文本。
      query += ` AND (${nonSalaryDeptMatchExpr}UPPER(COALESCE(${departmentExpr}, '')) ~ $${paramIndex++})${isOperation ? ` OR ${salaryDeptExistsExpr}` : ''})`;
      params.push(`(^|[^A-Z0-9])${deptMatch.toUpperCase()}([^A-Z0-9]|$)`);
    } else {
      query += ` AND (${nonSalaryDeptMatchExpr}${departmentExpr} ILIKE $${paramIndex++})${isOperation ? ` OR ${salaryDeptExistsExpr}` : ''})`;
      params.push(`%${deptMatch}%`);
    }

    // 月份过滤
    if (month) {
      const bucket = parseMonthBucket(month);
      if (!bucket) {
        const payload: Record<string, unknown> = {
          total: '0.00',
          count: 0,
          hint: 'month 格式无效，请用 2026-04 或 2026-04-30（仅需年月）'
        };
        if (wantEcho) {
          payload.receivedQuery = req.query;
        }
        res.json(payload);
        return;
      }
      const { year, monthNum } = bucket;
      const startOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(Number(year), monthNum, 0).getDate();
      const endOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;

      query += ` AND ${timeColumn} >= $${paramIndex++} AND ${timeColumn} <= $${paramIndex++}`;
      params.push(startOfMonth, endOfMonth + ' 23:59:59');
    } else {
      if (start_date && end_date) {
        query += ` AND ${timeColumn} >= $${paramIndex++} AND ${timeColumn} <= $${paramIndex++}`;
        params.push(start_date, end_date + ' 23:59:59');
      } else if (start_date) {
        query += ` AND ${timeColumn} >= $${paramIndex++}`;
        params.push(start_date);
      } else if (end_date) {
        query += ` AND ${timeColumn} <= $${paramIndex++}`;
        params.push(end_date + ' 23:59:59');
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
            deptMatchMode: deptCodeMode ? 'code-token' : 'fuzzy',
            amountSumExpr: amountRmbExpr,
            sourceTable: queryConfig.tableName,
            timeColumn,
            monthParsed: month ? parseMonthBucket(month) : null,
            flowStatusFilter: flowStatusCompletedOnly ? "approval_status='COMPLETED'" : 'none',
            excludeRevokedBiz: !allowRevokedBiz
          };
          payload.receivedQuery = req.query;
        }
        res.json(payload);
        return;
      }

      query += ` ORDER BY ${timeColumn} DESC`;
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
          deptMatchMode: deptCodeMode ? 'code-token' : 'fuzzy',
          amountSumExpr: amountRmbExpr,
          sourceTable: queryConfig.tableName,
          timeColumn,
          monthParsed: month ? parseMonthBucket(month) : null,
          flowStatusFilter: flowStatusCompletedOnly ? "approval_status='COMPLETED'" : 'none',
          excludeRevokedBiz: !allowRevokedBiz
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
      echo,
      flow_status,
      include_revoked
    } = req.query;

    const queryConfig = getExpenseQueryConfig(processKind);
    const timeColumn = 'COALESCE(source_created_at, request_date::timestamp)';

    const allowRevokedBiz = String(include_revoked || '').toLowerCase() === '1';
    const flowStatusCompletedOnly = String(flow_status || '').toLowerCase() === 'completed';

    logger.info(
      `全部门查询: month=${month}, processKind=${queryConfig.processKind}, table=${queryConfig.tableName}, start_date=${start_date}, end_date=${end_date}, flow_status=${flowStatusCompletedOnly ? 'COMPLETED-only' : 'all'}`
    );

    const wantEcho = String(echo || '') === '1';
    const isDebug = String(debug || '') === '1';
    const isOperation = queryConfig.processKind === 'operation';
    const isSalaryChinaExpr = `(operation_expense ILIKE '%工资中国%' OR operation_expense ILIKE '%Salario en China%')`;

    // 工资中国感知的金额表达式：全部门查询时，对工资中国记录取 salary_by_department 所有条目之和
    const amountRmbExpr = isOperation
      ? `
        CASE
          WHEN ${isSalaryChinaExpr} AND salary_by_department IS NOT NULL
          THEN COALESCE(
            (SELECT SUM((entry->>'amount')::numeric)
             FROM jsonb_array_elements(salary_by_department) AS entry),
            0
          )
          ELSE COALESCE(base_currency_amount, 0)
        END
      `
      : queryConfig.amountRmbExpr;

    let query = isDebug
      ? `
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
    `
      : `
      SELECT COALESCE(SUM(${amountRmbExpr}), 0)::text AS total, COUNT(*)::int AS count
      FROM ${queryConfig.tableName}
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (flowStatusCompletedOnly) {
      query += ` AND approval_status = 'COMPLETED'`;
    }

    query += ` AND UPPER(COALESCE(NULLIF(TRIM(approval_status), ''), NULLIF(TRIM(raw_data->>'status'), ''), 'NONE')) NOT IN ('TERMINATED', 'CANCELED', 'CANCELLED')`;

    if (!allowRevokedBiz) {
      query += ` AND UPPER(COALESCE(NULLIF(TRIM(raw_data->>'bizAction'), ''), NULLIF(TRIM(raw_data->>'biz_action'), ''), 'NONE')) NOT IN ('REVOKE', 'DELETE', 'TERMINATE', 'CANCEL', 'CANCELED', 'CANCELLED')`;
    }

    query += `
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(raw_data->'tasks', '[]'::jsonb)) AS t
        WHERE UPPER(COALESCE(t->>'result', '')) IN ('REFUSE', 'REJECT')
      )
    `;
    query += ` AND UPPER(COALESCE(raw_data->>'flowResult', raw_data->>'result', '')) NOT IN ('REFUSE', 'REJECT')`;

    // 月份过滤
    if (month) {
      const bucket = parseMonthBucket(month);
      if (!bucket) {
        const payload: Record<string, unknown> = {
          total: '0.00',
          count: 0,
          hint: 'month 格式无效，请用 2026-04 或 2026-04-30（仅需年月）'
        };
        if (wantEcho) {
          payload.receivedQuery = req.query;
        }
        res.json(payload);
        return;
      }
      const { year, monthNum } = bucket;
      const startOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(Number(year), monthNum, 0).getDate();
      const endOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;

      query += ` AND ${timeColumn} >= $${paramIndex++} AND ${timeColumn} <= $${paramIndex++}`;
      params.push(startOfMonth, endOfMonth + ' 23:59:59');
    } else {
      if (start_date && end_date) {
        query += ` AND ${timeColumn} >= $${paramIndex++} AND ${timeColumn} <= $${paramIndex++}`;
        params.push(start_date, end_date + ' 23:59:59');
      } else if (start_date) {
        query += ` AND ${timeColumn} >= $${paramIndex++}`;
        params.push(start_date);
      } else if (end_date) {
        query += ` AND ${timeColumn} <= $${paramIndex++}`;
        params.push(end_date + ' 23:59:59');
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
        if (isOperation) {
          const whereClause = query.slice(query.indexOf('WHERE 1=1') + 'WHERE 1=1'.length);
          const breakdownQuery = `
            SELECT dept, COALESCE(SUM(amount), 0)::text AS total
            FROM (
              SELECT
                COALESCE(NULLIF(TRIM(applicant_department), ''), 'Unknown') AS dept,
                COALESCE(base_currency_amount, 0) AS amount
              FROM ${queryConfig.tableName}
              WHERE NOT ${isSalaryChinaExpr}
              ${whereClause}

              UNION ALL

              SELECT
                COALESCE(NULLIF(TRIM(entry->>'department'), ''), 'Unknown') AS dept,
                COALESCE((entry->>'amount')::numeric, 0) AS amount
              FROM ${queryConfig.tableName},
                   jsonb_array_elements(salary_by_department) AS entry
              WHERE ${isSalaryChinaExpr}
                AND salary_by_department IS NOT NULL
              ${whereClause}
            ) AS combined
            GROUP BY dept
            ORDER BY SUM(amount) DESC
          `;
          const breakdownResult = await client.query(breakdownQuery, params);
          payload.breakdown = Object.fromEntries(
            (breakdownResult.rows || []).map((breakdownRow: Record<string, unknown>) => [
              String(breakdownRow.dept || 'Unknown'),
              Number.parseFloat(String(breakdownRow.total || 0)).toFixed(2)
            ])
          );
        }
        if (wantEcho) {
          payload.resolved = {
            deptMatch: '(all)',
            deptMatchMode: 'all',
            amountSumExpr: amountRmbExpr,
            sourceTable: queryConfig.tableName,
            timeColumn,
            monthParsed: month ? parseMonthBucket(month) : null,
            flowStatusFilter: flowStatusCompletedOnly ? "approval_status='COMPLETED'" : 'none',
            excludeRevokedBiz: !allowRevokedBiz
          };
          payload.receivedQuery = req.query;
        }
        res.json(payload);
        return;
      }

      query += ` ORDER BY ${timeColumn} DESC`;
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
          deptMatch: '(all)',
          deptMatchMode: 'all',
          amountSumExpr: amountRmbExpr,
          sourceTable: queryConfig.tableName,
          timeColumn,
          monthParsed: month ? parseMonthBucket(month) : null,
          flowStatusFilter: flowStatusCompletedOnly ? "approval_status='COMPLETED'" : 'none',
          excludeRevokedBiz: !allowRevokedBiz
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
