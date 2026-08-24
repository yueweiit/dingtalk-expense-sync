const DEPARTMENT_INPUT_KEYS = [
  'departmentId',
  'department_id',
  'deptId',
  'dept_id',
  'deptNameID',
  '部门Id',
  'dept_code',
  'code',
  'department',
  'deptName',
  '部门',
] as const;

function summarizeValue(value: unknown): string {
  if (value === undefined) return 'missing';

  const values = (Array.isArray(value) ? value : [value])
    .map((item) => typeof item === 'string' || typeof item === 'number'
      ? String(item).trim()
      : '')
    .filter(Boolean);

  if (values.length === 0) return 'empty';
  return `present:${values.join('|').slice(0, 128)}`;
}

export function summarizeConnectorDepartmentInputs(query: Record<string, unknown>): {
  receivedKeys: string[];
  departmentInputs: Record<string, string>;
} {
  return {
    receivedKeys: Object.keys(query).sort(),
    departmentInputs: Object.fromEntries(
      DEPARTMENT_INPUT_KEYS.map((key) => [key, summarizeValue(query[key])]),
    ),
  };
}
