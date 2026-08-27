import { COMPLETED_APPROVAL_RESULTS } from './completed-expense-policy.ts';

export const JULY_PAYMENT_EXCEPTION_SCOPE = 'july-payment-exceptions';

const JULY_START = '2026-07-01T00:00:00.000Z';
const AUGUST_START = '2026-08-01T00:00:00.000Z';
const SEPTEMBER_START = '2026-09-01T00:00:00.000Z';

export type ReviewCategory = 'paid_in_july_completed_in_august' | 'submitted_in_july_still_running';

function inRange(value: string | null, start: string, end: string): boolean {
  return value != null && value >= start && value < end;
}

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

/**
 * Keep the one-time July review deliberately narrow. This is not a general
 * accounting rule and must never be used to write payment events directly.
 */
export function classifyJulyPaymentException({
  paidAt,
  sourceCreatedAt,
  approvalCompletedAt,
  approvalStatus,
  approvalResult,
}: {
  paidAt: string;
  sourceCreatedAt: string | null;
  approvalCompletedAt: string | null;
  approvalStatus: string | null;
  approvalResult: string;
}): ReviewCategory | null {
  if (
    inRange(paidAt, JULY_START, AUGUST_START) &&
    normalizeStatus(approvalStatus) === 'COMPLETED' &&
    COMPLETED_APPROVAL_RESULTS.includes(approvalResult as typeof COMPLETED_APPROVAL_RESULTS[number]) &&
    inRange(approvalCompletedAt, AUGUST_START, SEPTEMBER_START)
  ) {
    return 'paid_in_july_completed_in_august';
  }

  if (
    normalizeStatus(approvalStatus) === 'RUNNING' &&
    inRange(sourceCreatedAt, JULY_START, AUGUST_START)
  ) {
    return 'submitted_in_july_still_running';
  }

  return null;
}
