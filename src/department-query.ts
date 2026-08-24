export type DepartmentQueryMode = 'id' | 'code' | 'name';

export interface DepartmentQuery {
  mode: DepartmentQueryMode;
  value: string;
}

function firstNonEmptyValue(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = String(input[key] ?? '').trim();
    if (value) return value;
  }
  return null;
}

export function resolveDepartmentQuery(input: Record<string, unknown>): DepartmentQuery | null {
  const departmentId = firstNonEmptyValue(input, [
    'departmentId',
    'department_id',
    'deptId',
    'dept_id',
    // Existing DingTalk connectors serialize the displayed "部门Id" parameter
    // as deptNameID. Its value is still the service-entity department code.
    'deptNameID',
    '部门Id',
  ]);
  if (departmentId) {
    return { mode: 'id', value: departmentId };
  }

  const departmentCode = firstNonEmptyValue(input, ['dept_code', 'code']);
  if (departmentCode) {
    return { mode: 'code', value: departmentCode };
  }

  const department = firstNonEmptyValue(input, [
    'department',
    'deptName',
    '\u90e8\u95e8',
  ]);
  if (!department) return null;

  return { mode: 'name', value: department };
}
