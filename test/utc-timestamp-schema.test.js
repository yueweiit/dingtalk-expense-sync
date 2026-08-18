const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('legacy expense timestamps migrate to timestamptz as UTC instants', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql'),
    'utf8'
  );

  for (const tableName of ['approval_expense_operation', 'approval_expense_purchase']) {
    for (const columnName of [
      'source_created_at',
      'source_updated_at',
      'approval_completed_at',
    ]) {
      assert.match(
        schema,
        new RegExp(
          `ALTER TABLE ${tableName}[\\s\\S]*?ALTER COLUMN ${columnName}\\s+TYPE TIMESTAMPTZ\\s+USING ${columnName}\\s+AT TIME ZONE 'UTC'`,
          'i'
        )
      );
    }
  }
});

test('completed expense reporting has partial completion-time indexes that match the date range predicate', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql'),
    'utf8'
  );

  assert.match(schema, /idx_approval_expense_operation_completed_at[\s\S]*approval_completed_at[\s\S]*WHERE approval_completed_at IS NOT NULL/i);
  assert.match(schema, /idx_approval_expense_purchase_completed_at[\s\S]*approval_completed_at[\s\S]*WHERE approval_completed_at IS NOT NULL/i);
});
