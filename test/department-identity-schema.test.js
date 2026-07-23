const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql'),
  'utf8'
);

test('department split identity index is only replaced when the existing definition is outdated', () => {
  assert.doesNotMatch(schema, /^DROP INDEX IF EXISTS uk_dept_split_biz_type_dept;/m);
  assert.match(schema, /FROM pg_indexes[\s\S]*indexname = 'uk_dept_split_biz_type_dept'/);
  assert.match(schema, /index_definition NOT LIKE '%\(business_id, split_type, department_id, department\)%'/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uk_dept_split_biz_type_dept[\s\S]*department_id, department/);
});

test('expense lookup tables index the applicant department ID used by connector queries', () => {
  for (const tableName of ['approval_expense_operation', 'approval_expense_purchase']) {
    assert.match(
      schema,
      new RegExp(`CREATE INDEX IF NOT EXISTS idx_${tableName}_applicant_department_id\\s+ON ${tableName}\\(applicant_department_id\\);`)
    );
  }
});
