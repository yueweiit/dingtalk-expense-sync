import { pool } from './database/pool.ts';
import { sendMarkdownToUsers } from './dingtalk-robot.ts';
import dingtalk from './dingtalk.ts';
import config from './config.ts';
import logger from './logger.ts';
import { resolveSharedBudgetReportDepartment } from './shared-budget-departments.ts';
import { approvalExpenseTimeExpr, formatUtcDate, utcDateRange } from './utc-time.ts';
import { completedApprovalResultSql, completedApprovedExpenseSql } from './completed-expense-policy.ts';

// ─── SQL helpers ───

const TIME_COLUMN = approvalExpenseTimeExpr();
const BUDGET_SUBMISSION_TIME_COLUMN = `COALESCE(source_created_at, request_date::timestamp AT TIME ZONE 'UTC')`;

const EXPENSE_STATUS_FILTER_ALIASED = `AND ${completedApprovedExpenseSql('o')}`;
const AUTHORIZED_PAYMENT_EVENT_USER_SQL = config.dingtalk.paymentEventUserIds
  .map((userId) => `'${userId}'`)
  .join(', ');
const PAYMENT_EVENT_FILTER = `
  AND event.status = 'confirmed'
  AND event.rule_version = 'authorized-comment-v1'
  AND event.source_type IN ('comment_explicit_amount', 'fully_deducted')
  AND event.source_user_id IN (${AUTHORIZED_PAYMENT_EVENT_USER_SQL})
`;

/** Budget applications remain visible while they are pending, as before this change. */
const BUDGET_STATUS_FILTER = `
  AND UPPER(COALESCE(NULLIF(TRIM(approval_status), ''), NULLIF(TRIM(raw_data->>'status'), ''), 'NONE')) NOT IN ('TERMINATED', 'CANCELED', 'CANCELLED')
  AND UPPER(COALESCE(NULLIF(TRIM(raw_data->>'bizAction'), ''), NULLIF(TRIM(raw_data->>'biz_action'), ''), 'NONE')) NOT IN ('REVOKE', 'DELETE', 'TERMINATE', 'CANCEL', 'CANCELED', 'CANCELLED')
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(raw_data->'tasks', '[]'::jsonb)) AS t
    WHERE UPPER(COALESCE(t->>'result', '')) IN ('REFUSE', 'REJECT')
  )
  AND ${completedApprovalResultSql()} NOT IN ('refuse', 'reject')
`;

/** 运营支出按完成态部门拆分与指定评论付款事件统计。 */
function buildOperationBreakdownSql(dateFilter: string): string {
  const dateFilterAliased = dateFilter
    .replace(/\bsource_created_at\b/g, 'o.source_created_at')
    .replace(/\brequest_date\b/g, 'o.request_date')
    .replace(/\bapproval_completed_at\b/g, 'o.approval_completed_at');
  const timeColumnAliased = approvalExpenseTimeExpr('o');
  const paymentDateFilter = dateFilter
    .replace(/\bsource_created_at\b/g, 'event.paid_at')
    .replace(/\brequest_date\b/g, 'event.paid_at')
    .replace(/\bapproval_completed_at\b/g, 'event.paid_at');
  return `
    SELECT
      dept,
      dept_id,
      department_path_ids,
      department_path_names,
      source_month,
      COALESCE(SUM(amount), 0)::numeric AS total
    FROM (
      SELECT
        ds.department AS dept,
        NULLIF(BTRIM(ds.department_id), '') AS dept_id,
        ds.department_path_ids,
        ds.department_path_names,
        TO_CHAR(${timeColumnAliased} AT TIME ZONE 'UTC', 'YYYY-MM') AS source_month,
        ds.amount
      FROM approval_expense_dept_split ds
      JOIN approval_expense_operation o ON o.business_id = ds.business_id
      WHERE 1=1
      ${dateFilterAliased}
      ${EXPENSE_STATUS_FILTER_ALIASED}

      UNION ALL

      SELECT
        COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS dept,
        NULLIF(BTRIM(o.applicant_department_id), '') AS dept_id,
        o.applicant_department_path_ids AS department_path_ids,
        o.applicant_department_path_names AS department_path_names,
        TO_CHAR(event.paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS source_month,
        COALESCE(event.base_currency_amount, 0) AS amount
      FROM approval_expense_payment_events event
      JOIN approval_expense_operation o ON o.business_id = event.business_id
      WHERE NOT EXISTS (
        SELECT 1 FROM approval_expense_dept_split ds
        WHERE ds.business_id = event.business_id
      )
      ${paymentDateFilter}
      ${PAYMENT_EVENT_FILTER}

      UNION ALL

      SELECT
        COALESCE(NULLIF(TRIM(o.applicant_department), ''), 'Unknown') AS dept,
        NULLIF(BTRIM(o.applicant_department_id), '') AS dept_id,
        o.applicant_department_path_ids AS department_path_ids,
        o.applicant_department_path_names AS department_path_names,
        TO_CHAR(${timeColumnAliased} AT TIME ZONE 'UTC', 'YYYY-MM') AS source_month,
        COALESCE(o.base_currency_amount, 0) AS amount
      FROM approval_expense_operation o
      WHERE NOT EXISTS (SELECT 1 FROM approval_expense_dept_split ds WHERE ds.business_id = o.business_id)
        AND NOT EXISTS (
          SELECT 1 FROM approval_expense_payment_events event
          WHERE event.business_id = o.business_id
          ${PAYMENT_EVENT_FILTER}
        )
      ${dateFilterAliased}
      ${EXPENSE_STATUS_FILTER_ALIASED}
    ) combined
    GROUP BY dept, dept_id, department_path_ids, department_path_names, source_month
    ORDER BY total DESC
  `;
}

