import { createHash } from 'node:crypto';

export const PAYMENT_EVENT_RULE_VERSION = 'authorized-comment-v1';

export interface ApprovalOperationRecord {
  date?: string | number;
  type?: string;
  remark?: string;
  userId?: string;
  staffId?: string;
  [key: string]: unknown;
}

export interface ExplicitPaymentComment {
  paidAt: string;
  amount: number;
  currency: string | null;
  sourceUserId: string | null;
  sourceHash: string;
  evidenceText: string;
  rawData: Record<string, unknown>;
  phrase: 'paid' | 'partial';
}

const PAYMENT_WITH_AMOUNT = /(?:\u5df2\u652f\u4ed8|\u90e8\u5206\u652f\u4ed8)\s*[:\uff1a=]?\s*(?:(?:\u4eba\u6c11\u5e01|RMB|CNY|\uffe5|\u00a5)\s*)?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:\u5143|\u4eba\u6c11\u5e01|RMB|CNY)?/giu;
const PAYMENT_PHRASE = /(?:\u5df2\u652f\u4ed8|\u90e8\u5206\u652f\u4ed8)/giu;

function normalizeComment(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Extract one explicit payment amount from an authorized user's comment.
 * A comment with multiple payment phrases or multiple adjacent amounts stays
 * review-only to avoid turning a total/remaining amount into a second payment.
 */
export function extractExplicitPaymentComments(
  records: unknown,
  authorizedUserIds: Iterable<string> = [],
): ExplicitPaymentComment[] {
  if (!Array.isArray(records)) return [];
  const allowed = new Set([...authorizedUserIds].map((value) => String(value).trim()).filter(Boolean));
  if (allowed.size === 0) return [];

  const events: ExplicitPaymentComment[] = [];
  for (const entry of records) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as ApprovalOperationRecord;
    const sourceUserId = String(record.userId || record.staffId || '').trim();
    if (!allowed.has(sourceUserId)) continue;

    const evidenceText = String(record.remark || '').trim();
    const paidAt = toTimestamp(record.date);
    if (!evidenceText || !paidAt) continue;

    PAYMENT_WITH_AMOUNT.lastIndex = 0;
    PAYMENT_PHRASE.lastIndex = 0;
    const matches = [...evidenceText.matchAll(PAYMENT_WITH_AMOUNT)];
    const phrases = [...evidenceText.matchAll(PAYMENT_PHRASE)];
    if (matches.length !== 1 || phrases.length !== 1) continue;

    const amount = Number(String(matches[0][1]).replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const normalized = normalizeComment(evidenceText);
    events.push({
      paidAt,
      amount: Math.round(amount * 100) / 100,
      currency: null,
      sourceUserId,
      sourceHash: createHash('sha256').update(`${sourceUserId}\u0000${paidAt}\u0000${normalized}`).digest('hex'),
      evidenceText,
      rawData: record as Record<string, unknown>,
      phrase: phrases[0][0].includes('\u90e8\u5206\u652f\u4ed8') ? 'partial' : 'paid',
    });
  }

  return events;
}
