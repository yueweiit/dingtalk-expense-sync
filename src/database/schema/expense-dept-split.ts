import { pgTable, bigserial, varchar, decimal, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const approvalExpenseDeptSplit = pgTable('approval_expense_dept_split', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  businessId: varchar('business_id', { length: 64 }).notNull(),
  splitType: varchar('split_type', { length: 32 }).notNull(),
  department: varchar('department', { length: 500 }).notNull(),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uk_dept_split_biz_type_dept').on(
    table.businessId, table.splitType, table.department
  ),
  index('idx_dept_split_biz').on(table.businessId),
  index('idx_dept_split_type_dept').on(table.splitType, table.department),
]);
