import { desc, eq, sql } from 'drizzle-orm';
import { db } from './pool.ts';
import { fxRatesDaily } from './schema/index.ts';
import { FxRateRow, FxRateResult } from './types.ts';

export async function ensureFxRatesDailyTable(): Promise<void> {
  await db.execute(sql`
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
  await db.execute(sql`COMMENT ON TABLE fx_rates_daily IS '每日汇率快照（基准 USD）：由定时任务写入，供本位币折算与 SQL 查询'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.rate_date IS '牌价所属自然日（Asia/Shanghai）'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.currency IS 'ISO4217 币种代码（大写）'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.cny_per_unit IS '1 单位该币种折合多少人民币 CNY'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.usd_per_unit IS 'open.er-api rates：1 USD 折合多少该币种'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.usd_cny IS '当日快照：1 USD 折合多少 CNY'`);
  await db.execute(sql`COMMENT ON COLUMN fx_rates_daily.source_url IS '拉取地址'`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_fx_rates_daily_currency_date
    ON fx_rates_daily (currency, rate_date DESC)
  `);
}

export async function countFxRatesForDate(rateDateStr: string): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(fxRatesDaily)
    .where(sql`${fxRatesDaily.rateDate} = ${rateDateStr}::date`);

  return Number(rows[0]?.c || 0);
}

export async function replaceFxRatesForDate(rateDateStr: string, rows: FxRateRow[], sourceUrl: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(fxRatesDaily).where(sql`${fxRatesDaily.rateDate} = ${rateDateStr}::date`);
    for (const row of rows) {
      await tx.insert(fxRatesDaily).values({
        rateDate: sql`${rateDateStr}::date`,
        currency: row.currency,
        cnyPerUnit: String(row.cny_per_unit),
        usdPerUnit: String(row.usd_per_unit),
        usdCny: String(row.usd_cny),
        sourceUrl: sourceUrl || null
      });
    }
  });
}

export async function getLatestFxRate(isoUpper: string, rateDateStr: string | null = null): Promise<FxRateResult | null> {
  const upperCurrency = String(isoUpper).toUpperCase();
  const rows = await db
    .select({
      rate_date: sql<string>`${fxRatesDaily.rateDate}::text`,
      currency: fxRatesDaily.currency,
      cny_per_unit: sql<string>`${fxRatesDaily.cnyPerUnit}::text`,
      usd_per_unit: sql<string | null>`${fxRatesDaily.usdPerUnit}::text`,
      usd_cny: sql<string | null>`${fxRatesDaily.usdCny}::text`,
      source_url: fxRatesDaily.sourceUrl,
      fetched_at: sql<string>`${fxRatesDaily.fetchedAt}`
    })
    .from(fxRatesDaily)
    .where(
      rateDateStr
        ? sql`${fxRatesDaily.currency} = ${upperCurrency} AND ${fxRatesDaily.rateDate} <= ${rateDateStr}::date`
        : eq(fxRatesDaily.currency, upperCurrency)
    )
    .orderBy(desc(fxRatesDaily.rateDate))
    .limit(1);

  if (!rows.length) {
    return null;
  }
  const row = rows[0];
  return {
    rate_date: row.rate_date,
    currency: row.currency,
    cny_per_unit: Number.parseFloat(row.cny_per_unit),
    usd_per_unit: row.usd_per_unit == null ? null : Number.parseFloat(row.usd_per_unit),
    usd_cny: row.usd_cny == null ? null : Number.parseFloat(row.usd_cny),
    source_url: row.source_url,
    fetched_at: row.fetched_at
  };
}

export async function getCnyPerUnitForSubmissionDate(isoUpper: string, submissionDateYmd: string): Promise<number | null> {
  const rows = await db
    .select({ cny_per_unit: fxRatesDaily.cnyPerUnit })
    .from(fxRatesDaily)
    .where(sql`${fxRatesDaily.currency} = ${String(isoUpper).toUpperCase()} AND ${fxRatesDaily.rateDate} <= ${submissionDateYmd}::date`)
    .orderBy(desc(fxRatesDaily.rateDate))
    .limit(1);

  if (!rows.length) {
    return null;
  }
  const v = rows[0].cny_per_unit;
  return typeof v === 'number' ? v : Number.parseFloat(v);
}
