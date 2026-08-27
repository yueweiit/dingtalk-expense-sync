/**
 * Preview or backfill explicit actual-payment comments for all approvals.
 * Defaults to a China-only dry run. `--write=1` is required to insert rows.
 * `--details-output=/absolute/path.json` writes candidate details without
 * changing the database, so the list can be reviewed before enabling writes.
 * Use `--paid-start=YYYY-MM-DD` / `--paid-end=YYYY-MM-DD` to scope candidates
 * by their actual payment-comment date.
 */
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
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

function parseDateBoundary(value: string | null, endOfDay: boolean): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${endOfDay ? '--paid-end' : '--paid-start'} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${endOfDay ? '--paid-end' : '--paid-start'} is not a valid date`);
  }
  return date.toISOString();
}

interface PaymentCandidateDetail {
  expenseKind: 'operation' | 'purchase';
  businessId: string;
  processInstanceId: string | null;
  formName: string | null;
  approvalStatus: string | null;
  executionRegion: string | null;
  formAmount: string | number | null;
  currency: string;
  paidAt: string;
  amount: number;
  amountSource: 'comment' | 'form_amount_fallback';
  phrase: 'paid' | 'partial';
  sourceUserId: string | null;
  evidenceText: string;
  sourceHash: string;
  baseCurrencyAmount: number | null;
}

async function main(): Promise<void> {
  const write = arg('write') === '1';
  const chinaOnly = arg('china-only') !== '0';
  const businessId = arg('business-id');
  const detailsOutput = arg('details-output');
  const paidStart = parseDateBoundary(arg('paid-start'), false);
  const paidEnd = parseDateBoundary(arg('paid-end'), true);
  if (detailsOutput && !isAbsolute(detailsOutput)) {
    throw new Error('--details-output must be an absolute file path');
  }
  if (detailsOutput && write) {
    throw new Error('--details-output is read-only and cannot be combined with --write=1');
  }
  if (paidStart && paidEnd && paidStart > paidEnd) {
    throw new Error('--paid-start cannot be later than --paid-end');
  }
  if (write) {
    await database.ensureApprovalExpenseSchema();
  }

  const result = await pool.query<{
    expense_kind: 'operation' | 'purchase';
    business_id: string;
    process_instance_id: string | null;
    form_name: string | null;
    approval_status: string | null;
    execution_region: string | null;
    currency: string | null;
    form_amount: string | number | null;
    has_department_splits: boolean;
    raw_data: Record<string, unknown> | null;
  }>(`
    SELECT 'operation'::text AS expense_kind, business_id, process_instance_id, form_name, approval_status, execution_region, currency, amount AS form_amount,
      EXISTS (
        SELECT 1 FROM approval_expense_dept_split AS split
        WHERE split.business_id = approval_expense_operation.business_id
      ) AS has_department_splits,
      raw_data
    FROM approval_expense_operation
    UNION ALL
    SELECT 'purchase'::text AS expense_kind, business_id, process_instance_id, form_name, approval_status, execution_region, NULL::varchar AS currency, detail_summary_amount AS form_amount,
      false AS has_department_splits,
      raw_data
    FROM approval_expense_purchase
  `);

  const stats = { scanned: 0, held: 0, nonChina: 0, departmentSplits: 0, noExplicitAmount: 0, paidDateFiltered: 0, candidates: 0, written: 0 };
  const details: PaymentCandidateDetail[] = [];
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
      if ((paidStart && comment.paidAt < paidStart) || (paidEnd && comment.paidAt > paidEnd)) {
        stats.paidDateFiltered++;
        continue;
      }
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
      details.push({
        expenseKind: row.expense_kind,
        businessId: row.business_id,
        processInstanceId: row.process_instance_id,
        formName: row.form_name,
        approvalStatus: row.approval_status,
        executionRegion: row.execution_region,
        formAmount: row.form_amount,
        currency,
        paidAt: comment.paidAt,
        amount: comment.amount,
        amountSource: comment.amountSource,
        phrase: comment.phrase,
        sourceUserId: comment.sourceUserId,
        evidenceText: comment.evidenceText,
        sourceHash: comment.sourceHash,
        baseCurrencyAmount,
      });
    }
    stats.candidates += events.length;
    if (write) stats.written += await database.insertPaymentEvents(events);
  }

  const summary = { ...stats, dryRun: !write, chinaOnly, paidStart, paidEnd, heldBusinessIds: [...HELD_BUSINESS_IDS] };
  if (detailsOutput) {
    await writeFile(detailsOutput, `${JSON.stringify({ ...summary, details }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...summary, detailsOutput }, null, 2));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await database.close();
});
