import assert from 'node:assert/strict';
import test from 'node:test';

import processor from '../src/processor.ts';
import { collectOperationDeptSplits } from '../src/operation-dept-splits.ts';

test('parses individual income tax department rows only when tax type is individual income tax', () => {
  const formComponentValues = [
    { name: '税费Impuestos', value: '个税', componentType: 'SelectField' },
    {
      id: 'TableField_NEW_TAX',
      name: '薪酬税费总支出(分部门)Gasto total salarial-fiscal por departamento',
      componentType: 'TableField',
      details: [[
        { id: 'DepartmentField_TAX', value: 'SG 销售小组Grupo de ventas' },
        { id: 'MoneyField_TAX', value: '1234.56' },
        { id: 'TextField_TAX', value: '6月个税' },
      ]],
    },
  ];

  const parsed = processor.parseOperationExpenseData(formComponentValues);

  assert.deepEqual(parsed.individualIncomeTaxByDepartment, [{
    department: 'SG 销售小组Grupo de ventas',
    departmentId: null,
    departmentSource: 'name_only',
    amount: 1234.56,
    note: '6月个税',
  }]);
  assert.deepEqual(collectOperationDeptSplits(parsed), [{
    splitType: 'individual_income_tax',
    department: 'SG 销售小组Grupo de ventas',
    departmentId: null,
    departmentSource: 'name_only',
    departmentPathIds: null,
    departmentPathNames: null,
    amount: 1234.56,
    note: '6月个税',
  }]);
});

test('does not parse the tax detail table for other tax types', () => {
  const parsed = processor.parseOperationExpenseData([
    { name: '税费Impuestos', value: '印花税', componentType: 'SelectField' },
    {
      id: 'TableField_NEW_TAX',
      name: '薪酬税费总支出(分部门)Gasto total salarial-fiscal por departamento',
      componentType: 'TableField',
      details: [[
        { id: 'DepartmentField_TAX', value: 'SG 销售小组Grupo de ventas' },
        { id: 'MoneyField_TAX', value: '1234.56' },
      ]],
    },
  ]);

  assert.equal(parsed.individualIncomeTaxByDepartment, null);
});
