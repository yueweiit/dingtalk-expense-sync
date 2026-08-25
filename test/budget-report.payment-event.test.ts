import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import database, { pool } from '../src/database.ts';
import { getWeeklyExpenses } from '../src/budget-report.ts';
import { app } from '../src/server.ts';

const businessPrefix = `test-payment-weekly-${Date.now()}`;
const department = 'Payment Weekly Test Department';
let server: ReturnType<typeof app.listen> | undefined;

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  }
  await pool.query('DELETE FROM approval_expense_payment_events WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_operation WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.query('DELETE FROM approval_expense_purchase WHERE business_id LIKE $1', [`${businessPrefix}%`]);
  await pool.end();
});

test('weekly report uses the same payment-event and completed-split facts as the APIs', async () => {
  await database.ensureApprovalExpenseSchema();
  const operationEventId = `${businessPrefix}-operation-event`;
  const operationSplitId = `${businessPrefix}-operation-split`;
  const operationFallbackId = `${businessPrefix}-operation-fallback`;
  const purchaseEventId = `${businessPrefix}-purchase-event`;
  const purchaseFallbackId = `${businessPrefix}-purchase-fallback`;

  await pool.query(`INSERT INTO approval_expense_operation (business_id, applicant_department, approval_status, raw_data)
    VALUES ($1, $2, 'RUNNING', '{}'::jsonb),
           ($3, $2, 'COMPLETED', '{"result":"AGREE"}'::jsonb),
           ($4, $2, 'COMPLETED', '{"result":"AGREE"}'::jsonb)`, [operationEventId, department, operationSplitId, operationFallbackId]);
  await pool.query(`UPDATE approval_expense_operation SET approval_completed_at = '2026-08-20T10:00:00+08:00' WHERE business_id = $1`, [operationSplitId]);
  await pool.query(`UPDATE approval_expense_operation SET approval_completed_at = '2026-08-21T10:00:00+08:00', base_currency_amount = 100 WHERE business_id = $1`, [operationFallbackId]);
  await pool.query(`INSERT INTO approval_expense_dept_split (business_id, split_type, department, amount)
    VALUES ($1, 'salary', $2, 70)`, [operationSplitId, department]);
  await pool.query(`INSERT INTO approval_expense_purchase (business_id, applicant_department, approval_status, raw_data)
    VALUES ($1, $2, 'RUNNING', '{}'::jsonb),
           ($3, $2, 'COMPLETED', '{"result":"AGREE"}'::jsonb)`, [purchaseEventId, department, purchaseFallbackId]);
  await pool.query(`UPDATE approval_expense_purchase SET approval_completed_at = '2026-08-21T10:00:00+08:00', base_currency_amount = 100 WHERE business_id = $1`, [purchaseFallbackId]);
  await pool.query(`INSERT INTO approval_expense_payment_events
    (business_id, expense_kind, paid_at, amount, base_currency_amount, source_type, rule_version, source_hash, evidence_text, status)
    VALUES ($1, 'operation', '2026-08-12T10:00:00+08:00', 30, 30, 'comment_explicit_amount', 'authorized-comment-v1', $2, '已支付：30元', 'confirmed'),
           ($3, 'purchase', '2026-08-14T10:00:00+08:00', 45, 45, 'comment_explicit_amount', 'authorized-comment-v1', $4, '已支付：45元', 'confirmed')`,
    [operationEventId, 'c'.repeat(64), purchaseEventId, 'd'.repeat(64)]);

  await pool.query(`UPDATE approval_expense_payment_events
    SET source_user_id = CASE business_id
      WHEN $1 THEN '57521312381178275'
      WHEN $2 THEN '02183637680221426194'
    END
    WHERE business_id = ANY($3::text[])`, [operationEventId, purchaseEventId, [operationEventId, purchaseEventId]]);
  await pool.query(`INSERT INTO approval_expense_payment_events
    (business_id, expense_kind, paid_at, amount, base_currency_amount, currency, source_type, rule_version, source_user_id, source_hash, evidence_text, status)
    VALUES ($1, 'operation', '2026-08-16T10:00:00+08:00', 40, 40, 'CNY', 'comment_explicit_amount', 'authorized-comment-v1', '02485635391924266197', $2, 'paid 40', 'confirmed')`,
    [operationFallbackId, 'e'.repeat(64)]);

  const totals = await getWeeklyExpenses('2026-08-01', '2026-08-31');
  const matching = [...totals.values()].find((item) => item.departmentName === department);
  assert.equal(matching?.total, 345);

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const operation = await fetch(`${baseUrl}/api/approvals/approved/operation?department=${encodeURIComponent(department)}&month=2026-08`);
  const purchase = await fetch(`${baseUrl}/api/approvals/approved/purchase?department=${encodeURIComponent(department)}&month=2026-08`);
  const operationPayload = await operation.json();
  const purchasePayload = await purchase.json();
  assert.equal(operationPayload.total, '200.00');
  assert.equal(purchasePayload.total, '145.00');
  assert.equal(Number(operationPayload.total) + Number(purchasePayload.total), matching?.total);
});
