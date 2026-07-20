const assert = require('node:assert/strict');
const test = require('node:test');

const {
  approvalExpenseTimeExpr,
  formatUtcDate,
  utcDateRange,
} = require('../src/utc-time.ts');

test('approval expense timestamps use UTC for date-only fallback values', () => {
  assert.equal(
    approvalExpenseTimeExpr('expense'),
    "COALESCE(expense.source_created_at, expense.request_date::timestamp AT TIME ZONE 'UTC')"
  );
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
