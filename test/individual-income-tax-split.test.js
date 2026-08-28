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

test('parses IT operation detail rows by table name and dynamic row fields', () => {
  const parsed = processor.parseOperationExpenseData([
    { name: '管理支出', value: 'IT运维费用' },
    {
      name: 'IT运维费用明细',
      componentType: 'TableField',
      details: [[
        { id: 'DepartmentField_IT', value: '信息技术部' },
        { id: 'MoneyField_IT', value: '876.50' },
        { id: 'TextField_IT', value: '服务器维护' },
      ]],
    },
  ]);

  assert.deepEqual(parsed.itOperationByDepartment, [{
    department: '信息技术部',
    departmentId: null,
    departmentSource: 'name_only',
    amount: 876.5,
    note: '服务器维护',
  }]);
});

test('parses IT operation rows when the form uses the management-expense child field', () => {
  const parsed = processor.parseOperationExpenseData([
    { name: '管理支出Gastos de operación', value: '管理费用Gastos administrativos' },
    { name: '管理费用Gastos administrativos', value: 'IT运维费用' },
    {
      name: 'IT运维费用明细Detalles de gastos de mantenimiento de TI',
      componentType: 'TableField',
      value: JSON.stringify([
        {
          rowValue: [
            {
              key: 'DepartmentField_IT',
              value: '产品&开发Departamento de Producto y Desarrollo',
              extendValue: [{ id: '1089533879' }],
            },
            { key: 'MoneyField_IT', value: '123' },
          ],
        },
        {
          rowValue: [
            {
              key: 'DepartmentField_IT',
              value: 'HR人力资源中心Centro de Recursos Humanos (RRHH)',
              extendValue: [{ id: '1089765983' }],
            },
            { key: 'MoneyField_IT', value: '321' },
          ],
        },
      ]),
    },
  ]);

  assert.equal(parsed.administrativeExpense, 'IT运维费用');
  assert.deepEqual(parsed.itOperationByDepartment, [
    {
      department: '产品&开发Departamento de Producto y Desarrollo',
      departmentId: '1089533879',
      departmentSource: 'id',
      amount: 123,
      note: '',
    },
    {
      department: 'HR人力资源中心Centro de Recursos Humanos (RRHH)',
      departmentId: '1089765983',
      departmentSource: 'id',
      amount: 321,
      note: '',
    },
  ]);
});
