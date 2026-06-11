import { pgTable, bigserial, bigint, integer, varchar, text, decimal, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { approvalExpensePurchase } from './expense-purchase.js';

export const approvalExpensePurchaseItems = pgTable('approval_expense_purchase_items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  purchaseId: bigint('purchase_id', { mode: 'number' }).notNull().references(() => approvalExpensePurchase.id, { onDelete: 'cascade' }),
  rowNo: integer('row_no').default(1),
  itemName: varchar('item_name', { length: 500 }),
  imageUrl: text('image_url'),
  itemCode: varchar('item_code', { length: 128 }),
  itemSpecification: text('item_specification'),
  quantity: decimal('quantity', { precision: 18, scale: 4 }),
  inventory: decimal('inventory', { precision: 18, scale: 4 }),
  unit: varchar('unit', { length: 64 }),
  unitPrice: decimal('unit_price', { precision: 18, scale: 4 }),
  totalAmount: decimal('total_amount', { precision: 18, scale: 2 }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_approval_expense_purchase_items_purchase_id').on(table.purchaseId),
]);