function buildPurchaseBreakdownSql(dateFilter: string): string {
  const paymentDateFilter = dateFilter.replace(/\bapproval_completed_at\b/g, 'event.paid_at');
  return `
    SELECT COALESCE(NULLIF(TRIM(p.applicant_department), ''), 'Unknown') AS dept,
      NULLIF(BTRIM(p.applicant_department_id), '') AS dept_id,
      p.applicant_department_path_ids AS department_path_ids, p.applicant_department_path_names AS department_path_names,
      TO_CHAR(p.accounting_at AT TIME ZONE 'UTC', 'YYYY-MM') AS source_month,
      COALESCE(SUM(p.event_amount), 0)::numeric AS total
    FROM (
      SELECT p.*, event.paid_at AS accounting_at, event.base_currency_amount AS event_amount
      FROM approval_expense_payment_events event JOIN approval_expense_purchase p ON p.business_id = event.business_id
      WHERE 1=1 ${paymentDateFilter} ${PAYMENT_EVENT_FILTER}
      UNION ALL
      SELECT p.*, p.approval_completed_at AS accounting_at, p.base_currency_amount AS event_amount
      FROM approval_expense_purchase p
      WHERE NOT EXISTS (SELECT 1 FROM approval_expense_payment_events event WHERE event.business_id = p.business_id ${PAYMENT_EVENT_FILTER})
      ${dateFilter}
      AND ${completedApprovedExpenseSql('p')}
    ) p
    GROUP BY dept, dept_id, applicant_department_path_ids, applicant_department_path_names, source_month
    ORDER BY total DESC
  `;
}

function buildMonthlySettlementBreakdownSql(dateFilter: string): string {
  const paymentDateFilter = dateFilter
    .replace(/\bsource_created_at\b/g, 'event.paid_at')
    .replace(/\brequest_date\b/g, 'event.paid_at')
    .replace(/\bapproval_completed_at\b/g, 'event.paid_at');
  return `
    SELECT
      COALESCE(NULLIF(TRIM(monthly.applicant_department), ''), 'Unknown') AS dept,
      NULLIF(BTRIM(monthly.applicant_department_id), '') AS dept_id,
      monthly.applicant_department_path_ids AS department_path_ids,
      monthly.applicant_department_path_names AS department_path_names,
      TO_CHAR(event.paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS source_month,
      COALESCE(event.base_currency_amount, 0) AS amount
    FROM approval_expense_payment_events event
    JOIN approval_expense_monthly_settlement monthly ON monthly.business_id = event.business_id
    WHERE 1=1
      ${paymentDateFilter}
      AND event.expense_kind = 'monthly_settlement'
      ${PAYMENT_EVENT_FILTER}
  `;
}

