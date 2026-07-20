export function approvalExpenseTimeExpr(tableAlias?: string): string {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `COALESCE(${prefix}source_created_at, ${prefix}request_date::timestamp AT TIME ZONE 'UTC')`;
}

export function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function utcDateRange(startDate: string, endDate?: string): {
  start: string;
  endExclusive?: string;
} {
  const toUtcBoundary = (date: string): string => `${date}T00:00:00.000Z`;
  if (!endDate) {
    return { start: toUtcBoundary(startDate) };
  }

  const nextDay = new Date(`${endDate}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    start: toUtcBoundary(startDate),
    endExclusive: nextDay.toISOString(),
  };
}
