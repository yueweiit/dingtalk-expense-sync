import { pgTable, bigserial, varchar, decimal, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

/** Confirmed actual-payment facts, separate from form-entered purchase payment plans. */
export const approvalExpensePaymentEvents = pgTable('approval_expense_payment_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  businessId: varchar('business_id', { length: 64 }).notNull(),
  processInstanceId: varchar('process_instance_id', { length: 128 }),
  expenseKind: varchar('expense_kind', { length: 16 }).notNull(),
  paidAt: timestamp('paid_at', { mode: 'string', withTimezone: true }).notNull(),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  baseCurrencyAmount: decimal('base_currency_amount', { precision: 18, scale: 2 }),
  currency: varchar('currency', { length: 32 }),
  sourceType: varchar('source_type', { length: 32 }).notNull(),
  ruleVersion: varchar('rule_version', { length: 64 }),
  sourceUserId: varchar('source_user_id', { length: 128 }),
  sourceHash: varchar('source_hash', { length: 64 }).notNull(),
  evidenceText: text('evidence_text').notNull(),
  rawData: jsonb('raw_data'),
  status: varchar('status', { length: 32 }).notNull().default('confirmed'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uk_payment_event_source').on(table.businessId, table.paidAt, table.sourceHash),
  index('idx_payment_event_business_status').on(table.businessId, table.status),
  index('idx_payment_event_paid_at').on(table.paidAt),
]);
