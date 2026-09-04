import type { DeptSplitRow } from './database/types.ts';

type ParsedDeptSplit = {
  department?: unknown;
  departmentId?: unknown;
  departmentSource?: unknown;
  departmentPathIds?: unknown;
  departmentPathNames?: unknown;
  amount?: unknown;
  note?: unknown;
};

type OperationDeptSplitSource = {
  salaryByDepartment?: ParsedDeptSplit[] | null;
  bonusByDepartment?: ParsedDeptSplit[] | null;
  socialInsuranceByDepartment?: ParsedDeptSplit[] | null;
  officeSpaceByDepartment?: ParsedDeptSplit[] | null;
  individualIncomeTaxByDepartment?: ParsedDeptSplit[] | null;
};

const SPLIT_SOURCES = [
  { key: 'salaryByDepartment', splitType: 'salary' },
  { key: 'bonusByDepartment', splitType: 'bonus' },
  { key: 'socialInsuranceByDepartment', splitType: 'social_insurance' },
  { key: 'officeSpaceByDepartment', splitType: 'office_space' },
  { key: 'individualIncomeTaxByDepartment', splitType: 'individual_income_tax' },
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
      const departmentId = String(row?.departmentId || '').trim() || null;
      const departmentPathIds = Array.isArray(row?.departmentPathIds)
        ? row.departmentPathIds.map((value) => String(value))
        : null;
      const departmentPathNames = Array.isArray(row?.departmentPathNames)
        ? row.departmentPathNames.map((value) => String(value))
        : null;
      splits.push({
        splitType: source.splitType,
        department,
        departmentId,
        departmentSource: departmentId ? 'id' : 'name_only',
        departmentPathIds,
        departmentPathNames,
        amount,
        note,
      });
    }
  }

  return splits;
}
