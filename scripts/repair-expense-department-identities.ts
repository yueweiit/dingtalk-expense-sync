/**
 * Repair missing department identities on already-synced expense records.
 *
 * This script deliberately does not refresh approval_instances, amounts, statuses,
 * attachments, or purchase details. It only fills department identity/path fields
 * from the OA source for a bounded date range.
 *
 * Examples:
 *   npx tsx scripts/repair-expense-department-identities.ts --start=2026-07-01 --end=2026-07-31
 *   npx tsx scripts/repair-expense-department-identities.ts --start=2026-07-01 --end=2026-07-31 --write=1 --backup=/www/backup/july-expense-identities-before-repair.json
 */
import { dirname, resolve } from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import approvalSource from '../src/oa-source.ts';
import { pool } from '../src/database/pool.ts';
import processor, { parseApplicantDepartmentIdentity } from '../src/processor.ts';
import {
  collectSplitIdentityPatches,
  parseDepartmentIdentityRepairArgs,
  repairCandidateQuery,
  type SplitIdentityPatch,
} from '../src/department-identity-repair.ts';

type Candidate = {
  business_id: string;
  process_instance_id: string | null;
  process_type: string | null;
  originator_dept_id: string | null;
  originator_dept_name: string | null;
  raw_data: unknown;
  expense_kind: 'operation' | 'purchase';
};

type Identity = {
  departmentId: string;
  departmentSource: string;
  departmentPathIds: string[] | null;
  departmentPathNames: string[] | null;
};

