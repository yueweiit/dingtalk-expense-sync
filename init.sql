-- 审批实例表
CREATE TABLE IF NOT EXISTS approval_instances (
    id SERIAL PRIMARY KEY,
    business_id VARCHAR(64) UNIQUE NOT NULL,
    title VARCHAR(500),
    process_code VARCHAR(64),
    process_type VARCHAR(32),
    status VARCHAR(32),
    originator_user_id VARCHAR(64),
    originator_dept_id VARCHAR(32),
    originator_dept_name VARCHAR(500),
    biz_action VARCHAR(32) DEFAULT 'NONE',
    create_time TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 出纳节点相关
    cashier_task_id VARCHAR(64),
    cashier_user_id VARCHAR(64),
    cashier_status VARCHAR(32),
    cashier_result VARCHAR(32),
    cashier_complete_time TIMESTAMP,
    flow_result VARCHAR(32),

    -- 关键表单数据
    department VARCHAR(128),
    apply_type VARCHAR(128),
    expense_type VARCHAR(128),
    region VARCHAR(128),
    operation_expense_type VARCHAR(128),
    description TEXT,
    beneficiary VARCHAR(500),
    amount DECIMAL(15,2),
    payment_terms VARCHAR(128),
    currency VARCHAR(32),
    base_currency_amount DECIMAL(15,2),
    payment_date DATE,

    -- 新增字段
    apply_date DATE,
    production_type VARCHAR(64),
    monthly_budget DECIMAL(15,2),
    monthly_budget_used DECIMAL(15,2),

    -- 钉钉详情接口用实例ID（与 business_id 不同）
    process_instance_id VARCHAR(128),

    -- 原始数据
    raw_data JSONB,

    CONSTRAINT uk_business_id UNIQUE (business_id)
);

-- 给字段加注释（PostgreSQL 标准写法）
COMMENT ON COLUMN approval_instances.id IS '主键ID';
COMMENT ON COLUMN approval_instances.business_id IS '业务ID（钉钉的businessId）';
COMMENT ON COLUMN approval_instances.process_instance_id IS '钉钉审批实例ID（GET详情接口的processInstanceId），与businessId不同';
COMMENT ON COLUMN approval_instances.title IS '审批标题';
COMMENT ON COLUMN approval_instances.process_code IS '流程CODE';
COMMENT ON COLUMN approval_instances.process_type IS '流程类型：运营支出/采购支出';
COMMENT ON COLUMN approval_instances.status IS '流程状态 RUNNING/COMPLETED/TERMINATED';
COMMENT ON COLUMN approval_instances.originator_user_id IS '发起人用户ID';
COMMENT ON COLUMN approval_instances.originator_dept_id IS '发起部门ID';
COMMENT ON COLUMN approval_instances.originator_dept_name IS '发起部门名称';
COMMENT ON COLUMN approval_instances.create_time IS '创建时间';
COMMENT ON COLUMN approval_instances.update_time IS '更新时间';

COMMENT ON COLUMN approval_instances.cashier_task_id IS '出纳节点任务ID';
COMMENT ON COLUMN approval_instances.cashier_user_id IS '出纳审批人ID';
COMMENT ON COLUMN approval_instances.cashier_status IS '出纳审批状态 RUNNING/COMPLETED/REDIRECTED/CANCELED';
COMMENT ON COLUMN approval_instances.cashier_result IS '出纳审批结果 NONE/AGREE/REJECT/REFUSE';
COMMENT ON COLUMN approval_instances.cashier_complete_time IS '出纳完成时间';
COMMENT ON COLUMN approval_instances.flow_result IS '整单结果（按tasks识别）：AGREE/REFUSE/NONE';

