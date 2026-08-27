const assert = require('node:assert/strict');
const test = require('node:test');
const { REVIEWED_JULY_PAYMENT_EXCEPTIONS } = require('../src/july-payment-exceptions.ts');

test('keeps the one-time application list closed to the ten reviewed new events', () => {
  assert.equal(REVIEWED_JULY_PAYMENT_EXCEPTIONS.length, 10);
  assert.equal(new Set(REVIEWED_JULY_PAYMENT_EXCEPTIONS.map((item) => item.businessId)).size, 10);
  assert.equal(REVIEWED_JULY_PAYMENT_EXCEPTIONS.filter((item) => item.amountSource === 'manual_confirmed').length, 1);
  assert.equal(REVIEWED_JULY_PAYMENT_EXCEPTIONS.find((item) => item.businessId === '202607150207000370144').amount, 1920);
});

test('does not include already-recorded or ambiguous records in the application list', () => {
  const ids = new Set(REVIEWED_JULY_PAYMENT_EXCEPTIONS.map((item) => item.businessId));
  assert.equal(ids.has('202607141445000431981'), false);
  assert.equal(ids.has('202607071704000140246'), false);
  assert.equal(ids.has('202607101126000149363'), false);
  assert.equal(ids.has('202607171104000565826'), false);
});
