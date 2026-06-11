import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db } from './pool.js';
import { approvalInstances, syncState } from './schema/index.js';
import { ApprovalInstanceData, PendingInstance } from './types.js';

const currentTimestamp = sql`CURRENT_TIMESTAMP`;

function truncateOrNull(value: string | undefined, length: number): string | null {
  return value?.substring(0, length) || null;
}

function decimalOrNullish(value: number | undefined | null): string | null {
  return value == null ? null : String(value);
}

export async function ensureProcessInstanceIdColumn(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE approval_instances
    ADD COLUMN IF NOT EXISTS process_instance_id VARCHAR(128)
  `);
  await db.execute(sql`
    COMMENT ON COLUMN approval_instances.process_instance_id IS '钉钉审批实例ID（详情接口参数），与 business_id(businessId) 不同'
  `);
  await db.execute(sql`
    ALTER TABLE approval_instances
    ADD COLUMN IF NOT EXISTS flow_result VARCHAR(32)
  `);
  await db.execute(sql`
    COMMENT ON COLUMN approval_instances.flow_result IS '整单结果（按tasks识别）：AGREE/REFUSE/NONE'
  `);
}

export async function ensureBaseCurrencyAmountColumn(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE approval_instances
    ADD COLUMN IF NOT EXISTS base_currency_amount DECIMAL(15,2)
  `);
  await db.execute(sql`
    COMMENT ON COLUMN approval_instances.base_currency_amount IS '本位币金额（人民币）：按提交日(Asia/Shanghai)查 fx_rates_daily.cny_per_unit 折算；无日表时兜底请求 open.er-api latest/USD'
  `);
}

export async function ensureSyncStateTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      task_name VARCHAR(128) PRIMARY KEY,
      last_success_ts BIGINT NOT NULL,
      update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function ensureApprovalExpenseSchema(): Promise<void> {
  const sqlPath = path.join(__dirname, '..', '..', '..', 'sql', 'ensure_approval_expense_schema.sql');
  const sqlContent = sql.raw(fs.readFileSync(sqlPath, 'utf8'));
  await db.execute(sql`${sqlContent}`);
}

export async function getSyncCursor(taskName: string): Promise<number | null> {
  const rows = await db
    .select({ last_success_ts: syncState.lastSuccessTs })
    .from(syncState)
    .where(eq(syncState.taskName, taskName));

  if (rows.length === 0) {
    return null;
  }
  return Number(rows[0].last_success_ts);
}

export async function setSyncCursor(taskName: string, timestampMs: number): Promise<void> {
  await db
    .insert(syncState)
    .values({
      taskName,
      lastSuccessTs: timestampMs,
      updateTime: currentTimestamp,
    })
    .onConflictDoUpdate({
      target: syncState.taskName,
      set: {
        lastSuccessTs: sql`excluded.last_success_ts`,
        updateTime: currentTimestamp,
      },
    });
}