COMMENT ON COLUMN approval_instances.department IS '部门';
COMMENT ON COLUMN approval_instances.apply_type IS '申请类型';
COMMENT ON COLUMN approval_instances.expense_type IS '支出类型';
COMMENT ON COLUMN approval_instances.region IS '执行地区';
COMMENT ON COLUMN approval_instances.operation_expense_type IS '管理支出类型';
COMMENT ON COLUMN approval_instances.description IS '事项说明';
COMMENT ON COLUMN approval_instances.beneficiary IS '收款人';
COMMENT ON COLUMN approval_instances.amount IS '金额';
COMMENT ON COLUMN approval_instances.payment_terms IS '付款条件';
COMMENT ON COLUMN approval_instances.currency IS '币种';
COMMENT ON COLUMN approval_instances.base_currency_amount IS '本位币金额（人民币）：按提交日查 fx_rates_daily；无表数据时兜底 open.er-api latest/USD';
COMMENT ON COLUMN approval_instances.payment_date IS '付款日期';

COMMENT ON COLUMN approval_instances.apply_date IS '申请日期';
COMMENT ON COLUMN approval_instances.production_type IS '生产/非生产';
COMMENT ON COLUMN approval_instances.monthly_budget IS '本月预算金额';
COMMENT ON COLUMN approval_instances.monthly_budget_used IS '本月预算已用金额';
COMMENT ON COLUMN approval_instances.raw_data IS '原始钉钉数据JSON';

-- 索引
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_instances(status);
CREATE INDEX IF NOT EXISTS idx_cashier_status ON approval_instances(cashier_status);
CREATE INDEX IF NOT EXISTS idx_create_time ON approval_instances(create_time);
CREATE INDEX IF NOT EXISTS idx_process_type ON approval_instances(process_type);
CREATE INDEX IF NOT EXISTS idx_department ON approval_instances(department);

-- 已有库升级：补列（CREATE TABLE IF NOT EXISTS 不会改动旧表结构）
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS process_instance_id VARCHAR(128);
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS flow_result VARCHAR(32);
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS base_currency_amount DECIMAL(15,2);

COMMENT ON COLUMN approval_instances.base_currency_amount IS '本位币金额（人民币）：按提交日查 fx_rates_daily；无表数据时兜底 open.er-api latest/USD';

-- 同步游标表（用于增量拉取，服务重启后不丢进度）
CREATE TABLE IF NOT EXISTS sync_state (
    task_name VARCHAR(128) PRIMARY KEY,
    last_success_ts BIGINT NOT NULL,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE sync_state IS '同步任务游标状态表';
COMMENT ON COLUMN sync_state.task_name IS '任务名，如 process:PROC-xxx';
COMMENT ON COLUMN sync_state.last_success_ts IS '最近一次成功同步的结束时间戳(毫秒)';
COMMENT ON COLUMN sync_state.update_time IS '游标更新时间';

-- 每日汇率（USD 基准），供本位币折算与 SQL 直接关联查询
CREATE TABLE IF NOT EXISTS fx_rates_daily (
    rate_date DATE NOT NULL,
    currency VARCHAR(8) NOT NULL,
    cny_per_unit NUMERIC(24, 12) NOT NULL,
    usd_per_unit NUMERIC(24, 12),
    usd_cny NUMERIC(24, 12),
    source_url TEXT,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rate_date, currency)
);

COMMENT ON TABLE fx_rates_daily IS '每日汇率快照（基准 USD）：由定时任务写入';
COMMENT ON COLUMN fx_rates_daily.rate_date IS '牌价所属自然日（Asia/Shanghai）';
COMMENT ON COLUMN fx_rates_daily.currency IS 'ISO4217 币种代码（大写）';
COMMENT ON COLUMN fx_rates_daily.cny_per_unit IS '1 单位该币种折合多少人民币 CNY';
COMMENT ON COLUMN fx_rates_daily.usd_per_unit IS '1 USD 折合多少该币种（open.er-api rates）';
COMMENT ON COLUMN fx_rates_daily.usd_cny IS '当日快照：1 USD 折合多少 CNY';
COMMENT ON COLUMN fx_rates_daily.source_url IS '拉取地址';

CREATE INDEX IF NOT EXISTS idx_fx_rates_daily_currency_date ON fx_rates_daily (currency, rate_date DESC);