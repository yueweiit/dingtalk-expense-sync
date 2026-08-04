const SHARED_BUDGET_GROUPS = [
  {
    parentId: '1077343081',
    memberIds: ['1077343081', '1090021489', '1092411969', '1092483668', '1092530529'],
  },
  {
    parentId: '1089990115',
    memberIds: ['1089990115', '1089527639', '1092658960', '1092931411', '1092985398'],
  },
];

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(text) : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function resolveSharedBudgetDepartmentIds(departmentId: unknown, month: unknown): string[] {
  const normalizedDepartmentId = text(departmentId);
  const normalizedMonth = text(month);
  if (!normalizedDepartmentId || normalizedMonth < '2026-07') {
    return normalizedDepartmentId ? [normalizedDepartmentId] : [];
  }

  const group = SHARED_BUDGET_GROUPS.find((item) => item.memberIds.includes(normalizedDepartmentId));
  return group ? [...group.memberIds] : [normalizedDepartmentId];
}

export interface SharedBudgetReportDepartmentInput {
  departmentId: unknown;
  departmentName: unknown;
  departmentPathIds: unknown;
  departmentPathNames: unknown;
  month: unknown;
}

export interface SharedBudgetReportDepartment {
  departmentId: string;
  departmentName: string;
  rolledUp: boolean;
  missingParentPath: boolean;
}

/**
 * Report amounts must use the same shared-budget parent as the budget side.
 * Parent names come from the saved department path, never from fuzzy names.
 */
export function resolveSharedBudgetReportDepartment(
  input: SharedBudgetReportDepartmentInput
): SharedBudgetReportDepartment {
  const departmentId = text(input.departmentId);
  const departmentName = text(input.departmentName);
  const month = text(input.month);

  if (!departmentId || month < '2026-07') {
    return { departmentId, departmentName, rolledUp: false, missingParentPath: false };
  }

  const group = SHARED_BUDGET_GROUPS.find((item) => item.memberIds.includes(departmentId));
  if (!group || group.parentId === departmentId) {
    return { departmentId, departmentName, rolledUp: false, missingParentPath: false };
  }

  const pathIds = textArray(input.departmentPathIds);
  const parentIndex = pathIds.indexOf(group.parentId);
  const parentName = parentIndex >= 0 ? textArray(input.departmentPathNames)[parentIndex] || '' : '';

  // A missing path snapshot must not silently merge a child into an unknown parent.
  if (!parentName) {
    return { departmentId, departmentName, rolledUp: false, missingParentPath: true };
  }

  return {
    departmentId: group.parentId,
    departmentName: parentName,
    rolledUp: true,
    missingParentPath: false,
  };
}

export { SHARED_BUDGET_GROUPS };
