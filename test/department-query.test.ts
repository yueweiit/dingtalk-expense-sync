import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDepartmentQuery } from '../src/department-query.ts';

test('connector treats DingTalk department ID aliases as exact IDs', () => {
  for (const key of [
    'departmentId',
    'departmentID',
    'department_id',
    'deptId',
    'dept_id',
    'deptNameID',
    '部门Id',
  ]) {
    assert.deepEqual(resolveDepartmentQuery({ [key]: '1092411969' }), {
      mode: 'id',
      value: '1092411969',
    });
  }
});

test('connector keeps the exact name fallback only when no department ID exists', () => {
  assert.deepEqual(resolveDepartmentQuery({ department: '业务' }), {
    mode: 'name',
    value: '业务',
  });
});
