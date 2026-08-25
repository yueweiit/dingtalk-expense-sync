const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { app } = require('../src/server.ts');
const databaseModule = require('../src/database/index.ts');
const database = databaseModule.default || databaseModule;
const pool = databaseModule.pool || databaseModule.default?.pool;

const businessPrefix = `test-pe-api-${Date.now()}`;
const departmentId = `${businessPrefix}-dept`;
let server;
let baseUrl;

async function insertExpense(tableName, businessId, status, completedAt = null) {
  await pool.query(
    `INSERT INTO ${tableName} (
      business_id,
      applicant_department,
      applicant_department_id,
      base_currency_amount,
      approval_status,
      approval_completed_at,
      raw_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      businessId,
      'Payment API Test Department',
      departmentId,
      100,
      status,
      completedAt,
      status === 'COMPLETED' ? '{"result":"AGREE"}' : '{}',
    ],
  );
}

async function insertPaymentEvent(businessId, expenseKind, amount, paidAt, sourceUserId = '57521312381178275') {
  await pool.query(
    `INSERT INTO approval_expense_payment_events (
      business_id,
      process_instance_id,
      expense_kind,
      paid_at,
      amount,
      base_currency_amount,
      currency,
      source_type,
      rule_version,
      source_user_id,
      source_hash,
      evidence_text,
      status
    ) VALUES ($1, $2, $3, $4, $5, $5, 'CNY', 'comment_explicit_amount', 'authorized-comment-v1', $6, $7, $8, 'confirmed')`,
    [
      businessId,
      `pid-${businessId}`,
      expenseKind,
      paidAt,
      amount,
      sourceUserId,
      `${businessId}`.padEnd(64, '0').slice(0, 64),
      `已支付：${amount}元`,
    ],
  );
}

test.before(async () => {
  await database.ensureApprovalExpenseSchema();

  await insertExpense('approval_expense_operation', `${businessPrefix}-operation-event`, 'COMPLETED', '2026-08-22T10:00:00+08:00');
  await insertPaymentEvent(`${businessPrefix}-operation-event`, 'operation', 30, '2026-08-12T10:00:00+08:00');

  await insertExpense('approval_expense_operation', `${businessPrefix}-operation-split`, 'COMPLETED', '2026-08-20T10:00:00+08:00');
  await pool.query(
    `INSERT INTO approval_expense_dept_split (business_id, split_type, department, department_id, amount)
     VALUES ($1, 'salary', 'Payment API Test Department', $2, 70)`,
    [`${businessPrefix}-operation-split`, departmentId],
  );

  await insertExpense('approval_expense_operation', `${businessPrefix}-operation-completed-no-event`, 'COMPLETED', '2026-08-21T10:00:00+08:00');
  await insertPaymentEvent(
    `${businessPrefix}-operation-completed-no-event`,
    'operation',
    40,
    '2026-08-16T10:00:00+08:00',
    '02485635391924266197',
  );

  await insertExpense('approval_expense_purchase', `${businessPrefix}-purchase-event`, 'RUNNING');
  await insertPaymentEvent(`${businessPrefix}-purchase-event`, 'purchase', 45, '2026-08-14T10:00:00+08:00');
  await insertExpense('approval_expense_purchase', `${businessPrefix}-purchase-completed-no-event`, 'COMPLETED', '2026-08-21T10:00:00+08:00');

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await pool.query('DELETE FROM approval_expense_payment_events WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_operation WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_purchase WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.end();
});

test('payment-event API counts only formal-user comments without double-counting later completion', async () => {
  const operation = await fetch(`${baseUrl}/api/approvals/approved/operation?departmentId=${departmentId}&month=2026-08`);
  assert.equal(operation.status, 200);
  assert.deepEqual(await operation.json(), { total: '200.00', count: 3 });

  const purchase = await fetch(`${baseUrl}/api/approvals/approved/purchase?departmentId=${departmentId}&month=2026-08`);
  assert.equal(purchase.status, 200);
  assert.deepEqual(await purchase.json(), { total: '145.00', count: 2 });

  const allOperations = await fetch(`${baseUrl}/api/approvals/approved/operation/all?month=2026-08&debug=1`);
  assert.equal(allOperations.status, 200);
  const allOperationPayload = await allOperations.json();
  const testFacts = allOperationPayload.items.filter((item) => item.business_id.startsWith(businessPrefix));
  assert.equal(testFacts.length, 3);
  assert.equal(testFacts.reduce((total, item) => total + Number(item.base_currency_amount), 0), 200);
  assert.deepEqual(
    testFacts.map((item) => item.accounting_source).sort(),
    ['completed_approval_fallback', 'completed_department_split', 'payment_event'],
  );
});
