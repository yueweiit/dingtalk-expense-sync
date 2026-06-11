import { pgTable, bigserial, bigint, integer, varchar, decimal, date, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { approvalExpensePurchase } from './expense-purchase.ts';

export const approvalExpensePurchasePayments = pgTable('approval_expense_purchase_payments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: bigint('purchase_id', { mode: 'number' }).notNull().references(() => approvalExpensePurchase.id, { onDelete: 'cascade' }),
  rowNo: integer('row_no').default(1),
  beneficiary: varchar('beneficiary', { length: 500 }),
  amount: decimal('amount', { precision: 18, scale: 2 }),
  paymentTerms: varchar('payment_terms', { length: 255 }),
  currency: varchar('currency', { length: 32 }),
  paymentDate: date('payment_date', { mode: 'string' }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_approval_expense_purchase_payments_purchase_id').on(table.purchaseId),
  index('idx_approval_expense_purchase_payments_payment_date').on(table.paymentDate),
]);