type RepairPlan = {
  candidate: Candidate;
  identity: Identity | null;
  splitPatches: SplitIdentityPatch[];
  source: 'oa' | 'approval_instances';
  reason: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function componentsOf(instance: Record<string, unknown>): any[] {
  return Array.isArray(instance.formComponentValues) ? instance.formComponentValues : [];
}

function fallbackInstance(candidate: Candidate): Record<string, unknown> {
  return {
    ...asRecord(candidate.raw_data),
    originatorDeptId: candidate.originator_dept_id || undefined,
    originatorDeptName: candidate.originator_dept_name || undefined,
  };
}

async function sourceInstance(candidate: Candidate): Promise<{ instance: Record<string, unknown>; source: 'oa' | 'approval_instances' }> {
  const lookupId = String(candidate.process_instance_id || candidate.business_id).trim();
  if (lookupId) {
    try {
      return { instance: await approvalSource.getProcessInstance(lookupId), source: 'oa' };
    } catch (error) {
      console.warn(`OA source not available for business_id=${candidate.business_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { instance: fallbackInstance(candidate), source: 'approval_instances' };
}

async function buildPlan(candidate: Candidate): Promise<RepairPlan> {
  const { instance, source } = await sourceInstance(candidate);
  const components = componentsOf(instance);
  const identityData = parseApplicantDepartmentIdentity(components, {
    originatorDeptId: String(instance.originatorDeptId || candidate.originator_dept_id || '').trim() || undefined,
    originatorDeptName: String(instance.originatorDeptName || candidate.originator_dept_name || '').trim() || undefined,
  });
  if (!identityData.departmentId) {
    return { candidate, identity: null, splitPatches: [], source, reason: 'source data has no department id' };
  }

  const parsed: Record<string, unknown> = candidate.expense_kind === 'operation'
    ? processor.parseOperationExpenseData(components, instance as any)
    : {};
  parsed.applicantDepartmentId = identityData.departmentId;
  parsed.applicantDepartmentSource = identityData.departmentSource;
  await processor.enrichOperationDepartmentPaths(parsed);

  return {
    candidate,
    identity: {
      departmentId: identityData.departmentId,
      departmentSource: identityData.departmentSource,
      departmentPathIds: Array.isArray(parsed.applicantDepartmentPathIds)
        ? parsed.applicantDepartmentPathIds.map((value) => String(value))
        : null,
      departmentPathNames: Array.isArray(parsed.applicantDepartmentPathNames)
        ? parsed.applicantDepartmentPathNames.map((value) => String(value))
        : null,
    },
    splitPatches: candidate.expense_kind === 'operation' ? collectSplitIdentityPatches(parsed) : [],
    source,
    reason: null,
  };
}

async function snapshotPlan(plan: RepairPlan): Promise<Record<string, unknown>> {
  const table = plan.candidate.expense_kind === 'operation'
    ? 'approval_expense_operation'
    : 'approval_expense_purchase';
  const [expense, splits] = await Promise.all([
    pool.query(`SELECT to_jsonb(row) AS value FROM ${table} AS row WHERE business_id = $1`, [plan.candidate.business_id]),
    pool.query(
      `SELECT to_jsonb(row) AS value FROM approval_expense_dept_split AS row WHERE business_id = $1 ORDER BY id`,
      [plan.candidate.business_id]
    ),
  ]);
  return {
    businessId: plan.candidate.business_id,
    expenseKind: plan.candidate.expense_kind,
    expense: expense.rows[0]?.value || null,
    splits: splits.rows.map((row) => row.value),
  };
}

async function writeBackup(path: string, plans: RepairPlan[]): Promise<string> {
  const absolutePath = resolve(path);
  await access(dirname(absolutePath));
  const records = [];
  for (const plan of plans) records.push(await snapshotPlan(plan));
  await writeFile(absolutePath, JSON.stringify({
    createdAt: new Date().toISOString(),
    scope: 'missing department identities only',
    records,
  }, null, 2), { encoding: 'utf8', flag: 'wx' });
  return absolutePath;
}

async function patchMaster(client: PoolClient, plan: RepairPlan): Promise<number> {
  if (!plan.identity) return 0;
  const table = plan.candidate.expense_kind === 'operation'
    ? 'approval_expense_operation'
    : 'approval_expense_purchase';
  const result = await client.query(
    `
      UPDATE ${table}
      SET
        applicant_department_id = $2,
        applicant_department_source = $3,
        applicant_department_path_ids = COALESCE($4::jsonb, applicant_department_path_ids),
        applicant_department_path_names = COALESCE($5::jsonb, applicant_department_path_names),
        updated_at = NOW()
      WHERE business_id = $1
        AND COALESCE(BTRIM(applicant_department_id), '') = ''
    `,
    [
      plan.candidate.business_id,
      plan.identity.departmentId,
      plan.identity.departmentSource,
      plan.identity.departmentPathIds ? JSON.stringify(plan.identity.departmentPathIds) : null,
      plan.identity.departmentPathNames ? JSON.stringify(plan.identity.departmentPathNames) : null,
    ]
  );
  return result.rowCount || 0;
}

async function patchSplit(client: PoolClient, businessId: string, patch: SplitIdentityPatch): Promise<'updated' | 'missing' | 'ambiguous'> {
  const count = await client.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM approval_expense_dept_split
      WHERE business_id = $1
        AND split_type = $2
        AND department = $3
        AND COALESCE(BTRIM(department_id), '') = ''
    `,
    [businessId, patch.splitType, patch.department]
  );
  const matches = count.rows[0]?.count || 0;
  if (matches === 0) return 'missing';
  if (matches !== 1) return 'ambiguous';

  await client.query(
    `
      UPDATE approval_expense_dept_split
      SET
        department_id = $4,
        department_source = 'id',
        department_path_ids = COALESCE($5::jsonb, department_path_ids),
        department_path_names = COALESCE($6::jsonb, department_path_names),
        updated_at = NOW()
      WHERE business_id = $1
        AND split_type = $2
        AND department = $3
        AND COALESCE(BTRIM(department_id), '') = ''
    `,
    [
      businessId,
      patch.splitType,
      patch.department,
      patch.departmentId,
      patch.departmentPathIds ? JSON.stringify(patch.departmentPathIds) : null,
      patch.departmentPathNames ? JSON.stringify(patch.departmentPathNames) : null,
    ]
  );
  return 'updated';
}

async function applyPlan(plan: RepairPlan): Promise<{ masterUpdated: number; splitsUpdated: number; splitMissing: number; splitAmbiguous: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const masterUpdated = await patchMaster(client, plan);
    let splitsUpdated = 0;
    let splitMissing = 0;
    let splitAmbiguous = 0;
    for (const patch of plan.splitPatches) {
      const result = await patchSplit(client, plan.candidate.business_id, patch);
      if (result === 'updated') splitsUpdated++;
      if (result === 'missing') splitMissing++;
      if (result === 'ambiguous') splitAmbiguous++;
    }
    await client.query('COMMIT');
    return { masterUpdated, splitsUpdated, splitMissing, splitAmbiguous };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseDepartmentIdentityRepairArgs(process.argv);
  const params: unknown[] = [options.start, options.end];
  if (options.limit) params.push(options.limit);
  const candidates = await pool.query<Candidate>(repairCandidateQuery(options.limit), params);

  const plans: RepairPlan[] = [];
  for (const candidate of candidates.rows) plans.push(await buildPlan(candidate));

  const repairable = plans.filter((plan) => plan.identity);
  const withoutIdentity = plans.filter((plan) => !plan.identity);
  const summary = {
    start: options.start,
    end: options.end,
    write: options.write,
    candidates: plans.length,
    repairable: repairable.length,
    withoutIdentity: withoutIdentity.length,
    operationCandidates: plans.filter((plan) => plan.candidate.expense_kind === 'operation').length,
    purchaseCandidates: plans.filter((plan) => plan.candidate.expense_kind === 'purchase').length,
    oaSource: plans.filter((plan) => plan.source === 'oa').length,
    fallbackApprovalInstances: plans.filter((plan) => plan.source === 'approval_instances').length,
    splitPatches: repairable.reduce((total, plan) => total + plan.splitPatches.length, 0),
  };

  console.log(JSON.stringify(summary, null, 2));
  for (const plan of plans) {
    console.log(JSON.stringify({
      businessId: plan.candidate.business_id,
      kind: plan.candidate.expense_kind,
      departmentId: plan.identity?.departmentId || null,
      departmentSource: plan.identity?.departmentSource || null,
      splitPatches: plan.splitPatches.length,
      source: plan.source,
      skippedReason: plan.reason,
    }));
  }

  if (!options.write) {
    console.log('DRY RUN: no database rows were changed.');
    return;
  }

  const backupPath = await writeBackup(options.backupFile!, repairable);
  const result = { masterUpdated: 0, splitsUpdated: 0, splitMissing: 0, splitAmbiguous: 0 };
  for (const plan of repairable) {
    const applied = await applyPlan(plan);
    result.masterUpdated += applied.masterUpdated;
    result.splitsUpdated += applied.splitsUpdated;
    result.splitMissing += applied.splitMissing;
    result.splitAmbiguous += applied.splitAmbiguous;
  }
  console.log(JSON.stringify({ backupPath, ...result }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([pool.end(), approvalSource.close()]);
  });
