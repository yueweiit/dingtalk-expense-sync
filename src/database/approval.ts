import { PoolClient, QueryResult } from 'pg';
import fs from 'fs';
import path from 'path';
import { pool } from './pool.js';
import { ApprovalInstanceData, PendingInstance } from './types.js';

export async function ensureProcessInstanceIdColumn(): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE approval_instances
      ADD COLUMN IF NOT EXISTS process_instance_id VARCHAR(128)
    `);
    await client.query(`
      COMMENT ON COLUMN approval_instances.process_instance_id IS '钉钉审批实例ID（详情接口参数），与 business_id(businessId) 不同'
    `);
    await client.query(`
      ALTER TABLE approval_instances
      ADD COLUMN IF NOT EXISTS flow_result VARCHAR(32)
    `);
    await client.query(`
      COMMENT ON COLUMN approval_instances.flow_result IS '整单结果（按tasks识别）：AGREE/REFUSE/NONE'
    `);
  } finally {
    client.release();
  }
}

export async function ensureBaseCurrencyAmountColumn(): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE approval_instances
      ADD COLUMN IF NOT EXISTS base_currency_amount DECIMAL(15,2)
    `);
    await client.query(`
      COMMENT ON COLUMN approval_instances.base_currency_amount IS '本位币金额（人民币）：按提交日(Asia/Shanghai)查 fx_rates_daily.cny_per_unit 折算；无日表时兜底请求 open.er-api latest/USD'
    `);
  } finally {
    client.release();
  }
}

export async function ensureSyncStateTable(): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_state (
        task_name VARCHAR(128) PRIMARY KEY,
        last_success_ts BIGINT NOT NULL,
        update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

export async function ensureApprovalExpenseSchema(): Promise<void> {
  const sqlPath = path.join(__dirname, '..', '..', '..', 'sql', 'ensure_approval_expense_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function getSyncCursor(taskName: string): Promise<number | null> {
  const client: PoolClient = await pool.connect();
  try {
    const result: QueryResult<{ last_success_ts: string }> = await client.query(
      `SELECT last_success_ts FROM sync_state WHERE task_name = $1`,
      [taskName]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return Number(result.rows[0].last_success_ts);
  } finally {
    client.release();
  }
}

export async function setSyncCursor(taskName: string, timestampMs: number): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(
      `
        INSERT INTO sync_state (task_name, last_success_ts, update_time)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (task_name) DO UPDATE SET
          last_success_ts = EXCLUDED.last_success_ts,
          update_time = CURRENT_TIMESTAMP
      `,
      [taskName, timestampMs]
    );
  } finally {
    client.release();
  }
}

export async function upsertApprovalInstance(data: ApprovalInstanceData): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `
      INSERT INTO approval_instances (
        business_id, title, process_code, process_type, status,
        originator_user_id, originator_dept_id, originator_dept_name,
        biz_action, create_time,
        cashier_task_id, cashier_user_id, cashier_status, cashier_result, cashier_complete_time, flow_result,
        department, apply_type, expense_type, region, operation_expense_type,
        description, beneficiary, amount, payment_terms, currency, base_currency_amount, payment_date,
        apply_date, production_type, monthly_budget, monthly_budget_used,
        process_instance_id,
        raw_data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      )
      ON CONFLICT (business_id) DO UPDATE SET
        title = EXCLUDED.title,
        process_code = EXCLUDED.process_code,
        process_type = EXCLUDED.process_type,
        status = EXCLUDED.status,
        biz_action = EXCLUDED.biz_action,
        originator_user_id = EXCLUDED.originator_user_id,
        originator_dept_id = EXCLUDED.originator_dept_id,
        originator_dept_name = EXCLUDED.originator_dept_name,
        cashier_task_id = EXCLUDED.cashier_task_id,
        cashier_user_id = EXCLUDED.cashier_user_id,
        cashier_status = EXCLUDED.cashier_status,
        cashier_result = EXCLUDED.cashier_result,
        cashier_complete_time = EXCLUDED.cashier_complete_time,
        flow_result = EXCLUDED.flow_result,
        department = EXCLUDED.department,
        apply_type = EXCLUDED.apply_type,
        expense_type = EXCLUDED.expense_type,
        region = EXCLUDED.region,
        operation_expense_type = EXCLUDED.operation_expense_type,
        description = EXCLUDED.description,
        beneficiary = EXCLUDED.beneficiary,
        amount = EXCLUDED.amount,
        payment_terms = EXCLUDED.payment_terms,
        currency = EXCLUDED.currency,
        base_currency_amount = EXCLUDED.base_currency_amount,
        payment_date = EXCLUDED.payment_date,
        apply_date = EXCLUDED.apply_date,
        production_type = EXCLUDED.production_type,
        monthly_budget = EXCLUDED.monthly_budget,
        monthly_budget_used = EXCLUDED.monthly_budget_used,
        process_instance_id = EXCLUDED.process_instance_id,
        raw_data = EXCLUDED.raw_data,
        update_time = CURRENT_TIMESTAMP
    `;
    await client.query(query, [
      data.businessId,
      data.title?.substring(0, 500) || null,
      data.processCode?.substring(0, 128) || null,
      data.processType?.substring(0, 128) || null,
      data.status?.substring(0, 32) || null,
      data.originatorUserId?.substring(0, 128) || null,
      data.originatorDeptId?.substring(0, 128) || null,
      data.originatorDeptName?.substring(0, 256) || null,
      data.bizAction?.substring(0, 64) || null,
      data.createTime || null,
      data.cashierTaskId?.substring(0, 128) || null,
      data.cashierUserId?.substring(0, 128) || null,
      data.cashierStatus?.substring(0, 32) || null,
      data.cashierResult?.substring(0, 32) || null,
      data.cashierCompleteTime || null,
      data.flowResult?.substring(0, 32) || null,
      data.department?.substring(0, 256) || null,
      data.applyType?.substring(0, 128) || null,
      data.expenseType?.substring(0, 128) || null,
      data.region?.substring(0, 128) || null,
      data.operationExpenseType?.substring(0, 128) || null,
      data.description?.substring(0, 5000) || null,
      data.beneficiary?.substring(0, 500) || null,
      data.amount,
      data.paymentTerms?.substring(0, 128) || null,
      data.currency?.substring(0, 32) || null,
      data.baseCurrencyAmount ?? null,
      data.paymentDate,
      data.applyDate || null,
      data.productionType?.substring(0, 64) || null,
      data.monthlyBudget || null,
      data.monthlyBudgetUsed || null,
      data.processInstanceId?.substring(0, 128) || null,
      JSON.stringify(data.rawData || {})
    ]);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('数据库插入/更新失败:', message);
    throw error;
  } finally {
    client.release();
  }
}

