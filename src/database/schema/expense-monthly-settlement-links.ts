import { pgTable, bigserial, bigint, varchar, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { approvalExpenseMonthlySettlement } from './expense-monthly-settlement-main.ts';

export const approvalExpenseMonthlySettlementLinks = pgTable('approval_expense_monthly_settlement_links', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  settlementId: bigint('settlement_id', { mode: 'number' }).notNull().references(() => approvalExpenseMonthlySettlement.id, { onDelete: 'cascade' }),
  linkedBusinessId: varchar('linked_business_id', { length: 64 }).notNull(),
  linkedProcessInstanceId: varchar('linked_process_instance_id', { length: 128 }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uk_monthly_settlement_link').on(table.settlementId, table.linkedBusinessId),
  index('idx_monthly_settlement_link_business').on(table.linkedBusinessId),
]);