async function monthlySettlementTablesAvailable(client: { query: (text: string) => Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<boolean> {
  const result = await client.query(`
    SELECT to_regclass('public.approval_expense_monthly_settlement') AS monthly_table,
           to_regclass('public.approval_expense_payment_events') AS payment_event_table
  `);
  return Boolean(result.rows[0]?.monthly_table) && Boolean(result.rows[0]?.payment_event_table);
}

// ─── Date helpers ───

function buildUtcDateFilter(startDate: string, endDate: string, timeColumn = TIME_COLUMN): string {
  const range = utcDateRange(startDate, endDate);
  return `AND ${timeColumn} >= '${range.start}'::timestamptz AND ${timeColumn} < '${range.endExclusive}'::timestamptz`;
}

function getLastWeekRange(): { start: string; end: string } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1 + 7;
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(now.getUTCDate() - daysBack);
  const lastSunday = new Date(lastMonday);
  lastSunday.setUTCDate(lastMonday.getUTCDate() + 6);
  return { start: formatUtcDate(lastMonday), end: formatUtcDate(lastSunday) };
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── Data queries ───

interface DeptExpense {
  dept: string;
  dept_id: string | null;
  department_path_ids: unknown;
  department_path_names: unknown;
  source_month: string | null;
  total: number;
}

interface ReportDepartmentTotal {
  departmentId: string;
  departmentName: string;
  total: number;
}

interface BudgetProgress extends ReportDepartmentTotal {
  budget: number | null;
  spent: number | null;
}

function reportDepartmentKey(departmentId: string, departmentName: string): string {
  return departmentId ? `id:${departmentId}` : `name:${departmentName}`;
}

function resolveReportDepartment(row: Pick<DeptExpense, 'dept' | 'dept_id' | 'department_path_ids' | 'department_path_names' | 'source_month'>, fallbackMonth: string): {
  key: string;
  departmentId: string;
  departmentName: string;
} {
  const department = resolveSharedBudgetReportDepartment({
    departmentId: row.dept_id,
    departmentName: row.dept,
    departmentPathIds: row.department_path_ids,
    departmentPathNames: row.department_path_names,
    month: row.source_month || fallbackMonth,
  });
  if (department.missingParentPath) {
    logger.warn(`共享预算子部门缺少父部门路径，周报保留原部门: id=${department.departmentId}, name=${department.departmentName}`);
  }
  return {
    key: reportDepartmentKey(department.departmentId, department.departmentName),
    departmentId: department.departmentId,
    departmentName: department.departmentName,
  };
}

function addDepartmentAmount(
  target: Map<string, ReportDepartmentTotal>,
  row: DeptExpense,
  fallbackMonth: string
): void {
  const department = resolveReportDepartment(row, fallbackMonth);
  const existing = target.get(department.key);
  target.set(department.key, {
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    total: (existing?.total || 0) + Number(row.total),
  });
}

export async function getWeeklyExpenses(startDate: string, endDate: string): Promise<Map<string, ReportDepartmentTotal>> {
  const dateFilter = buildUtcDateFilter(startDate, endDate);
  const reportMonth = endDate.slice(0, 7);

  const client = await pool.connect();
  try {
    const hasMonthlySettlementTables = await monthlySettlementTablesAvailable(client);
    const [opResult, purResult, monthlyResult] = await Promise.all([
      client.query(buildOperationBreakdownSql(dateFilter)),
      client.query(buildPurchaseBreakdownSql(dateFilter)),
      hasMonthlySettlementTables
        ? client.query(buildMonthlySettlementBreakdownSql(dateFilter))
        : Promise.resolve({ rows: [] }),
    ]);

    const merged = new Map<string, ReportDepartmentTotal>();
    for (const row of opResult.rows as DeptExpense[]) {
      addDepartmentAmount(merged, row, reportMonth);
    }
    for (const row of purResult.rows as DeptExpense[]) {
      addDepartmentAmount(merged, row, reportMonth);
    }
    for (const row of monthlyResult.rows as DeptExpense[]) {
      addDepartmentAmount(merged, row, reportMonth);
    }
    return merged;
  } finally {
    client.release();
  }
}

interface BudgetRow {
  dept: string;
  dept_id: string | null;
  department_path_ids: unknown;
  department_path_names: unknown;
  budget: string | null;
}

async function getMonthlyBudgetProgress(month: string): Promise<Map<string, BudgetProgress>> {
  const [year, monthNum] = month.split('-').map(Number);
  const startOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate();
  const endOfMonth = `${year}-${String(monthNum).padStart(2, '0')}-${lastDay}`;
  const monthDateFilter = buildUtcDateFilter(startOfMonth, endOfMonth);
  const budgetMonthDateFilter = buildUtcDateFilter(startOfMonth, endOfMonth, BUDGET_SUBMISSION_TIME_COLUMN);

  const client = await pool.connect();
  try {
    // Query 1: budget amount, later reduced to the latest submission per report department.
    const budgetSql = `
      SELECT
        COALESCE(NULLIF(TRIM(applicant_department), ''), 'Unknown') AS dept,
        NULLIF(BTRIM(applicant_department_id), '') AS dept_id,
        applicant_department_path_ids AS department_path_ids,
        applicant_department_path_names AS department_path_names,
        monthly_budget_amount AS budget,
        ${BUDGET_SUBMISSION_TIME_COLUMN} AS ts
      FROM approval_expense_operation
      WHERE monthly_budget_amount IS NOT NULL
      ${budgetMonthDateFilter}
      ${BUDGET_STATUS_FILTER}
      ORDER BY ts DESC NULLS LAST
    `;

    // Query 2: Actual monthly spending by SUMMING base_currency_amount
    const spentOpSql = buildOperationBreakdownSql(monthDateFilter);
    const spentPurSql = buildPurchaseBreakdownSql(monthDateFilter);

    const hasMonthlySettlementTables = await monthlySettlementTablesAvailable(client);
    const [budgetResult, spentOpResult, spentPurResult, spentMonthlyResult] = await Promise.all([
      client.query(budgetSql),
      client.query(spentOpSql),
      client.query(spentPurSql),
      hasMonthlySettlementTables
        ? client.query(buildMonthlySettlementBreakdownSql(monthDateFilter))
        : Promise.resolve({ rows: [] }),
    ]);

    // Merge budget data
    const map = new Map<string, BudgetProgress>();
    for (const row of budgetResult.rows as BudgetRow[]) {
      const department = resolveReportDepartment({ ...row, source_month: month }, month);
      if (!map.has(department.key)) {
        map.set(department.key, {
          departmentId: department.departmentId,
          departmentName: department.departmentName,
          total: 0,
          budget: row.budget != null ? Number(row.budget) : null,
          spent: null,
        });
      }
    }

    // Merge actual spending from operation table
    for (const row of spentOpResult.rows as DeptExpense[]) {
      const department = resolveReportDepartment(row, month);
      const existing = map.get(department.key) || {
        departmentId: department.departmentId,
        departmentName: department.departmentName,
        total: 0,
        budget: null,
        spent: null,
      };
      existing.spent = (existing.spent || 0) + Number(row.total);
      map.set(department.key, existing);
    }

    // Merge actual spending from purchase table
    for (const row of spentPurResult.rows as DeptExpense[]) {
      const department = resolveReportDepartment(row, month);
      const existing = map.get(department.key) || {
        departmentId: department.departmentId,
        departmentName: department.departmentName,
        total: 0,
        budget: null,
        spent: null,
      };
      existing.spent = (existing.spent || 0) + Number(row.total);
      map.set(department.key, existing);
    }

    for (const row of spentMonthlyResult.rows as DeptExpense[]) {
      const department = resolveReportDepartment(row, month);
      const existing = map.get(department.key) || {
        departmentId: department.departmentId,
        departmentName: department.departmentName,
        total: 0,
        budget: null,
        spent: null,
      };
      existing.spent = (existing.spent || 0) + Number(row.total);
      map.set(department.key, existing);
    }

    return map;
  } finally {
    client.release();
  }
}

// ─── Report types & formatting ───

interface DeptReport {
  deptName: string;
  weeklyExpenses: number;
  budget: number | null;
  spent: number | null;
  weekStart: string;
  weekEnd: string;
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeDeptName(name: string): string {
  let trimmed = name.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    trimmed = parts.slice(1).join(' ');
  }
  return trimmed.toLowerCase();
}

/** Look up recipients for a department from config mapping. Priority: exact > normalize > prefix */
function findRecipients(deptName: string): string[] | null {
  const recipients = config.scheduler.weeklyReportDeptRecipients;
  const keys = Object.keys(recipients);
  if (keys.length === 0) return null;

  const trimmedLower = deptName.trim().toLowerCase();
  const normalized = normalizeDeptName(deptName);

  // 1. Exact match (trim + lowercase)
  const exactKey = keys.find(k => k.trim().toLowerCase() === trimmedLower);
  if (exactKey) return recipients[exactKey];

  // 2. Normalized match (strip prefix + lowercase)
  const normalizedKey = keys.find(k => normalizeDeptName(k) === normalized);
  if (normalizedKey) return recipients[normalizedKey];

  // 3. Prefix match: config key is prefix of dept name (e.g. "AG 核算小组" matches "AG 核算小组Grupo de Contabilidad")
  const prefixKey = keys.find(k => trimmedLower.startsWith(k.trim().toLowerCase()));
  if (prefixKey) return recipients[prefixKey];

  // 4. Reverse prefix match: dept name is prefix of config key
  const reversePrefixKey = keys.find(k => k.trim().toLowerCase().startsWith(trimmedLower));
  if (reversePrefixKey) return recipients[reversePrefixKey];

  return null;
}

function formatDeptReport(dept: DeptReport): { title: string; text: string } {
  const lines: string[] = [];
  lines.push(`# 预算执行周报`);
  lines.push('');
  lines.push(`**报告期间**: ${dept.weekStart} ~ ${dept.weekEnd}`);
  lines.push(`**部门**: ${dept.deptName}`);
  lines.push('');
  lines.push(`## 本周支出`);
  lines.push('');
  lines.push(`- 本周支出合计：**${formatAmount(dept.weeklyExpenses)} CNY**`);
  lines.push('');
  lines.push(`## 本月预算执行进度`);
  lines.push('');

  if (dept.budget != null) {
    const usagePct = dept.budget > 0 ? ((dept.spent || 0) / dept.budget * 100) : 0;
    const remaining = dept.budget - (dept.spent || 0);
    lines.push(`- 月度预算：${formatAmount(dept.budget)}`);
    lines.push(`- 累计支出：${formatAmount(dept.spent || 0)}`);
    lines.push(`- 使用比例：**${usagePct.toFixed(1)}%**`);
    lines.push(`- 剩余额度：${formatAmount(remaining)}`);
  } else {
    lines.push(`- 暂无预算数据`);
  }

  lines.push('');
  lines.push('---');
  lines.push('> 说明：月度预算来源于审批单中的"本月预算金额"字段（取最近一次提交值）；普通运营/采购支出仅统计指定用户评论中的明确付款金额，部门拆分表单在完成后按明细统计。');

  return {
    title: `预算执行周报 - ${dept.deptName}`,
    text: lines.join('\n'),
  };
}

function formatAdminSummary(
  sentCount: number,
  failedDepts: string[],
  noRecipientDepts: string[],
  emptyRecipientDepts: string[]
): { title: string; text: string } {
  const lines: string[] = [];
  lines.push('# 预算周报发送完成');
  lines.push('');
  lines.push(`- 成功：**${sentCount}** 部门`);

  if (failedDepts.length > 0) {
    lines.push(`- 失败：**${failedDepts.length}** 部门`);
    lines.push(`- 失败部门：${failedDepts.join(', ')}`);
  }

  if (noRecipientDepts.length > 0) {
    lines.push(`- 未配置收件人：**${noRecipientDepts.length}** 部门`);
    lines.push(`- 未配置部门：${noRecipientDepts.join(', ')}`);
  }

  if (emptyRecipientDepts.length > 0) {
    lines.push(`- 收件人为空：**${emptyRecipientDepts.length}** 部门`);
    lines.push(`- 空数组部门：${emptyRecipientDepts.join(', ')}`);
  }

  return {
    title: '预算周报发送汇总',
    text: lines.join('\n'),
  };
}

// ─── Orchestrator ───

export async function sendWeeklyBudgetReport(): Promise<void> {
  logger.info('开始生成预算执行周报');

  const { start: weekStart, end: weekEnd } = getLastWeekRange();
  const currentMonth = getCurrentMonth();
  logger.info(`报告期间: ${weekStart} ~ ${weekEnd}, 月份: ${currentMonth}`);

  // 1. Query data
  const [weeklyExpenses, budgetProgress] = await Promise.all([
    getWeeklyExpenses(weekStart, weekEnd),
    getMonthlyBudgetProgress(currentMonth),
  ]);

  if (weeklyExpenses.size === 0) {
    logger.info('本周无支出数据，跳过周报发送');
    return;
  }

  // 2. Build department reports
  const allDepts = new Set<string>([...weeklyExpenses.keys(), ...budgetProgress.keys()]);
  const reports: DeptReport[] = [];
  for (const deptKey of allDepts) {
    const weekly = weeklyExpenses.get(deptKey);
    const progress = budgetProgress.get(deptKey);
    reports.push({
      deptName: weekly?.departmentName || progress?.departmentName || 'Unknown',
      weeklyExpenses: weekly?.total || 0,
      budget: progress?.budget ?? null,
      spent: progress?.spent ?? null,
      weekStart,
      weekEnd,
    });
  }

  // Sort by weekly expenses descending
  reports.sort((a, b) => b.weeklyExpenses - a.weeklyExpenses);

  logger.info(`共 ${reports.length} 个部门有数据`);

  // 3. Dry-run mode
  if (config.scheduler.weeklyReportDryRun) {
    logger.info('[DRY RUN] 周报内容预览:');
    for (const dept of reports) {
      const markdown = formatDeptReport(dept);
      logger.info(`[DRY RUN] 部门: ${dept.deptName}`);
      logger.info(`[DRY RUN] 标题: ${markdown.title}`);
      logger.info(`[DRY RUN] 内容:\n${markdown.text}`);
      logger.info('---');
    }
    logger.info(`[DRY RUN] 共 ${reports.length} 个部门，dry-run 模式不实际发送`);
    return;
  }

  // 4. Send to each department
  let sentCount = 0;
  const failedDepts: string[] = [];
  const noRecipientDepts: string[] = [];
  const emptyRecipientDepts: string[] = [];

  for (const dept of reports) {
    const recipients = findRecipients(dept.deptName);

    if (recipients === null) {
      logger.warn(`部门 "${dept.deptName}" 未配置收件人，跳过发送`);
      noRecipientDepts.push(dept.deptName);
      continue;
    }

    if (recipients.length === 0) {
      logger.warn(`部门 "${dept.deptName}" 收件人数组为空，跳过发送`);
      emptyRecipientDepts.push(dept.deptName);
      continue;
    }

    const markdown = formatDeptReport(dept);

    try {
      const result = await sendMarkdownToUsers(recipients, markdown);
      if (result.success) {
        sentCount++;
        logger.info(`周报已发送至部门 "${dept.deptName}" (${recipients.length} 位收件人)`);
      } else {
        logger.error(`周报发送失败: 部门="${dept.deptName}", error=${result.error}`);
        failedDepts.push(dept.deptName);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`周报发送异常: 部门="${dept.deptName}", error=${msg}`);
      failedDepts.push(dept.deptName);
    }

    await dingtalk.sleep(200);
  }

  // 5. Admin summary notification
  const adminUserId = config.scheduler.weeklyReportAdminUserId;
  if (adminUserId) {
    const summary = formatAdminSummary(sentCount, failedDepts, noRecipientDepts, emptyRecipientDepts);
    try {
      await sendMarkdownToUsers([adminUserId], summary);
      logger.info('管理员汇总通知已发送');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`管理员汇总通知发送失败: ${msg}`);
    }
  }

  logger.info(`预算执行周报完成: 成功 ${sentCount} 部门, 失败 ${failedDepts.length} 部门, 未配置收件人 ${noRecipientDepts.length} 部门, 空数组 ${emptyRecipientDepts.length} 部门`);
}
