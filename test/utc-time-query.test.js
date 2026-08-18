const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  approvalExpenseTimeExpr,
  formatUtcDate,
  utcDateRange,
} = require('../src/utc-time.ts');

test('approval expense reporting uses the final approval completion timestamp', () => {
  assert.equal(
    approvalExpenseTimeExpr('expense'),
    'expense.approval_completed_at'
  );
});

test('weekly-report budget submissions retain their source submission timestamp', async () => {
  const source = await fs.promises.readFile(path.join(__dirname, '../src/budget-report.ts'), 'utf8');
  assert.match(source, /const BUDGET_SUBMISSION_TIME_COLUMN = `COALESCE\(source_created_at, request_date::timestamp AT TIME ZONE 'UTC'\)`/);
  assert.match(source, /\$\{budgetMonthDateFilter\}[\s\S]{0,1000}\$\{BUDGET_STATUS_FILTER\}/);
});

test('UTC date ranges include the full ending date without session timezone dependence', () => {
  assert.deepEqual(utcDateRange('2026-07-14', '2026-07-14'), {
    start: '2026-07-14T00:00:00.000Z',
    endExclusive: '2026-07-15T00:00:00.000Z',
  });
});

test('UTC date ranges cross month boundaries correctly', () => {
  assert.deepEqual(utcDateRange('2026-07-31', '2026-07-31'), {
    start: '2026-07-31T00:00:00.000Z',
    endExclusive: '2026-08-01T00:00:00.000Z',
  });
});

test('UTC date formatting does not shift an instant into the server local day', () => {
  assert.equal(
    formatUtcDate(new Date('2026-07-14T16:57:00.000Z')),
    '2026-07-14'
  );
});
