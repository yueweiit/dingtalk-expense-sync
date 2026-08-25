const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

function loadModule(moduleName) {
  const srcPath = path.join('..', 'src', moduleName);
  const distPath = path.join('..', 'dist', 'src', moduleName);
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(distPath);
  }
}

test('stores explicit payment events idempotently by business id, time, and source hash', async () => {
  const databaseModule = loadModule('database');
  const expenseModule = loadModule(path.join('database', 'expense'));
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;
  const insertPaymentEvents = expenseModule.insertPaymentEvents || expenseModule.default?.insertPaymentEvents;
  const businessId = `test-payment-event-${Date.now()}`;
  const event = {
    businessId,
    processInstanceId: `pid-${businessId}`,
    expenseKind: 'operation',
    paidAt: '2026-08-05T01:00:00.000Z',
    amount: 2988,
    baseCurrencyAmount: 2988,
    currency: 'CNY',
    sourceType: 'comment_explicit_amount',
    ruleVersion: 'authorized-comment-v1',
    sourceUserId: 'cashier-1',
    sourceHash: 'a'.repeat(64),
    evidenceText: '已支付2988元',
    rawData: { type: 'ADD_REMARK' },
  };

  await database.ensureApprovalExpenseSchema();
  try {
    assert.equal(await insertPaymentEvents([event]), 1);
    assert.equal(await insertPaymentEvents([event]), 0);
    const result = await pool.query(
      'select amount, base_currency_amount, rule_version, status from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].amount), 2988);
    assert.equal(Number(result.rows[0].base_currency_amount), 2988);
    assert.equal(result.rows[0].rule_version, 'authorized-comment-v1');
    assert.equal(result.rows[0].status, 'confirmed');
  } finally {
    await pool.query('delete from approval_expense_payment_events where business_id = $1', [businessId]);
    await pool.end();
  }
});
