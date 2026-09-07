import assert from 'node:assert/strict';
import test from 'node:test';

import { collectOperationDeptSplits } from '../src/operation-dept-splits.ts';

test('preserves office-equipment rows as an independent department-split type', () => {
  assert.deepEqual(collectOperationDeptSplits({
    salaryByDepartment: [{ department: '工资部门', amount: 100 }],
    officeEquipmentByDepartment: [{ department: '设备部门', departmentId: 'dept-office', amount: 456.78, note: '设备维护' }],
  }), [
    {
      splitType: 'salary',
      department: '工资部门',
      departmentId: null,
      departmentSource: 'name_only',
      departmentPathIds: null,
      departmentPathNames: null,
      amount: 100,
      note: undefined,
    },
    {
      splitType: 'office_equipment',
      department: '设备部门',
      departmentId: 'dept-office',
      departmentSource: 'id',
      departmentPathIds: null,
      departmentPathNames: null,
      amount: 456.78,
      note: '设备维护',
    },
  ]);
});
