/**
 * Actual expenses are determined from the final approval instance only.
 * Task history and payment-node fields are intentionally not part of this rule.
 */
export const COMPLETED_APPROVAL_RESULTS = Object.freeze([
  'agree',
  'approved',
  'pass',
  'success',
  '同意',
  '已通过',
  '通过',
]);

function columnPrefix(tableAlias?: string): string {
  return tableAlias ? `${tableAlias}.` : '';
}

function firstNonEmpty(...values: unknown[]): unknown {
  return values.find((value) => value != null && String(value).trim() !== '');
}

/**
 * OA persists its authoritative final result in `result`.
 * The two flowResult spellings are retained only for records created by older
 * sync versions, where `result` was not stored in raw_data.
 */
export function completedApprovalResult(rawData: unknown): string {
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {};
  return String(firstNonEmpty(data.result, data.flowResult, data.flow_result) || '')
    .trim()
    .toLowerCase();
}

export function completedApprovalResultSql(tableAlias?: string): string {
  const prefix = columnPrefix(tableAlias);
  return `LOWER(COALESCE(
    NULLIF(TRIM(${prefix}raw_data->>'result'), ''),
    NULLIF(TRIM(${prefix}raw_data->>'flowResult'), ''),
    NULLIF(TRIM(${prefix}raw_data->>'flow_result'), ''),
    ''
  ))`;
}

/** Completed and agreed, without requiring a completion timestamp. */
export function completedApprovedApprovalStateSql(tableAlias?: string): string {
  const prefix = columnPrefix(tableAlias);
  const resultExpr = completedApprovalResultSql(tableAlias);
  const allowedResults = COMPLETED_APPROVAL_RESULTS.map((result) => `'${result}'`).join(', ');

  return `
    UPPER(COALESCE(NULLIF(TRIM(${prefix}approval_status), ''), NULLIF(TRIM(${prefix}raw_data->>'status'), ''), 'NONE')) = 'COMPLETED'
    AND ${resultExpr} IN (${allowedResults})
  `;
}

export function completedApprovedExpenseSql(tableAlias?: string): string {
  const prefix = columnPrefix(tableAlias);
  return `
    ${prefix}approval_completed_at IS NOT NULL
    AND ${completedApprovedApprovalStateSql(tableAlias)}
  `;
}
