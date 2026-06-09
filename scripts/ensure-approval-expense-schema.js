/**
 * Create or update the structured approval expense schema.
 * Example: npm run db:ensure-approval-expense-schema
 */
const fs = require('fs');
const path = require('path');
const database = require('../src/database');
const logger = require('../src/logger');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await database.pool.query(sql);
  logger.info('approval expense schema is ready');
  console.log('OK: approval_expense_* schema');
  await database.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
