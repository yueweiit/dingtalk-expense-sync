const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  COMPLETED_APPROVAL_RESULTS,
  completedApprovalResult,
  completedApprovalResultSql,
  completedApprovedApprovalStateSql,
  completedApprovedExpenseSql,
} = require('../src/completed-expense-policy.ts');
const { shouldKeepDeptSplits } = require('../src/database/expense.ts');

test('final approval result supports both DingTalk field spellings and Chinese values', () => {
  const resultSql = completedApprovalResultSql('expense');

  const resultIndex = resultSql.indexOf("expense.raw_data->>'result'");
  const camelIndex = resultSql.indexOf("expense.raw_data->>'flowResult'");
  const snakeIndex = resultSql.indexOf("expense.raw_data->>'flow_result'");
  assert.ok(resultIndex >= 0);
  assert.ok(camelIndex > resultIndex);
  assert.ok(snakeIndex > camelIndex);
  assert.ok(COMPLETED_APPROVAL_RESULTS.includes('通过'));
  assert.ok(COMPLETED_APPROVAL_RESULTS.includes('同意'));
});

test('OA result overrides conflicting legacy result fields', () => {
  assert.equal(completedApprovalResult({ result: 'agree', flowResult: 'refuse' }), 'agree');
  assert.equal(completedApprovalResult({ result: 'refuse', flow_result: 'agree' }), 'refuse');
  assert.equal(completedApprovalResult({ flowResult: 'approved' }), 'approved');
  assert.equal(completedApprovalResult({ flow_result: 'pass' }), 'pass');
});

test('compensation state accepts completed OA results without a legacy flowResult field', () => {
  const sql = completedApprovedApprovalStateSql('expense');
  assert.match(sql, /= 'COMPLETED'/);
  assert.match(sql, /expense\.raw_data->>'result'/);
  assert.doesNotMatch(sql, /approval_completed_at/);
});

test('budget application filtering reuses the canonical final-result SQL', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'budget-report.ts'), 'utf8');
  assert.match(source, /\$\{completedApprovalResultSql\(\)\}\s+NOT IN \('refuse', 'reject'\)/);
  assert.doesNotMatch(source, /COALESCE\(raw_data->>'flowResult', raw_data->>'result'/);
});

test('department splits follow the same authoritative result precedence', () => {
  assert.equal(shouldKeepDeptSplits({
    approvalStatus: 'COMPLETED',
    rawData: { result: 'agree', flowResult: 'refuse' },
  }), true);
  assert.equal(shouldKeepDeptSplits({
    approvalStatus: 'COMPLETED',
    rawData: { result: 'refuse', flowResult: 'agree' },
  }), false);
});

test('actual expense eligibility uses final approval facts only', () => {
  const sql = completedApprovedExpenseSql('expense');

  assert.match(sql, /expense\.approval_completed_at IS NOT NULL/);
  assert.match(sql, /expense\.approval_status/);
  assert.match(sql, /= 'COMPLETED'/);
  assert.match(sql, /'agree'/);
  assert.match(sql, /'通过'/);
  assert.doesNotMatch(sql, /cashier|activityId|bizAction|tasks|REFUSE|REJECT/i);
});

test('final approval facts are independent of payment-node and task history fields', () => {
  const sql = completedApprovedExpenseSql('expense');
  assert.doesNotMatch(sql, /cashier|payment|activityId|bizAction|tasks/i);
  assert.match(sql, /flowResult/);
  assert.match(sql, /flow_result/);
  assert.match(sql, /result/);
});
