import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeConnectorDepartmentInputs } from '../src/connector-department-input-diagnostics.ts';

test('connector diagnostics distinguishes missing, empty, and present department inputs', () => {
  const summary = summarizeConnectorDepartmentInputs({
    month: '2026-08',
    deptNameID: '',
    departmentId: '1092411969',
    department: ['  ', '业务及生产执行单元'],
  });

  assert.deepEqual(summary.receivedKeys, ['department', 'departmentId', 'deptNameID', 'month']);
  assert.equal(summary.departmentInputs.departmentId, 'present:1092411969');
  assert.equal(summary.departmentInputs.deptNameID, 'empty');
  assert.equal(summary.departmentInputs.department, 'present:业务及生产执行单元');
  assert.equal(summary.departmentInputs.deptId, 'missing');
});
