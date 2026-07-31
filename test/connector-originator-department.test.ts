import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOriginatorDepartmentQuery,
  getConnectorOriginator,
  resolveOriginatorDepartment,
} from '../src/connector-originator-department.ts';
import { resolveSharedBudgetDepartmentIds } from '../src/shared-budget-departments.ts';

test('prefers submitter ID over submitter name', () => {
  assert.deepEqual(getConnectorOriginator({
    originatorUserId: 'user-1',
    originatorName: 'Alice',
  }), { userId: 'user-1', name: 'Alice' });

  const statement = buildOriginatorDepartmentQuery({
    originatorUserId: 'user-1',
    originatorName: 'Alice',
    departmentName: 'Sales',
  });
  assert.deepEqual(statement.params, ['user-1', 'Sales']);
  assert.match(statement.sql, /BTRIM\(user_snapshot\.user_id\) = BTRIM\(\$1\)/);
});

test('accepts DingTalk fixed Chinese submitter parameter name', () => {
  assert.deepEqual(getConnectorOriginator({
    '\u63d0\u4ea4\u4eba': 'Alice',
  }), { userId: '', name: 'Alice' });
});

test('resolves exactly one current department membership by submitter name', async () => {
  const resolution = await resolveOriginatorDepartment({
    originatorName: 'Alice',
    departmentName: 'Sales',
  }, {
    query: async () => ({
      rows: [{
        user_id: 'user-1',
        originator_name: 'Alice',
        dept_id: 'department-1',
        department_name: 'Sales',
        path_names: ['ROOT', 'Sales'],
      }],
    }),
  });

  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.status === 'resolved' && resolution.departmentId, 'department-1');
});

test('refuses ambiguous same-name departments', async () => {
  const resolution = await resolveOriginatorDepartment({
    originatorName: 'Alice',
    departmentName: 'Sales',
  }, {
    query: async () => ({
      rows: [
        { user_id: 'user-1', originator_name: 'Alice', dept_id: 'department-1', department_name: 'Sales', path_names: [] },
        { user_id: 'user-1', originator_name: 'Alice', dept_id: 'department-2', department_name: 'Sales', path_names: [] },
      ],
    }),
  });

  assert.equal(resolution.status, 'ambiguous');
});

test('shares only YW Tech and Latin Purchase budgets from July onward', () => {
  assert.deepEqual(
    resolveSharedBudgetDepartmentIds('1092411969', '2026-07'),
    ['1077343081', '1090021489', '1092411969', '1092483668', '1092530529']
  );
  assert.deepEqual(resolveSharedBudgetDepartmentIds('1092411969', '2026-06'), ['1092411969']);
  assert.deepEqual(resolveSharedBudgetDepartmentIds('other-department', '2026-07'), ['other-department']);
});
