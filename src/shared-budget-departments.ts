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

export function resolveSharedBudgetDepartmentIds(departmentId: unknown, month: unknown): string[] {
  const normalizedDepartmentId = text(departmentId);
  const normalizedMonth = text(month);
  if (!normalizedDepartmentId || normalizedMonth < '2026-07') {
    return normalizedDepartmentId ? [normalizedDepartmentId] : [];
  }

  const group = SHARED_BUDGET_GROUPS.find((item) => item.memberIds.includes(normalizedDepartmentId));
  return group ? [...group.memberIds] : [normalizedDepartmentId];
}

export { SHARED_BUDGET_GROUPS };
