/**
 * Preview or backfill explicit actual-payment comments for all approvals.
 * Defaults to a China-only dry run. `--write=1` is required to insert rows.
 */
import database, { pool } from '../src/database.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';
import { extractExplicitPaymentComments, PAYMENT_EVENT_RULE_VERSION } from '../src/payment-events.ts';
import config from '../src/config.ts';

const HELD_BUSINESS_IDS = new Set([
  '202607171008000209353',
  '202607221050000501984',
  '202607240414000130662',
  '202608071146000340473',
  '202607230711000294954',
  '202607081659000345805',
]);

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function isChina(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '中国' || normalized === 'china' || normalized === 'cn' || normalized.includes('中国');
}

async function main(): Promise<void> {
  const write = arg('write') === '1';
  const chinaOnly = arg('china-only') !== '0';
  const businessId = arg('business-id');
  if (write) {
    await database.ensureApprovalExpenseSchema();
  }

  const result = await pool.query<{
    expense_kind: 'operation' | 'purchase';
    business_id: string;
    process_instance_id: string | null;
    execution_region: string | null;
    currency: string | null;
    form_amount: string | number | null;
    has_department_splits: boolean;
    raw_data: Record<string, unknown> | null;
  }>(`
    SELECT 'operation'::text AS expense_kind, business_id, process_instance_id, execution_region, currency, amount AS form_amount,
      EXISTS (
        SELECT 1 FROM approval_expense_dept_split AS split
        WHERE split.business_id = approval_expense_operation.business_id
      ) AS has_department_splits,
      raw_data
    FROM approval_expense_operation
    UNION ALL
    SELECT 'purchase'::text AS expense_kind, business_id, process_instance_id, execution_region, NULL::varchar AS currency, detail_summary_amount AS form_amount,
      false AS has_department_splits,
      raw_data
    FROM approval_expense_purchase
  `);

  const stats = { scanned: 0, held: 0, nonChina: 0, departmentSplits: 0, noExplicitAmount: 0, candidates: 0, written: 0 };
  for (const row of result.rows) {
    if (!row.business_id || (businessId && row.business_id !== businessId)) continue;
    stats.scanned++;
    if (HELD_BUSINESS_IDS.has(row.business_id)) {
      stats.held++;
      continue;
    }
    if (chinaOnly && !isChina(row.execution_region)) {
      stats.nonChina++;
      continue;
    }
    if (row.expense_kind === 'operation' && row.has_department_splits) {
      stats.departmentSplits++;
      continue;
    }

    const comments = extractExplicitPaymentComments(
      row.raw_data?.operationRecords,
      config.dingtalk.paymentEventUserIds,
      row.form_amount,
    );
    if (comments.length === 0) {
      stats.noExplicitAmount++;
      continue;
    }

    const events = [];
    for (const comment of comments) {
      const currency = comment.currency || row.currency || 'CNY';
      const baseCurrencyAmount = await convertAmountToCny({
        amount: comment.amount,
        currencyLabel: currency,
        createTime: comment.paidAt,
      });
      events.push({
        businessId: row.business_id,
        processInstanceId: row.process_instance_id,
        expenseKind: row.expense_kind,
        paidAt: comment.paidAt,
        amount: comment.amount,
        baseCurrencyAmount,
        currency,
        sourceType: 'comment_explicit_amount' as const,
        ruleVersion: PAYMENT_EVENT_RULE_VERSION,
        sourceUserId: comment.sourceUserId,
        sourceHash: comment.sourceHash,
        evidenceText: comment.evidenceText,
        rawData: { ...comment.rawData, paymentAmountSource: comment.amountSource },
      });
    }
    stats.candidates += events.length;
    if (write) stats.written += await database.insertPaymentEvents(events);
  }

  console.log(JSON.stringify({ ...stats, dryRun: !write, chinaOnly, heldBusinessIds: [...HELD_BUSINESS_IDS] }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await database.close();
});
