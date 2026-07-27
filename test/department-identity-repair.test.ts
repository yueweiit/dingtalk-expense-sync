import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectSplitIdentityPatches,
  parseDepartmentIdentityRepairArgs,
  repairCandidateQuery,
} from '../src/department-identity-repair.ts';

test('repair arguments default to dry run and require a bounded date range', () => {
  const options = parseDepartmentIdentityRepairArgs([
    'node', 'script', '--start=2026-07-01', '--end=2026-07-31',
  ]);

  assert.equal(options.write, false);
  assert.equal(options.backupFile, null);
  assert.equal(options.limit, null);
  assert.throws(
    () => parseDepartmentIdentityRepairArgs(['node', 'script', '--start=2026-07-31', '--end=2026-07-01']),
    /--start must not be after --end/
  );
});

test('write mode requires a backup file', () => {
  assert.throws(
    () => parseDepartmentIdentityRepairArgs(['node', 'script', '--start=2026-07-01', '--end=2026-07-31', '--write=1']),
    /--backup=<absolute-json-path> is required/
  );
});

test('repair candidates are limited to rows with a missing master department id', () => {
  const query = repairCandidateQuery(5);
  assert.match(query, /approval_expense_operation/);
  assert.match(query, /approval_expense_purchase/);
  assert.match(query, /op\.source_created_at >= \(\$1::date::timestamp AT TIME ZONE 'Asia\/Shanghai'\)/);
  assert.match(query, /pu\.source_created_at >= \(\$1::date::timestamp AT TIME ZONE 'Asia\/Shanghai'\)/);
  assert.match(query, /COALESCE\(BTRIM\(op\.applicant_department_id\), ''\) = ''/);
  assert.match(query, /LIMIT \$3/);
});

test('split patches retain only rows that have a concrete department id', () => {
  const patches = collectSplitIdentityPatches({
    salaryByDepartment: [
      { department: '线上业务组', departmentId: '123', departmentPathIds: ['1', '123'] },
      { department: '无 ID 部门' },
    ],
    individualIncomeTaxByDepartment: [
      { department: '财务中心', departmentId: '456', departmentPathNames: ['公司', '财务中心'] },
    ],
  });

  assert.deepEqual(patches, [
    { splitType: 'salary', department: '线上业务组', departmentId: '123', departmentPathIds: ['1', '123'], departmentPathNames: null },
    { splitType: 'individual_income_tax', department: '财务中心', departmentId: '456', departmentPathIds: null, departmentPathNames: ['公司', '财务中心'] },
  ]);
});
