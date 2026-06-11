import { pgTable, bigserial, bigint, integer, varchar, decimal, text, date, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { approvalExpensePurchase } from './expense-purchase.ts';

export const approvalExpensePurchaseProcessors = pgTable('approval_expense_purchase_processors', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: bigint('purchase_id', { mode: 'number' }).notNull().references(() => approvalExpensePurchase.id, { onDelete: 'cascade' }),
  rowNo: integer('row_no').default(1),
  processorName: varchar('processor_name', { length: 500 }),
  processorPhone: varchar('processor_phone', { length: 64 }),
  odt: varchar('odt', { length: 128 }),
  salesOrderNo: varchar('sales_order_no', { length: 128 }),
  processingMaterial: text('processing_material'),
  quantity: decimal('quantity', { precision: 18, scale: 4 }),
  unitPrice: decimal('unit_price', { precision: 18, scale: 4 }),
  totalAmount: decimal('total_amount', { precision: 18, scale: 2 }),
  specificationRequirementDescription: text('specification_requirement_description'),
  deliveryDate: date('delivery_date', { mode: 'string' }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_approval_expense_purchase_processors_purchase_id').on(table.purchaseId),
]);
