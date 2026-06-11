import { pgTable, varchar, bigint, timestamp } from 'drizzle-orm/pg-core';

export const syncState = pgTable('sync_state', {
  taskName: varchar('task_name', { length: 128 }).primaryKey(),
  lastSuccessTs: bigint('last_success_ts', { mode: 'number' }).notNull(),
  updateTime: timestamp('update_time', { mode: 'string' }).defaultNow(),
});