export async function isCashierApproved(businessId: string): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `
      SELECT cashier_status, cashier_result
      FROM approval_instances
      WHERE business_id = $1
    `;
    const result: QueryResult<{ cashier_status: string; cashier_result: string }> = await client.query(query, [businessId]);

    if (result.rows.length === 0) {
      return false;
    }

    const { cashier_status, cashier_result } = result.rows[0];
    return cashier_status === 'COMPLETED' && cashier_result === 'AGREE';
  } finally {
    client.release();
  }
}

export async function getLastUpdateTime(): Promise<string | null> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `SELECT MAX(update_time) as last_update FROM approval_instances`;
    const result: QueryResult<{ last_update: string | null }> = await client.query(query);
    return result.rows[0]?.last_update || null;
  } finally {
    client.release();
  }
}

export async function getPendingInstances(limit = 500): Promise<PendingInstance[]> {
  const client: PoolClient = await pool.connect();
  try {
    const result: QueryResult<PendingInstance> = await client.query(
      `
        SELECT business_id, process_code, raw_data, process_instance_id
        FROM approval_instances
        WHERE NOT (cashier_status = 'COMPLETED' AND cashier_result = 'AGREE')
        ORDER BY update_time DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getStaleCashierAgreed(limit = 80): Promise<PendingInstance[]> {
  const client: PoolClient = await pool.connect();
  try {
    const result: QueryResult<PendingInstance> = await client.query(
      `
        SELECT business_id, process_code, raw_data, process_instance_id
        FROM approval_instances
        WHERE cashier_status = 'COMPLETED' AND cashier_result = 'AGREE'
          AND (raw_data->>'cashierStatus' IS NULL OR raw_data->>'cashierStatus' != 'COMPLETED')
        ORDER BY update_time ASC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function existsByBusinessId(businessId: string): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `SELECT 1 FROM approval_instances WHERE business_id = $1 LIMIT 1`;
    const result = await client.query(query, [businessId]);
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}
