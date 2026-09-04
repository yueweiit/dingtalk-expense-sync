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
import { completedApprovalResult } from '../src/completed-expense-policy.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';
import {
  classifyJulyPaymentException,
  JULY_PAYMENT_EXCEPTION_SCOPE,
  type ReviewCategory,
} from '../src/payment-history-review.ts';
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

const MANUAL_REVIEW_NOTES: Record<string, { reason: string; confirmedAmount?: number }> = {
  '202607150207000370144': {
    reason: '已确认仅部分支付，不能使用表单金额兜底。',
    confirmedAmount: 1920,
  },
  '202607171104000565826': {
    reason: '“已支付5千元”会被现有数字规则解析为 5，需按付款凭证人工确认金额。',
  },
};

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

function normalizeTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

interface PaymentCandidateDetail {
  expenseKind: 'operation' | 'purchase';
  businessId: string;
  processInstanceId: string | null;
  formName: string | null;
  approvalStatus: string | null;
  approvalResult: string;
  sourceCreatedAt: string | null;
  approvalCompletedAt: string | null;
  executionRegion: string | null;
  formAmount: string | number | null;
  currency: string;
  paidAt: string;
  amount: number;
  amountSource: 'comment' | 'form_amount_fallback' | 'fully_deducted';
  phrase: 'paid' | 'partial' | 'fully_deducted';
  sourceUserId: string | null;
  evidenceText: string;
  sourceHash: string;
  baseCurrencyAmount: number | null;
  alreadyRecorded: boolean;
  reviewCategory?: ReviewCategory;
  manualReview?: { reason: string; confirmedAmount?: number };
}

async function main(): Promise<void> {
  const write = arg('write') === '1';
  const chinaOnly = arg('china-only') !== '0';
  const businessId = arg('business-id');
  const detailsOutput = arg('details-output');
  const reviewScope = arg('review-scope');
  const paidStart = parseDateBoundary(arg('paid-start'), false);
  const paidEnd = parseDateBoundary(arg('paid-end'), true);
  if (reviewScope && reviewScope !== JULY_PAYMENT_EXCEPTION_SCOPE) {
    throw new Error(`Unsupported --review-scope=${reviewScope}`);
  }
  if (detailsOutput && !isAbsolute(detailsOutput)) {
    throw new Error('--details-output must be an absolute file path');
  }
  if (detailsOutput && write) {
    throw new Error('--details-output is read-only and cannot be combined with --write=1');
  }
  if (reviewScope && write) {
    throw new Error('--review-scope is read-only and cannot be combined with --write=1');
  }
  if (reviewScope && !detailsOutput) {
    throw new Error('--review-scope requires --details-output so every candidate remains auditable');
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
    source_created_at: Date | string | null;
    approval_completed_at: Date | string | null;
    execution_region: string | null;
    currency: string | null;
    form_amount: string | number | null;
    has_department_splits: boolean;
    raw_data: Record<string, unknown> | null;
  }>(`
    SELECT 'operation'::text AS expense_kind, business_id, process_instance_id, form_name, approval_status, source_created_at, approval_completed_at, execution_region, currency, amount AS form_amount,
      EXISTS (
        SELECT 1 FROM approval_expense_dept_split AS split
        WHERE split.business_id = approval_expense_operation.business_id
      ) AS has_department_splits,
      raw_data
    FROM approval_expense_operation
    UNION ALL
    SELECT 'purchase'::text AS expense_kind, business_id, process_instance_id, form_name, approval_status, source_created_at, approval_completed_at, execution_region, NULL::varchar AS currency, detail_summary_amount AS form_amount,
      false AS has_department_splits,
      raw_data
    FROM approval_expense_purchase
  `);

  const existingEvents = await pool.query<{
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
  const recordedKeys = new Set(existingEvents.rows.map((event) =>
    `${event.business_id}\u0000${normalizeTimestamp(event.paid_at)}\u0000${event.source_hash}`,
  ));

  const stats = {
    scanned: 0,
    held: 0,
    nonChina: 0,
    departmentSplits: 0,
    noExplicitAmount: 0,
    paidDateFiltered: 0,
    reviewScopeFiltered: 0,
    paidInJulyCompletedInAugust: 0,
    submittedInJulyStillRunning: 0,
    alreadyRecorded: 0,
    candidates: 0,
    written: 0,
  };
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
    const sourceCreatedAt = normalizeTimestamp(row.source_created_at);
    const approvalCompletedAt = normalizeTimestamp(row.approval_completed_at);
    const approvalStatus = normalizeStatus(row.approval_status || row.raw_data?.status) || null;
    const approvalResult = completedApprovalResult(row.raw_data);
    for (const comment of comments) {
      if ((paidStart && comment.paidAt < paidStart) || (paidEnd && comment.paidAt > paidEnd)) {
        stats.paidDateFiltered++;
        continue;
      }
      const reviewCategory = reviewScope === JULY_PAYMENT_EXCEPTION_SCOPE ? classifyJulyPaymentException({
        paidAt: comment.paidAt,
        sourceCreatedAt,
        approvalCompletedAt,
        approvalStatus,
        approvalResult,
      }) : null;
      if (reviewScope && !reviewCategory) {
        stats.reviewScopeFiltered++;
        continue;
      }
      const currency = comment.currency || row.currency || 'CNY';
      const baseCurrencyAmount = comment.sourceType === 'fully_deducted'
        ? 0
        : await convertAmountToCny({
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
        sourceType: comment.sourceType,
        ruleVersion: PAYMENT_EVENT_RULE_VERSION,
        sourceUserId: comment.sourceUserId,
        sourceHash: comment.sourceHash,
        evidenceText: comment.evidenceText,
        rawData: { ...comment.rawData, paymentAmountSource: comment.amountSource },
      });
      const alreadyRecorded = recordedKeys.has(`${row.business_id}\u0000${comment.paidAt}\u0000${comment.sourceHash}`);
      if (alreadyRecorded) stats.alreadyRecorded++;
      if (reviewCategory === 'paid_in_july_completed_in_august') stats.paidInJulyCompletedInAugust++;
      if (reviewCategory === 'submitted_in_july_still_running') stats.submittedInJulyStillRunning++;
      details.push({
        expenseKind: row.expense_kind,
        businessId: row.business_id,
        processInstanceId: row.process_instance_id,
        formName: row.form_name,
        approvalStatus,
        approvalResult,
        sourceCreatedAt,
        approvalCompletedAt,
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
        alreadyRecorded,
        ...(reviewCategory ? { reviewCategory } : {}),
        ...(MANUAL_REVIEW_NOTES[row.business_id] ? { manualReview: MANUAL_REVIEW_NOTES[row.business_id] } : {}),
      });
    }
    stats.candidates += events.length;
    if (write) stats.written += await database.insertPaymentEvents(events);
  }

  const summary = {
    ...stats,
    dryRun: !write,
    chinaOnly,
    paidStart,
    paidEnd,
    reviewScope,
    heldBusinessIds: [...HELD_BUSINESS_IDS],
  };
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
