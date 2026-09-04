/**
 * Apply only the explicitly reviewed July payment exceptions.
 * Defaults to a read-only dry run. Writes require an explicit target and
 * confirmation token; the source rows, comment timestamp, and source hash are
 * checked before anything is inserted.
 */
import database, { pool } from '../src/database.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';
import config from '../src/config.ts';
import { extractExplicitPaymentComments, PAYMENT_EVENT_RULE_VERSION } from '../src/payment-events.ts';
import { REVIEWED_JULY_PAYMENT_EXCEPTIONS } from '../src/july-payment-exceptions.ts';

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isChina(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '中国' || normalized === 'china' || normalized === 'cn' || normalized.includes('中国');
}

async function main(): Promise<void> {
  const write = arg('write') === '1';
  const target = arg('target');
  const confirmation = arg('confirm');
  if (write && (!target || !['local', 'server'].includes(target) || confirmation !== 'july-payment-exceptions')) {
    throw new Error('写入必须同时指定 --target=local|server 和 --confirm=july-payment-exceptions');
  }

  const sourceResult = await pool.query<{
    expense_kind: 'operation' | 'purchase';
    business_id: string;
    process_instance_id: string | null;
    execution_region: string | null;
    currency: string | null;
    form_amount: string | number | null;
    has_department_splits: boolean;
    raw_data: Record<string, unknown> | null;
  }>(`
    SELECT 'operation'::text AS expense_kind, business_id, process_instance_id, execution_region, currency,
      amount AS form_amount,
      EXISTS (
        SELECT 1 FROM approval_expense_dept_split AS split
        WHERE split.business_id = approval_expense_operation.business_id
      ) AS has_department_splits,
      raw_data
    FROM approval_expense_operation
    UNION ALL
    SELECT 'purchase'::text AS expense_kind, business_id, process_instance_id, execution_region,
      NULL::varchar AS currency, detail_summary_amount AS form_amount,
      false AS has_department_splits,
      raw_data
    FROM approval_expense_purchase
  `);
  const sourceByBusinessId = new Map(sourceResult.rows.map((row) => [row.business_id, row]));

  const existingResult = await pool.query<{
    business_id: string;
    paid_at: Date | string;
    source_hash: string;
  }>(`
    SELECT business_id, paid_at, source_hash
    FROM approval_expense_payment_events
    WHERE status = 'confirmed'
      AND source_type IN ('comment_explicit_amount', 'fully_deducted')
      AND rule_version = $1
  `, [PAYMENT_EVENT_RULE_VERSION]);
  const existingKeys = new Set(existingResult.rows.map((event) =>
    `${event.business_id}\u0000${normalizeTimestamp(event.paid_at)}\u0000${event.source_hash}`,
  ));

  const events = [];
  const details = [];
  let alreadyRecorded = 0;
  for (const review of REVIEWED_JULY_PAYMENT_EXCEPTIONS) {
    const row = sourceByBusinessId.get(review.businessId);
    if (!row) throw new Error(`复核单据不存在: ${review.businessId}`);
    if (!isChina(row.execution_region)) throw new Error(`复核单据不是中国区: ${review.businessId}`);
    if (row.expense_kind === 'operation' && row.has_department_splits) {
      throw new Error(`复核单据存在部门拆分，不应建立付款事件: ${review.businessId}`);
    }

    const comments = extractExplicitPaymentComments(
      row.raw_data?.operationRecords,
      config.dingtalk.paymentEventUserIds,
      row.form_amount,
    ).filter((comment) => comment.paidAt === review.paidAt && comment.sourceHash === review.sourceHash);
    if (comments.length !== 1) {
      throw new Error(`付款评论证据已变化或不唯一: ${review.businessId}`);
    }
    const comment = comments[0];
    if (review.amountSource === 'form_amount_fallback' && comment.amount !== review.amount) {
      throw new Error(`表单金额与复核金额不一致: ${review.businessId}`);
    }

    const eventKey = `${review.businessId}\u0000${review.paidAt}\u0000${review.sourceHash}`;
    const isAlreadyRecorded = existingKeys.has(eventKey);
    if (isAlreadyRecorded) {
      alreadyRecorded++;
      details.push({ ...review, alreadyRecorded: true, evidenceText: comment.evidenceText });
      continue;
    }

    const currency = comment.currency || row.currency || 'CNY';
    const baseCurrencyAmount = await convertAmountToCny({
      amount: review.amount,
      currencyLabel: currency,
      createTime: review.paidAt,
    });
    events.push({
      businessId: review.businessId,
      processInstanceId: row.process_instance_id,
      expenseKind: row.expense_kind,
      paidAt: review.paidAt,
      amount: review.amount,
      baseCurrencyAmount,
      currency,
      sourceType: comment.sourceType,
      ruleVersion: PAYMENT_EVENT_RULE_VERSION,
      sourceUserId: comment.sourceUserId,
      sourceHash: review.sourceHash,
      evidenceText: comment.evidenceText,
      rawData: {
        ...comment.rawData,
        paymentAmountSource: review.amountSource,
        historicalReviewScope: 'july-payment-exceptions',
      },
    });
    details.push({ ...review, alreadyRecorded: false, evidenceText: comment.evidenceText });
  }

  const written = write ? await database.insertPaymentEvents(events) : 0;
  console.log(JSON.stringify({
    target: target || 'read-only',
    dryRun: !write,
    reviewed: REVIEWED_JULY_PAYMENT_EXCEPTIONS.length,
    ready: events.length,
    alreadyRecorded,
    written,
    details,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await database.close();
});
