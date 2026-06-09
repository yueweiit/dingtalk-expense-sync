import { Pool, PoolClient, QueryResult } from 'pg';
import fs from 'fs';
import path from 'path';
import config from './config.js';

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', (err: Error) => {
  console.error('数据库连接池错误:', err);
});

interface ApprovalInstanceData {
  businessId: string;
  title?: string;
  processCode?: string;
  processType?: string;
  status?: string;
  originatorUserId?: string;
  originatorDeptId?: string;
  originatorDeptName?: string;
  bizAction?: string;
  createTime?: string;
  cashierTaskId?: string;
  cashierUserId?: string;
  cashierStatus?: string;
  cashierResult?: string;
  cashierCompleteTime?: string;
  flowResult?: string;
  department?: string;
  applyType?: string;
  expenseType?: string;
  region?: string;
  operationExpenseType?: string;
  description?: string;
  beneficiary?: string;
  amount?: number;
  paymentTerms?: string;
  currency?: string;
  baseCurrencyAmount?: number;
  paymentDate?: string;
  applyDate?: string;
  productionType?: string;
  monthlyBudget?: number;
  monthlyBudgetUsed?: number;
  processInstanceId?: string;
  rawData?: Record<string, unknown>;
}

interface OperationExpenseData {
  processInstanceId?: string | null;
  businessId: string;
  requestDate?: string | null;
  applicantDepartment?: string | null;
  productionType?: string | null;
  monthlyBudgetAmount?: number | null;
  monthlyBudgetUsedAmount?: number | null;
  applicationType?: string | null;
  expenseType?: string | null;
  executionRegion?: string | null;
  operationExpense?: string | null;
  employeeBenefitsExpense?: string | null;
  bonusExpense?: string | null;
  salaryExpense?: string | null;
  administrativeExpense?: string | null;
  vehicleUsageExpense?: string | null;
  taxExpense?: string | null;
  financeRelatedExpense?: string | null;
  salesExpense?: string | null;
  salesChannelCommissionExpense?: string | null;
  salesTeamCustomerServiceExpense?: string | null;
  otherSalesRelatedExpense?: string | null;
  marketingAdvertisingExpense?: string | null;
  matterDescription?: string | null;
  beneficiary?: string | null;
  amount?: number | null;
  baseCurrencyAmount?: number | null;
  paymentTerms?: string | null;
  currency?: string | null;
  paymentDate?: string | null;
  keyVoucher?: string | null;
  approvalCompletedAt?: string | null;
  approvalStatus?: string | null;
  currentNode?: string | null;
  currentOwner?: string | null;
  historicalApprovers?: string | null;
  approvalNo?: string | null;
  creatorName?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  creatorDepartment?: string | null;
  rawData?: Record<string, unknown>;
}

interface PurchaseExpenseData {
  processInstanceId?: string | null;
  businessId: string;
  requestDate?: string | null;
  applicantDepartment?: string | null;
  productionType?: string | null;
  monthlyBudgetAmount?: number | null;
  monthlyBudgetUsedAmount?: number | null;
  purchaseExpense?: string | null;
  orderName?: string | null;
  projectName?: string | null;
  productName?: string | null;
  ywOemImlPhoneCase?: string | null;
  ywOemPhoneCase?: string | null;
  ywOemTabletCase?: string | null;
  ywOemSupport?: string | null;
  ywMoldesOdm?: string | null;
  consultingServices?: string | null;
  tiktokOnlineStore?: string | null;
  executionRegion?: string | null;
  orderPurchase?: string | null;
  expenseClassification?: string | null;
  investmentPurchase?: string | null;
  servicePurchase?: string | null;
  mroClassification?: string | null;
  productiveMro?: string | null;
  nonProductiveMro?: string | null;
  pdsClassification?: string | null;
  pieceworkOutsourcing?: string | null;
  logisticsTransportService?: string | null;
  customsClearanceService?: string | null;
  detailSummaryAmount?: number | null;
  baseCurrencyAmount?: number | null;
  keyVoucher?: string | null;
  approvalCompletedAt?: string | null;
  approvalStatus?: string | null;
  currentNode?: string | null;
  currentOwner?: string | null;
  historicalApprovers?: string | null;
  approvalNo?: string | null;
  creatorName?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  creatorDepartment?: string | null;
  rawData?: Record<string, unknown>;
}