export async function upsertApprovalInstance(data: ApprovalInstanceData): Promise<boolean> {
  try {
    await db
      .insert(approvalInstances)
      .values({
        businessId: data.businessId,
        title: truncateOrNull(data.title, 500),
        processCode: truncateOrNull(data.processCode, 64),
        processType: truncateOrNull(data.processType, 32),
        status: truncateOrNull(data.status, 32),
        originatorUserId: truncateOrNull(data.originatorUserId, 64),
        originatorDeptId: truncateOrNull(data.originatorDeptId, 32),
        originatorDeptName: truncateOrNull(data.originatorDeptName, 500),
        bizAction: truncateOrNull(data.bizAction, 32),
        createTime: data.createTime || null,
        cashierTaskId: truncateOrNull(data.cashierTaskId, 64),
        cashierUserId: truncateOrNull(data.cashierUserId, 64),
        cashierStatus: truncateOrNull(data.cashierStatus, 32),
        cashierResult: truncateOrNull(data.cashierResult, 32),
        cashierCompleteTime: data.cashierCompleteTime || null,
        flowResult: truncateOrNull(data.flowResult, 32),
        department: truncateOrNull(data.department, 128),
        applyType: truncateOrNull(data.applyType, 128),
        expenseType: truncateOrNull(data.expenseType, 128),
        region: truncateOrNull(data.region, 128),
        operationExpenseType: truncateOrNull(data.operationExpenseType, 128),
        description: truncateOrNull(data.description, 5000),
        beneficiary: truncateOrNull(data.beneficiary, 500),
        amount: decimalOrNullish(data.amount),
        paymentTerms: truncateOrNull(data.paymentTerms, 128),
        currency: truncateOrNull(data.currency, 32),
        baseCurrencyAmount: decimalOrNullish(data.baseCurrencyAmount),
        paymentDate: data.paymentDate,
        applyDate: data.applyDate || null,
        productionType: truncateOrNull(data.productionType, 64),
        monthlyBudget: decimalOrNullish(data.monthlyBudget),
        monthlyBudgetUsed: decimalOrNullish(data.monthlyBudgetUsed),
        processInstanceId: truncateOrNull(data.processInstanceId, 128),
        rawData: data.rawData || {},
      })
      .onConflictDoUpdate({
        target: approvalInstances.businessId,
        set: {
          title: sql`excluded.title`,
          processCode: sql`excluded.process_code`,
          processType: sql`excluded.process_type`,
          status: sql`excluded.status`,
          bizAction: sql`excluded.biz_action`,
          originatorUserId: sql`excluded.originator_user_id`,
          originatorDeptId: sql`excluded.originator_dept_id`,
          originatorDeptName: sql`excluded.originator_dept_name`,
          cashierTaskId: sql`excluded.cashier_task_id`,
          cashierUserId: sql`excluded.cashier_user_id`,
          cashierStatus: sql`excluded.cashier_status`,
          cashierResult: sql`excluded.cashier_result`,
          cashierCompleteTime: sql`excluded.cashier_complete_time`,
          flowResult: sql`excluded.flow_result`,
          department: sql`excluded.department`,
          applyType: sql`excluded.apply_type`,
          expenseType: sql`excluded.expense_type`,
          region: sql`excluded.region`,
          operationExpenseType: sql`excluded.operation_expense_type`,
          description: sql`excluded.description`,
          beneficiary: sql`excluded.beneficiary`,
          amount: sql`excluded.amount`,
          paymentTerms: sql`excluded.payment_terms`,
          currency: sql`excluded.currency`,
          baseCurrencyAmount: sql`excluded.base_currency_amount`,
          paymentDate: sql`excluded.payment_date`,
          applyDate: sql`excluded.apply_date`,
          productionType: sql`excluded.production_type`,
          monthlyBudget: sql`excluded.monthly_budget`,
          monthlyBudgetUsed: sql`excluded.monthly_budget_used`,
          processInstanceId: sql`excluded.process_instance_id`,
          rawData: sql`excluded.raw_data`,
          updateTime: currentTimestamp,
        },
      });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('数据库插入/更新失败:', message);
    throw error;
  }
}

export async function isCashierApproved(businessId: string): Promise<boolean> {
  const rows = await db
    .select({
      cashier_status: approvalInstances.cashierStatus,
      cashier_result: approvalInstances.cashierResult,
    })
    .from(approvalInstances)
    .where(eq(approvalInstances.businessId, businessId));

  if (rows.length === 0) {
    return false;
  }

  const { cashier_status, cashier_result } = rows[0];
  return cashier_status === 'COMPLETED' && cashier_result === 'AGREE';
}

export async function getLastUpdateTime(): Promise<string | null> {
  const rows = await db
    .select({ last_update: max(approvalInstances.updateTime) })
    .from(approvalInstances);
  return rows[0]?.last_update || null;
}

export async function getPendingInstances(limit = 500): Promise<PendingInstance[]> {
  return db
    .select({
      business_id: approvalInstances.businessId,
      process_code: sql<string>`${approvalInstances.processCode}`,
      raw_data: sql<Record<string, unknown>>`${approvalInstances.rawData}`,
      process_instance_id: approvalInstances.processInstanceId,
    })
    .from(approvalInstances)
    .where(sql`NOT (${approvalInstances.cashierStatus} = 'COMPLETED' AND ${approvalInstances.cashierResult} = 'AGREE')`)
    .orderBy(desc(approvalInstances.updateTime))
    .limit(limit);
}

export async function getStaleCashierAgreed(limit = 80): Promise<PendingInstance[]> {
  return db
    .select({
      business_id: approvalInstances.businessId,
      process_code: sql<string>`${approvalInstances.processCode}`,
      raw_data: sql<Record<string, unknown>>`${approvalInstances.rawData}`,
      process_instance_id: approvalInstances.processInstanceId,
    })
    .from(approvalInstances)
    .where(and(
      eq(approvalInstances.cashierStatus, 'COMPLETED'),
      eq(approvalInstances.cashierResult, 'AGREE'),
      sql`(${approvalInstances.rawData}->>'cashierStatus' IS NULL OR ${approvalInstances.rawData}->>'cashierStatus' != 'COMPLETED')`
    ))
    .orderBy(asc(approvalInstances.updateTime))
    .limit(limit);
}

export async function existsByBusinessId(businessId: string): Promise<boolean> {
  const rows = await db
    .select({ exists: sql<number>`1` })
    .from(approvalInstances)
    .where(eq(approvalInstances.businessId, businessId))
    .limit(1);
  return rows.length > 0;
}
