const assert = require('node:assert/strict');
const test = require('node:test');

const { extractExplicitPaymentComments } = require('../src/payment-events');

const authorizedUser = '57521312381178275';
const paidAt = '2026-08-31T08:30:00+08:00';

function comments(remark, userId = authorizedUser) {
  return [{ userId, remark, date: paidAt }];
}

test('monthly settlement records the amount explicitly stated by an authorized commenter', () => {
  const [event] = extractExplicitPaymentComments(comments('已支付：1,234.56元'), [authorizedUser], 9999);
  assert.equal(event.amount, 1234.56);
  assert.equal(event.amountSource, 'comment');
});

test('monthly settlement uses the form total only for an authorized bare 已支付 comment', () => {
  const [event] = extractExplicitPaymentComments(comments('已支付'), [authorizedUser], 8888);
  assert.equal(event.amount, 8888);
  assert.equal(event.amountSource, 'form_amount_fallback');
});

test('monthly settlement does not infer a partial payment without an amount', () => {
  assert.deepEqual(
    extractExplicitPaymentComments(comments('部分支付'), [authorizedUser], 8888),
    []
  );
});

test('monthly settlement ignores payment language from an unauthorized commenter', () => {
  assert.deepEqual(
    extractExplicitPaymentComments(comments('已支付：8888元', 'unauthorized-user'), [authorizedUser], 8888),
    []
  );
});

test('monthly settlement without a compliant comment generates no payment event', () => {
  assert.deepEqual(
    extractExplicitPaymentComments(comments('已完成，等待付款'), [authorizedUser], 8888),
    []
  );
});
