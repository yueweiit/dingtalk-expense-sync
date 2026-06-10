import { PoolClient, QueryResult } from 'pg';
import { pool } from './pool.js';
import { FxRateRow, FxRateResult } from './types.js';

export async function ensureFxRatesDailyTable(): Promise<void> {
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

export async function countFxRatesForDate(rateDateStr: string): Promise<number> {
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

export async function replaceFxRatesForDate(rateDateStr: string, rows: FxRateRow[], sourceUrl: string | null): Promise<void> {
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

export async function getLatestFxRate(isoUpper: string, rateDateStr: string | null = null): Promise<FxRateResult | null> {
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

export async function getCnyPerUnitForSubmissionDate(isoUpper: string, submissionDateYmd: string): Promise<number | null> {
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
