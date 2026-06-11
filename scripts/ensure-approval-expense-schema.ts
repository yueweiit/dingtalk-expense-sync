/**
 * Create or update the structured approval expense schema.
 * Example: npm run db:ensure-approval-expense-schema
 */
import fs from 'fs';
import path from 'path';
import database, { pool } from '../src/database.ts';
import logger from '../src/logger.ts';

async function main(): Promise<void> {
  const sqlPath = path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await pool.query(sql);
  logger.info('approval expense schema is ready');
  console.log('OK: approval_expense_* schema');
  await database.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});


