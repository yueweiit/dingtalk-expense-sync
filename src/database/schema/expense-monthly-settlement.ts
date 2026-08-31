import { pgTable, bigserial, bigint, integer, varchar, text, decimal, timestamp, date, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { approvalExpenseMonthlySettlement } from './expense-monthly-settlement-main.ts';

export const approvalExpenseMonthlySettlementDetails = pgTable('approval_expense_monthly_settlement_details', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  settlementId: bigint('settlement_id', { mode: 'number' }).notNull().references(() => approvalExpenseMonthlySettlement.id, { onDelete: 'cascade' }),
  rowNo: integer('row_no').notNull().default(1),
  paymentDate: date('payment_date', { mode: 'string' }),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  baseCurrencyAmount: decimal('base_currency_amount', { precision: 18, scale: 2 }),
  currency: varchar('currency', { length: 32 }),
  paymentReason: text('payment_reason'),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uk_monthly_settlement_detail_row').on(table.settlementId, table.rowNo),
  index('idx_monthly_settlement_detail_date').on(table.paymentDate),
]);
