import type { DeptSplitRow } from './database/types.ts';

type ParsedDeptSplit = {
  department?: unknown;
  amount?: unknown;
  note?: unknown;
};

type OperationDeptSplitSource = {
  salaryByDepartment?: ParsedDeptSplit[] | null;
  socialInsuranceByDepartment?: ParsedDeptSplit[] | null;
  officeSpaceByDepartment?: ParsedDeptSplit[] | null;
};

const SPLIT_SOURCES = [
  { key: 'salaryByDepartment', splitType: 'salary' },
  { key: 'socialInsuranceByDepartment', splitType: 'social_insurance' },
  { key: 'officeSpaceByDepartment', splitType: 'office_space' },
] as const;

export function collectOperationDeptSplits(data: OperationDeptSplitSource): DeptSplitRow[] {
  const splits: DeptSplitRow[] = [];

  for (const source of SPLIT_SOURCES) {
    const rows = data[source.key];
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const department = String(row?.department || '').trim();
      const amount = Number(row?.amount);
      if (!department || !Number.isFinite(amount)) continue;

      const note = String(row?.note || '').trim() || undefined;
      splits.push({ splitType: source.splitType, department, amount, note });
    }
  }

  return splits;
}
