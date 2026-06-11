import { pgTable, bigserial, bigint, integer, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const approvalExpenseAttachments = pgTable('approval_expense_attachments', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  parentType: varchar('parent_type', { length: 32 }).notNull(),
  parentId: bigint('parent_id', { mode: 'number' }).notNull(),
  rowNo: integer('row_no').default(1),
  attachmentType: varchar('attachment_type', { length: 64 }),
  fileName: varchar('file_name', { length: 500 }),
  fileUrl: text('file_url'),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_approval_expense_attachments_parent').on(table.parentType, table.parentId),
]);