interface PurchaseItemData {
  rowNo?: number;
  itemName?: string;
  imageUrl?: string;
  itemCode?: string;
  itemSpecification?: string;
  quantity?: number;
  inventory?: number;
  unit?: string;
  unitPrice?: number;
  totalAmount?: number;
  rawData?: Record<string, unknown>;
}

interface PurchaseProcessorData {
  rowNo?: number;
  processorName?: string;
  processorPhone?: string;
  odt?: string;
  salesOrderNo?: string;
  processingMaterial?: string;
  quantity?: number;
  unitPrice?: number;
  totalAmount?: number;
  specificationRequirementDescription?: string;
  deliveryDate?: string;
  rawData?: Record<string, unknown>;
}

interface PurchasePaymentData {
  rowNo?: number;
  beneficiary?: string;
  amount?: number;
  paymentTerms?: string;
  currency?: string;
  paymentDate?: string;
  rawData?: Record<string, unknown>;
}

interface AttachmentData {
  rowNo?: number;
  attachmentType?: string;
  fileName?: string;
  fileUrl?: string;
  rawData?: Record<string, unknown> | unknown;
}

interface FxRateRow {
  currency: string;
  cny_per_unit: number;
  usd_per_unit: number;
  usd_cny: number;
}

interface FxRateResult {
  rate_date: string;
  currency: string;
  cny_per_unit: number;
  usd_per_unit: number | null;
  usd_cny: number | null;
  source_url: string | null;
  fetched_at: string;
}

interface PendingInstance {
  business_id: string;
  process_code: string;
  raw_data: Record<string, unknown>;
  process_instance_id: string | null;
}

interface ExpenseInstanceRow {
  expense_type: string;
  business_id: string;
  process_instance_id: string | null;
  raw_data: Record<string, unknown>;
  process_code: string;
  updated_at: string;
}

