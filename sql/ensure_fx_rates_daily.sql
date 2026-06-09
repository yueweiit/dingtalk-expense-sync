-- 每日汇率表（可单独在 psql 中执行，与 init.sql 中定义一致）
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
