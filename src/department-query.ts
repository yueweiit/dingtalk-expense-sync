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
  ]);
  if (departmentId) {
    return { mode: 'id', value: departmentId };
  }

  const departmentCode = firstNonEmptyValue(input, ['dept_code', 'code']);
  if (departmentCode) {
    return { mode: 'code', value: departmentCode };
  }

  const department = firstNonEmptyValue(input, ['department']);
  if (!department) return null;

  return { mode: 'name', value: department };
}