class Database {
  async ensureProcessInstanceIdColumn(): Promise<void> {
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

  async ensureBaseCurrencyAmountColumn(): Promise<void> {
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

  async ensureSyncStateTable(): Promise<void> {
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

  async ensureApprovalExpenseSchema(): Promise<void> {
    const sqlPath = path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }

  async getSyncCursor(taskName: string): Promise<number | null> {
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

  async setSyncCursor(taskName: string, timestampMs: number): Promise<void> {
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

  // 插入或更新审批实例
  async upsertApprovalInstance(data: ApprovalInstanceData): Promise<boolean> {
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
          process_instance_id = COALESCE(EXCLUDED.process_instance_id, approval_instances.process_instance_id),
          raw_data = EXCLUDED.raw_data,
          update_time = CURRENT_TIMESTAMP
      `;

      await client.query(query, [
        data.businessId,
        data.title?.substring(0, 500) || null,
        data.processCode?.substring(0, 64) || null,
        data.processType?.substring(0, 32) || null,
        data.status?.substring(0, 32) || null,
        data.originatorUserId?.substring(0, 64) || null,
        data.originatorDeptId?.substring(0, 32) || null,
        data.originatorDeptName?.substring(0, 500) || null,
        data.bizAction?.substring(0, 32) || 'NONE',
        data.createTime,
        data.cashierTaskId?.substring(0, 64) || null,
        data.cashierUserId?.substring(0, 64) || null,
        data.cashierStatus?.substring(0, 32) || null,
        data.cashierResult?.substring(0, 32) || null,
        data.cashierCompleteTime || null,
        data.flowResult?.substring(0, 32) || 'NONE',
        data.department?.substring(0, 128) || null,
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

  // 检查出纳是否已同意（COMPLETED + APPROVE）
  async isCashierApproved(businessId: string): Promise<boolean> {
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

  // 获取最后更新时间
  async getLastUpdateTime(): Promise<string | null> {
    const client: PoolClient = await pool.connect();
    try {
      const query = `SELECT MAX(update_time) as last_update FROM approval_instances`;
      const result: QueryResult<{ last_update: string | null }> = await client.query(query);
      return result.rows[0]?.last_update || null;
    } finally {
      client.release();
    }
  }

  async getPendingInstances(limit = 500): Promise<PendingInstance[]> {
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

  /** 出纳已是 AGREE 但可能曾被错误跳过未更新 raw_data：按最久未更新时间抽样拉回钉钉刷新 */
  async getStaleCashierAgreed(limit = 80): Promise<PendingInstance[]> {
    if (!limit || limit <= 0) {
      return [];
    }
    const client: PoolClient = await pool.connect();
    try {
      const result: QueryResult<PendingInstance> = await client.query(
        `
          SELECT business_id, process_code, raw_data, process_instance_id
          FROM approval_instances
          WHERE cashier_status = 'COMPLETED' AND cashier_result = 'AGREE'
          ORDER BY update_time ASC NULLS FIRST
          LIMIT $1
        `,
        [limit]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  getCashierActivityIdsForSql(): string[] {
    const map = config.dingtalk?.cashierActivityIdsByProcessCode;
    const ids: string[] = [];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const value of Object.values(map)) {
        if (Array.isArray(value)) {
          ids.push(...value);
        }
      }
    }
    if (Array.isArray(config.dingtalk?.cashierActivityIds)) {
      ids.push(...config.dingtalk.cashierActivityIds);
    }
    if (ids.length === 0) {
      ids.push('1793_35c3');
    }
    return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  }

  expenseInstanceUnionSql(whereSql: string): string {
    return `
      SELECT *
      FROM (
        SELECT
          'operation' AS expense_type,
          business_id,
          process_instance_id,
          raw_data,
          raw_data->>'processCode' AS process_code,
          updated_at
        FROM approval_expense_operation
        WHERE business_id IS NOT NULL
        UNION ALL
        SELECT
          'purchase' AS expense_type,
          business_id,
          process_instance_id,
          raw_data,
          raw_data->>'processCode' AS process_code,
          updated_at
        FROM approval_expense_purchase
        WHERE business_id IS NOT NULL
      ) AS e
      WHERE ${whereSql}
    `;
  }

  async getPendingExpenseInstances(limit = 500): Promise<ExpenseInstanceRow[]> {
    const client: PoolClient = await pool.connect();
    try {
      const cashierActivityIds = this.getCashierActivityIdsForSql();
      const result: QueryResult<ExpenseInstanceRow> = await client.query(
        `
          ${this.expenseInstanceUnionSql(`
            NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
              WHERE ($2::text[] IS NULL OR t->>'activityId' = ANY($2::text[]))
                AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
                AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
            )
          `)}
          ORDER BY updated_at DESC NULLS LAST
          LIMIT $1
        `,
        [limit, cashierActivityIds]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getStaleExpenseAgreed(limit = 80): Promise<ExpenseInstanceRow[]> {
    if (!limit || limit <= 0) {
      return [];
    }
    const client: PoolClient = await pool.connect();
    try {
      const cashierActivityIds = this.getCashierActivityIdsForSql();
      const result: QueryResult<ExpenseInstanceRow> = await client.query(
        `
          ${this.expenseInstanceUnionSql(`
            EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
              WHERE ($2::text[] IS NULL OR t->>'activityId' = ANY($2::text[]))
                AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
                AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
            )
          `)}
          ORDER BY updated_at ASC NULLS FIRST
          LIMIT $1
        `,
        [limit, cashierActivityIds]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async ensureFxRatesDailyTable(): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS fx_rates_daily (
          rate_date DATE NOT NULL,
          currency VARCHAR(8) NOT NULL,
          cny_per_unit NUMERIC(24, 12) NOT NULL,
          usd_per_unit NUMERIC(24, 12),
          usd_cny NUMERIC(24, 12),
          source_url TEXT,
          fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (rate_date, currency)
        )
      `);
      await client.query(`COMMENT ON TABLE fx_rates_daily IS '每日汇率快照（基准 USD）：由定时任务写入，供本位币折算与 SQL 查询'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.rate_date IS '牌价所属自然日（Asia/Shanghai）'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.currency IS 'ISO4217 币种代码（大写）'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.cny_per_unit IS '1 单位该币种折合多少人民币 CNY'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.usd_per_unit IS 'open.er-api rates：1 USD 折合多少该币种'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.usd_cny IS '当日快照：1 USD 折合多少 CNY'`);
      await client.query(`COMMENT ON COLUMN fx_rates_daily.source_url IS '拉取地址'`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_fx_rates_daily_currency_date
        ON fx_rates_daily (currency, rate_date DESC)
      `);
    } finally {
      client.release();
    }
  }

  async countFxRatesForDate(rateDateStr: string): Promise<number> {
    const client: PoolClient = await pool.connect();
    try {
      const r: QueryResult<{ c: number }> = await client.query(
        `SELECT COUNT(*)::int AS c FROM fx_rates_daily WHERE rate_date = $1::date`,
        [rateDateStr]
      );
      return Number(r.rows[0]?.c || 0);
    } finally {
      client.release();
    }
  }

  /**
   * 覆盖写入某日全量币种行（先删后插）。
   */
  async replaceFxRatesForDate(rateDateStr: string, rows: FxRateRow[], sourceUrl: string | null): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM fx_rates_daily WHERE rate_date = $1::date`, [rateDateStr]);
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO fx_rates_daily (rate_date, currency, cny_per_unit, usd_per_unit, usd_cny, source_url)
            VALUES ($1::date, $2, $3, $4, $5, $6)
          `,
          [rateDateStr, row.currency, row.cny_per_unit, row.usd_per_unit, row.usd_cny, sourceUrl || null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async getLatestFxRate(isoUpper: string, rateDateStr: string | null = null): Promise<FxRateResult | null> {
    const client: PoolClient = await pool.connect();
    try {
      const params: unknown[] = [String(isoUpper).toUpperCase()];
      let whereDate = '';
      if (rateDateStr) {
        params.push(rateDateStr);
        whereDate = 'AND rate_date <= $2::date';
      }
      const r: QueryResult<{
        rate_date: string;
        currency: string;
        cny_per_unit: string;
        usd_per_unit: string | null;
        usd_cny: string | null;
        source_url: string | null;
        fetched_at: string;
      }> = await client.query(
        `
          SELECT rate_date::text AS rate_date,
                 currency,
                 cny_per_unit::text AS cny_per_unit,
                 usd_per_unit::text AS usd_per_unit,
                 usd_cny::text AS usd_cny,
                 source_url,
                 fetched_at
          FROM fx_rates_daily
          WHERE currency = $1 ${whereDate}
          ORDER BY rate_date DESC
          LIMIT 1
        `,
        params
      );
      if (!r.rows.length) {
        return null;
      }
      const row = r.rows[0];
      return {
        rate_date: row.rate_date,
        currency: row.currency,
        cny_per_unit: Number.parseFloat(row.cny_per_unit),
        usd_per_unit: row.usd_per_unit == null ? null : Number.parseFloat(row.usd_per_unit),
        usd_cny: row.usd_cny == null ? null : Number.parseFloat(row.usd_cny),
        source_url: row.source_url,
        fetched_at: row.fetched_at
      };
    } finally {
      client.release();
    }
  }

  /**
   * 取「提交日」可用的 cny_per_unit：优先 rate_date <= 提交日 的最新一条（节假日可沿用上一交易日）。
   */
  async getCnyPerUnitForSubmissionDate(isoUpper: string, submissionDateYmd: string): Promise<number | null> {
    const client: PoolClient = await pool.connect();
    try {
      const r: QueryResult<{ cny_per_unit: string | number }> = await client.query(
        `
          SELECT cny_per_unit
          FROM fx_rates_daily
          WHERE currency = $1 AND rate_date <= $2::date
          ORDER BY rate_date DESC
          LIMIT 1
        `,
        [String(isoUpper).toUpperCase(), submissionDateYmd]
      );
      if (!r.rows.length) {
        return null;
      }
      const v = r.rows[0].cny_per_unit;
      return typeof v === 'number' ? v : Number.parseFloat(v);
    } finally {
      client.release();
    }
  }

  // ==================== approval_expense_* 表操作 ====================

  async upsertOperationExpense(data: OperationExpenseData): Promise<number | undefined> {
    const client: PoolClient = await pool.connect();
    try {
      const query = `
        INSERT INTO approval_expense_operation (
          process_instance_id, business_id, request_date, applicant_department,
          production_type, monthly_budget_amount, monthly_budget_used_amount,
          application_type, expense_type, execution_region,
          operation_expense, employee_benefits_expense, bonus_expense, salary_expense,
          administrative_expense, vehicle_usage_expense, tax_expense, finance_related_expense,
          sales_expense, sales_channel_commission_expense, sales_team_customer_service_expense,
          other_sales_related_expense, marketing_advertising_expense,
          matter_description, beneficiary, amount, base_currency_amount, payment_terms, currency, payment_date, key_voucher,
          approval_completed_at, approval_status, current_node, current_owner,
          historical_approvers, approval_no, creator_name,
          source_created_at, source_updated_at, creator_department,
          raw_data
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
        )
        ON CONFLICT (business_id) WHERE business_id IS NOT NULL DO UPDATE SET
          process_instance_id = COALESCE(EXCLUDED.process_instance_id, approval_expense_operation.process_instance_id),
          request_date = EXCLUDED.request_date,
          applicant_department = EXCLUDED.applicant_department,
          production_type = EXCLUDED.production_type,
          monthly_budget_amount = EXCLUDED.monthly_budget_amount,
          monthly_budget_used_amount = EXCLUDED.monthly_budget_used_amount,
          application_type = EXCLUDED.application_type,
          expense_type = EXCLUDED.expense_type,
          execution_region = EXCLUDED.execution_region,
          operation_expense = EXCLUDED.operation_expense,
          employee_benefits_expense = EXCLUDED.employee_benefits_expense,
          bonus_expense = EXCLUDED.bonus_expense,
          salary_expense = EXCLUDED.salary_expense,
          administrative_expense = EXCLUDED.administrative_expense,
          vehicle_usage_expense = EXCLUDED.vehicle_usage_expense,
          tax_expense = EXCLUDED.tax_expense,
          finance_related_expense = EXCLUDED.finance_related_expense,
          sales_expense = EXCLUDED.sales_expense,
          sales_channel_commission_expense = EXCLUDED.sales_channel_commission_expense,
          sales_team_customer_service_expense = EXCLUDED.sales_team_customer_service_expense,
          other_sales_related_expense = EXCLUDED.other_sales_related_expense,
          marketing_advertising_expense = EXCLUDED.marketing_advertising_expense,
          matter_description = EXCLUDED.matter_description,
          beneficiary = EXCLUDED.beneficiary,
          amount = EXCLUDED.amount,
          base_currency_amount = EXCLUDED.base_currency_amount,
          payment_terms = EXCLUDED.payment_terms,
          currency = EXCLUDED.currency,
          payment_date = EXCLUDED.payment_date,
          key_voucher = EXCLUDED.key_voucher,
          approval_completed_at = EXCLUDED.approval_completed_at,
          approval_status = EXCLUDED.approval_status,
          current_node = EXCLUDED.current_node,
          current_owner = EXCLUDED.current_owner,
          historical_approvers = EXCLUDED.historical_approvers,
          approval_no = EXCLUDED.approval_no,
          creator_name = EXCLUDED.creator_name,
          source_created_at = EXCLUDED.source_created_at,
          source_updated_at = EXCLUDED.source_updated_at,
          creator_department = EXCLUDED.creator_department,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `;
      const result: QueryResult<{ id: number }> = await client.query(query, [
        data.processInstanceId?.substring(0, 128) || null,
        data.businessId,
        data.requestDate || null,
        data.applicantDepartment?.substring(0, 500) || null,
        data.productionType?.substring(0, 64) || null,
        data.monthlyBudgetAmount ?? null,
        data.monthlyBudgetUsedAmount ?? null,
        data.applicationType?.substring(0, 128) || null,
        data.expenseType?.substring(0, 128) || null,
        data.executionRegion?.substring(0, 128) || null,
        data.operationExpense?.substring(0, 128) || null,
        data.employeeBenefitsExpense?.substring(0, 128) || null,
        data.bonusExpense?.substring(0, 128) || null,
        data.salaryExpense?.substring(0, 128) || null,
        data.administrativeExpense?.substring(0, 128) || null,
        data.vehicleUsageExpense?.substring(0, 128) || null,
        data.taxExpense?.substring(0, 128) || null,
        data.financeRelatedExpense?.substring(0, 128) || null,
        data.salesExpense?.substring(0, 128) || null,
        data.salesChannelCommissionExpense?.substring(0, 128) || null,
        data.salesTeamCustomerServiceExpense?.substring(0, 128) || null,
        data.otherSalesRelatedExpense?.substring(0, 128) || null,
        data.marketingAdvertisingExpense?.substring(0, 128) || null,
        data.matterDescription?.substring(0, 5000) || null,
        data.beneficiary?.substring(0, 500) || null,
        data.amount ?? null,
        data.baseCurrencyAmount ?? null,
        data.paymentTerms?.substring(0, 255) || null,
        data.currency?.substring(0, 32) || null,
        data.paymentDate || null,
        data.keyVoucher || null,
        data.approvalCompletedAt || null,
        data.approvalStatus?.substring(0, 64) || null,
        data.currentNode?.substring(0, 255) || null,
        data.currentOwner?.substring(0, 500) || null,
        data.historicalApprovers || null,
        data.approvalNo?.substring(0, 128) || null,
        data.creatorName?.substring(0, 255) || null,
        data.sourceCreatedAt || null,
        data.sourceUpdatedAt || null,
        data.creatorDepartment?.substring(0, 500) || null,
        JSON.stringify(data.rawData || {})
      ]);
      return result.rows[0]?.id;
    } finally {
      client.release();
    }
  }

  async upsertPurchaseExpense(data: PurchaseExpenseData): Promise<number | undefined> {
    const client: PoolClient = await pool.connect();
    try {
      const query = `
        INSERT INTO approval_expense_purchase (
          process_instance_id, business_id, request_date, applicant_department,
          production_type, monthly_budget_amount, monthly_budget_used_amount,
          purchase_expense, order_name, project_name, product_name,
          yw_oem_iml_phone_case, yw_oem_phone_case, yw_oem_tablet_case, yw_oem_support,
          yw_moldes_odm, consulting_services, tiktok_online_store,
          execution_region, order_purchase, expense_classification,
          investment_purchase, service_purchase, mro_classification,
          productive_mro, non_productive_mro, pds_classification,
          piecework_outsourcing, logistics_transport_service, customs_clearance_service,
          detail_summary_amount, base_currency_amount, key_voucher,
          approval_completed_at, approval_status, current_node, current_owner,
          historical_approvers, approval_no, creator_name,
          source_created_at, source_updated_at, creator_department,
          raw_data
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44
        )
        ON CONFLICT (business_id) WHERE business_id IS NOT NULL DO UPDATE SET
          process_instance_id = COALESCE(EXCLUDED.process_instance_id, approval_expense_purchase.process_instance_id),
          request_date = EXCLUDED.request_date,
          applicant_department = EXCLUDED.applicant_department,
          production_type = EXCLUDED.production_type,
          monthly_budget_amount = EXCLUDED.monthly_budget_amount,
          monthly_budget_used_amount = EXCLUDED.monthly_budget_used_amount,
          purchase_expense = EXCLUDED.purchase_expense,
          order_name = EXCLUDED.order_name,
          project_name = EXCLUDED.project_name,
          product_name = EXCLUDED.product_name,
          yw_oem_iml_phone_case = EXCLUDED.yw_oem_iml_phone_case,
          yw_oem_phone_case = EXCLUDED.yw_oem_phone_case,
          yw_oem_tablet_case = EXCLUDED.yw_oem_tablet_case,
          yw_oem_support = EXCLUDED.yw_oem_support,
          yw_moldes_odm = EXCLUDED.yw_moldes_odm,
          consulting_services = EXCLUDED.consulting_services,
          tiktok_online_store = EXCLUDED.tiktok_online_store,
          execution_region = EXCLUDED.execution_region,
          order_purchase = EXCLUDED.order_purchase,
          expense_classification = EXCLUDED.expense_classification,
          investment_purchase = EXCLUDED.investment_purchase,
          service_purchase = EXCLUDED.service_purchase,
          mro_classification = EXCLUDED.mro_classification,
          productive_mro = EXCLUDED.productive_mro,
          non_productive_mro = EXCLUDED.non_productive_mro,
          pds_classification = EXCLUDED.pds_classification,
          piecework_outsourcing = EXCLUDED.piecework_outsourcing,
          logistics_transport_service = EXCLUDED.logistics_transport_service,
          customs_clearance_service = EXCLUDED.customs_clearance_service,
          detail_summary_amount = EXCLUDED.detail_summary_amount,
          base_currency_amount = EXCLUDED.base_currency_amount,
          key_voucher = EXCLUDED.key_voucher,
          approval_completed_at = EXCLUDED.approval_completed_at,
          approval_status = EXCLUDED.approval_status,
          current_node = EXCLUDED.current_node,
          current_owner = EXCLUDED.current_owner,
          historical_approvers = EXCLUDED.historical_approvers,
          approval_no = EXCLUDED.approval_no,
          creator_name = EXCLUDED.creator_name,
          source_created_at = EXCLUDED.source_created_at,
          source_updated_at = EXCLUDED.source_updated_at,
          creator_department = EXCLUDED.creator_department,
          raw_data = EXCLUDED.raw_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `;
      const result: QueryResult<{ id: number }> = await client.query(query, [
        data.processInstanceId?.substring(0, 128) || null,
        data.businessId,
        data.requestDate || null,
        data.applicantDepartment?.substring(0, 500) || null,
        data.productionType?.substring(0, 64) || null,
        data.monthlyBudgetAmount ?? null,
        data.monthlyBudgetUsedAmount ?? null,
        data.purchaseExpense?.substring(0, 128) || null,
        data.orderName?.substring(0, 255) || null,
        data.projectName?.substring(0, 255) || null,
        data.productName?.substring(0, 255) || null,
        data.ywOemImlPhoneCase?.substring(0, 128) || null,
        data.ywOemPhoneCase?.substring(0, 128) || null,
        data.ywOemTabletCase?.substring(0, 128) || null,
        data.ywOemSupport?.substring(0, 128) || null,
        data.ywMoldesOdm?.substring(0, 128) || null,
        data.consultingServices?.substring(0, 128) || null,
        data.tiktokOnlineStore?.substring(0, 128) || null,
        data.executionRegion?.substring(0, 128) || null,
        data.orderPurchase?.substring(0, 128) || null,
        data.expenseClassification?.substring(0, 255) || null,
        data.investmentPurchase?.substring(0, 128) || null,
        data.servicePurchase?.substring(0, 128) || null,
        data.mroClassification?.substring(0, 128) || null,
        data.productiveMro?.substring(0, 128) || null,
        data.nonProductiveMro?.substring(0, 128) || null,
        data.pdsClassification?.substring(0, 128) || null,
        data.pieceworkOutsourcing?.substring(0, 128) || null,
        data.logisticsTransportService?.substring(0, 128) || null,
        data.customsClearanceService?.substring(0, 128) || null,
        data.detailSummaryAmount ?? null,
        data.baseCurrencyAmount ?? null,
        data.keyVoucher || null,
        data.approvalCompletedAt || null,
        data.approvalStatus?.substring(0, 64) || null,
        data.currentNode?.substring(0, 255) || null,
        data.currentOwner?.substring(0, 500) || null,
        data.historicalApprovers || null,
        data.approvalNo?.substring(0, 128) || null,
        data.creatorName?.substring(0, 255) || null,
        data.sourceCreatedAt || null,
        data.sourceUpdatedAt || null,
        data.creatorDepartment?.substring(0, 500) || null,
        JSON.stringify(data.rawData || {})
      ]);
      return result.rows[0]?.id;
    } finally {
      client.release();
    }
  }

  async replacePurchaseItems(purchaseId: number, items: PurchaseItemData[]): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('DELETE FROM approval_expense_purchase_items WHERE purchase_id = $1', [purchaseId]);
      for (const item of items) {
        await client.query(
          `
            INSERT INTO approval_expense_purchase_items (
              purchase_id, row_no, item_name, image_url, item_code, item_specification,
              quantity, inventory, unit, unit_price, total_amount, raw_data
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
          [
            purchaseId,
            item.rowNo || 1,
            item.itemName?.substring(0, 500) || null,
            item.imageUrl || null,
            item.itemCode?.substring(0, 128) || null,
            item.itemSpecification || null,
            item.quantity ?? null,
            item.inventory ?? null,
            item.unit?.substring(0, 64) || null,
            item.unitPrice ?? null,
            item.totalAmount ?? null,
            JSON.stringify(item.rawData || {})
          ]
        );
      }
    } finally {
      client.release();
    }
  }

  async replacePurchaseProcessors(purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('DELETE FROM approval_expense_purchase_processors WHERE purchase_id = $1', [purchaseId]);
      for (const p of processors) {
        await client.query(
          `
            INSERT INTO approval_expense_purchase_processors (
              purchase_id, row_no, processor_name, processor_phone, odt,
              sales_order_no, processing_material, quantity, unit_price, total_amount,
              specification_requirement_description, delivery_date, raw_data
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13)
          `,
          [
            purchaseId,
            p.rowNo || 1,
            p.processorName?.substring(0, 500) || null,
            p.processorPhone?.substring(0, 64) || null,
            p.odt?.substring(0, 128) || null,
            p.salesOrderNo?.substring(0, 128) || null,
            p.processingMaterial || null,
            p.quantity ?? null,
            p.unitPrice ?? null,
            p.totalAmount ?? null,
            p.specificationRequirementDescription || null,
            p.deliveryDate || null,
            JSON.stringify(p.rawData || {})
          ]
        );
      }
    } finally {
      client.release();
    }
  }

  async replacePurchasePayments(purchaseId: number, payments: PurchasePaymentData[]): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('DELETE FROM approval_expense_purchase_payments WHERE purchase_id = $1', [purchaseId]);
      for (const p of payments) {
        await client.query(
          `
            INSERT INTO approval_expense_purchase_payments (
              purchase_id, row_no, beneficiary, amount, payment_terms,
              currency, payment_date, raw_data
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8)
          `,
          [
            purchaseId,
            p.rowNo || 1,
            p.beneficiary?.substring(0, 500) || null,
            p.amount ?? null,
            p.paymentTerms?.substring(0, 255) || null,
            p.currency?.substring(0, 32) || null,
            p.paymentDate || null,
            JSON.stringify(p.rawData || {})
          ]
        );
      }
    } finally {
      client.release();
    }
  }

  async replaceAttachments(parentType: string, parentId: number, attachments: AttachmentData[]): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query(
        'DELETE FROM approval_expense_attachments WHERE parent_type = $1 AND parent_id = $2',
        [parentType, parentId]
      );
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        await client.query(
          `
            INSERT INTO approval_expense_attachments (
              parent_type, parent_id, row_no, attachment_type, file_name, file_url, raw_data
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            parentType,
            parentId,
            a.rowNo || i + 1,
            a.attachmentType?.substring(0, 64) || null,
            a.fileName?.substring(0, 500) || null,
            a.fileUrl || null,
            JSON.stringify(a.rawData || {})
          ]
        );
      }
    } finally {
      client.release();
    }
  }

  // 检查business_id是否已存在
  async existsByBusinessId(businessId: string): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      const query = `SELECT 1 FROM approval_instances WHERE business_id = $1 LIMIT 1`;
      const result = await client.query(query, [businessId]);
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  // 关闭连接池
  async close(): Promise<void> {
    await pool.end();
  }
}

const db = new Database();
export default db;
export { pool };
