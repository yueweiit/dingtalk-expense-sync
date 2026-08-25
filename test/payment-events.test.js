const assert = require('node:assert/strict');
const test = require('node:test');
const { extractExplicitPaymentComments } = require('../src/payment-events.ts');

const authorizedUserIds = ['57521312381178275', '02183637680221426194'];

function extract(records) {
  return extractExplicitPaymentComments(records, authorizedUserIds);
}

test('records one amount from an authorized paid comment', () => {
  const events = extract([{
    date: '2026-08-05T09:00:00+08:00',
    userId: authorizedUserIds[0],
    remark: '\u5df2\u652f\u4ed8\uff1a2,988\u5143',
  }]);

  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 2988);
  assert.equal(events[0].currency, null);
  assert.equal(events[0].paidAt, '2026-08-05T01:00:00.000Z');
  assert.equal(events[0].phrase, 'paid');
});

test('records a partial payment as this payment only', () => {
  const events = extract([{
    date: '2026-07-07T10:00:00Z',
    userId: authorizedUserIds[1],
    remark: '\u90e8\u5206\u652f\u4ed8 14500\u5143\uff0c\u5269\u4f59 500\u5143\u5f85\u540e\u7eed\u652f\u4ed8',
  }]);

  assert.equal(events.length, 1);
  assert.equal(events[0].amount, 14500);
  assert.equal(events[0].phrase, 'partial');
});

test('records separate comments as separate payment events', () => {
  const events = extract([
    {
      date: '2026-07-07T10:00:00Z',
      userId: authorizedUserIds[0],
      remark: '\u5df2\u652f\u4ed8100\u5143',
    },
    {
      date: '2026-08-07T10:00:00Z',
      userId: authorizedUserIds[0],
      remark: '\u90e8\u5206\u652f\u4ed8200\u5143',
    },
  ]);

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.amount), [100, 200]);
});

test('ignores the same phrase from an unauthorized user', () => {
  assert.deepEqual(extract([{
    date: '2026-08-05T09:00:00+08:00',
    userId: 'not-authorized',
    remark: '\u5df2\u652f\u4ed8\uff1a2988\u5143',
  }]), []);
});

test('keeps ambiguous multiple payment phrases review-only', () => {
  assert.deepEqual(extract([{
    date: '2026-08-05T09:00:00+08:00',
    userId: authorizedUserIds[0],
    remark: '\u5df2\u652f\u4ed8 100\u5143\uff0c\u5df2\u652f\u4ed8 20\u5143',
  }]), []);
});

test('requires an explicit amount immediately after the payment phrase', () => {
  assert.deepEqual(extract([{
    date: '2026-08-05T09:00:00+08:00',
    userId: authorizedUserIds[0],
    remark: '\u5df2\u652f\u4ed8\uff0c\u51ed\u8bc1\u89c1\u9644\u4ef6',
  }]), []);
});
