import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSharedBudgetReportDepartment } from '../src/shared-budget-departments.ts';

test('rolls a YW Tech child into its shared-budget parent from July onward', () => {
  assert.deepEqual(resolveSharedBudgetReportDepartment({
    departmentId: '1092411969',
    departmentName: '业务',
    departmentPathIds: ['1', '1077343081', '1092411969'],
    departmentPathNames: ['ROOT', '悦为智能 YW Tech_Ai', '业务'],
    month: '2026-08',
  }), {
    departmentId: '1077343081',
    departmentName: '悦为智能 YW Tech_Ai',
    rolledUp: true,
    missingParentPath: false,
  });
});

test('rolls a Latin Purchase child into its shared-budget parent from July onward', () => {
  assert.deepEqual(resolveSharedBudgetReportDepartment({
    departmentId: '1092985398',
    departmentName: '拉丁购子部门',
    departmentPathIds: ['1', '1089990115', '1092985398'],
    departmentPathNames: ['ROOT', '拉丁购', '拉丁购子部门'],
    month: '2026-08',
  }), {
    departmentId: '1089990115',
    departmentName: '拉丁购',
    rolledUp: true,
    missingParentPath: false,
  });
});

test('keeps historical data and incomplete department paths unmerged', () => {
  const historical = resolveSharedBudgetReportDepartment({
    departmentId: '1092411969',
    departmentName: '业务',
    departmentPathIds: ['1', '1077343081', '1092411969'],
    departmentPathNames: ['ROOT', '悦为智能 YW Tech_Ai', '业务'],
    month: '2026-06',
  });
  const incomplete = resolveSharedBudgetReportDepartment({
    departmentId: '1092411969',
    departmentName: '业务',
    departmentPathIds: [],
    departmentPathNames: [],
    month: '2026-08',
  });

  assert.deepEqual(historical, {
    departmentId: '1092411969',
    departmentName: '业务',
    rolledUp: false,
    missingParentPath: false,
  });
  assert.deepEqual(incomplete, {
    departmentId: '1092411969',
    departmentName: '业务',
    rolledUp: false,
    missingParentPath: true,
  });
});
