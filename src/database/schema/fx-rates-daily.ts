import { pgTable, date, varchar, decimal, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const fxRatesDaily = pgTable('fx_rates_daily', {
  rateDate: date('rate_date', { mode: 'string' }).notNull(),
  currency: varchar('currency', { length: 8 }).notNull(),
  cnyPerUnit: decimal('cny_per_unit', { precision: 24, scale: 12 }).notNull(),
  usdPerUnit: decimal('usd_per_unit', { precision: 24, scale: 12 }),
  usdCny: decimal('usd_cny', { precision: 24, scale: 12 }),
  sourceUrl: text('source_url'),
  fetchedAt: timestamp('fetched_at', { mode: 'string' }).defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.rateDate, table.currency] }),
  index('idx_fx_rates_daily_currency_date').on(table.currency, table.rateDate),
]);
