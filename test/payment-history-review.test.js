const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyJulyPaymentException } = require('../src/payment-history-review.ts');

test('includes a July payment whose approved completion occurred in August', () => {
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-07-31T23:59:59.000Z',
    sourceCreatedAt: '2026-07-01T00:00:00.000Z',
    approvalCompletedAt: '2026-08-01T00:00:00.000Z',
    approvalStatus: 'COMPLETED',
    approvalResult: 'agree',
  }), 'paid_in_july_completed_in_august');
});

test('excludes August-completed forms without an agreed final result', () => {
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-07-10T00:00:00.000Z',
    sourceCreatedAt: '2026-07-01T00:00:00.000Z',
    approvalCompletedAt: '2026-08-10T00:00:00.000Z',
    approvalStatus: 'COMPLETED',
    approvalResult: 'refuse',
  }), null);
});

test('includes July-submitted approvals that are still running regardless of comment month', () => {
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-08-10T00:00:00.000Z',
    sourceCreatedAt: '2026-07-31T23:59:59.000Z',
    approvalCompletedAt: null,
    approvalStatus: 'RUNNING',
    approvalResult: '',
  }), 'submitted_in_july_still_running');
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-07-10T00:00:00.000Z',
    sourceCreatedAt: '2026-08-01T00:00:00.000Z',
    approvalCompletedAt: null,
    approvalStatus: 'RUNNING',
    approvalResult: '',
  }), null);
});

test('excludes non-July payment comments from both review categories', () => {
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-08-01T00:00:00.000Z',
    sourceCreatedAt: '2026-07-10T00:00:00.000Z',
    approvalCompletedAt: null,
    approvalStatus: 'RUNNING',
    approvalResult: '',
  }), 'submitted_in_july_still_running');
  assert.equal(classifyJulyPaymentException({
    paidAt: '2026-08-01T00:00:00.000Z',
    sourceCreatedAt: '2026-08-10T00:00:00.000Z',
    approvalCompletedAt: null,
    approvalStatus: 'RUNNING',
    approvalResult: '',
  }), null);
});
