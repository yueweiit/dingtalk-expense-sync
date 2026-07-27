export type RepairOptions = {
  start: string;
  end: string;
  write: boolean;
  backupFile: string | null;
  limit: number | null;
};

function requiredDate(value: string | undefined, option: string): string {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${option} must use YYYY-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${option} must be a valid calendar date`);
  }
  return text;
}

export function parseDepartmentIdentityRepairArgs(argv: string[]): RepairOptions {
  const values = new Map<string, string>();
  for (const arg of argv.slice(2)) {
    const match = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) values.set(match[1], match[2] == null ? '1' : match[2]);
  }

  const start = requiredDate(values.get('start'), '--start');
  const end = requiredDate(values.get('end'), '--end');
  if (start > end) throw new Error('--start must not be after --end');

  const write = values.get('write') === '1';
  const backupFile = String(values.get('backup') || '').trim() || null;
  if (write && !backupFile) {
    throw new Error('--backup=<absolute-json-path> is required when --write=1');
  }

  const limitText = values.get('limit');
  const limit = limitText == null ? null : Number.parseInt(limitText, 10);
  if (limitText != null && (!Number.isFinite(limit) || !limit || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }

  return { start, end, write, backupFile, limit };
}

export function repairCandidateQuery(limit: number | null): string {
  const limitSql = limit ? 'LIMIT $3' : '';
  return `
    SELECT
      ai.business_id,
      ai.process_instance_id,
      ai.process_type,
      ai.originator_dept_id,
      ai.originator_dept_name,
      ai.raw_data,
      CASE
        WHEN op.business_id IS NOT NULL THEN 'operation'
        WHEN pu.business_id IS NOT NULL THEN 'purchase'
      END AS expense_kind
    FROM approval_instances AS ai
    LEFT JOIN approval_expense_operation AS op ON op.business_id = ai.business_id
    LEFT JOIN approval_expense_purchase AS pu ON pu.business_id = ai.business_id
    WHERE (
      (
        op.business_id IS NOT NULL
        AND op.source_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND op.source_created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Shanghai')
        AND COALESCE(BTRIM(op.applicant_department_id), '') = ''
      )
      OR (
        pu.business_id IS NOT NULL
        AND pu.source_created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND pu.source_created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Shanghai')
        AND COALESCE(BTRIM(pu.applicant_department_id), '') = ''
      )
    )
    ORDER BY COALESCE(op.source_created_at, pu.source_created_at) ASC NULLS LAST, ai.id ASC
    ${limitSql}
  `;
}

export type SplitIdentityPatch = {
  splitType: string;
  department: string;
  departmentId: string;
  departmentPathIds: string[] | null;
  departmentPathNames: string[] | null;
};

export function collectSplitIdentityPatches(data: Record<string, unknown>): SplitIdentityPatch[] {
  const splitTypes: Array<[string, string]> = [
    ['salaryByDepartment', 'salary'],
    ['socialInsuranceByDepartment', 'social_insurance'],
    ['officeSpaceByDepartment', 'office_space'],
    ['individualIncomeTaxByDepartment', 'individual_income_tax'],
  ];

  const patches: SplitIdentityPatch[] = [];
  for (const [field, splitType] of splitTypes) {
    const rows = data[field];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const department = String(record.department || '').trim();
      const departmentId = String(record.departmentId || '').trim();
      if (!department || !departmentId) continue;
      patches.push({
        splitType,
        department,
        departmentId,
        departmentPathIds: Array.isArray(record.departmentPathIds)
          ? record.departmentPathIds.map((value) => String(value))
          : null,
        departmentPathNames: Array.isArray(record.departmentPathNames)
          ? record.departmentPathNames.map((value) => String(value))
          : null,
      });
    }
  }
  return patches;
}
