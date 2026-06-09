/**
 * Drop and recreate only the standalone approval_expense_* business tables.
 *
 * This does not touch approval_instances or the running sync/runtime tables.
 * Because it drops approval_expense_* data, it requires --confirm=1.
 *
 * Example:
 *   node scripts/rebuild-approval-expense-schema.js --confirm=1
 */
const fs = require('fs');
const path = require('path');
const database = require('../src/database');

function parseArgs(argv) {
  const args = {};
  for (const item of argv.slice(2)) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    args[k] = v ?? '1';
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (String(args.confirm || '') !== '1') {
    throw new Error('Refusing to drop approval_expense_* tables without --confirm=1');
  }

  const rebuildSqlPath = path.join(__dirname, '..', 'sql', 'rebuild_approval_expense_schema.sql');
  const ensureSqlPath = path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql');
  const rebuildSql = fs.readFileSync(rebuildSqlPath, 'utf8');
  const ensureSql = fs.readFileSync(ensureSqlPath, 'utf8');

  await database.pool.query('BEGIN');
  try {
    await database.pool.query(rebuildSql);
    await database.pool.query(ensureSql);
    await database.pool.query('COMMIT');
    console.log('OK: rebuilt standalone approval_expense_* schema');
  } catch (e) {
    await database.pool.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await database.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
