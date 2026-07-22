const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.DB_PASSWORD ??= 'test-password';
process.env.DINGTALK_APPKEY ??= 'test-appkey';
process.env.DINGTALK_APPSECRET ??= 'test-appsecret';

function getProcessor() {
  const sourcePath = path.join('..', 'src', 'processor');
  const module = require(sourcePath);
  return module.default || module;
}

test('operation department splits retain the selected department id from detail rows', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '管理支出', value: '工资中国' },
    {
      componentType: 'TableField',
      id: 'TableField_13B0RI3JBQXS0',
      details: [[
        {
          id: 'DepartmentField_1UHJJHSCID6O0',
          value: 'FC CN财务中心 Centro de finanzas',
          extendValue: [{
            id: '1079492125',
            itemId: '1079492125',
            deptName: 'FC CN财务中心 Centro de finanzas',
          }],
        },
        { id: 'MoneyField_T2TFVV7BXN40', value: '1000' },
        { id: 'TextField_SZ57CIDK9J40', value: '工资' },
      ]],
    },
  ]);

  assert.deepEqual(result.salaryByDepartment, [{
    department: 'FC CN财务中心 Centro de finanzas',
    departmentId: '1079492125',
    departmentSource: 'id',
    amount: 1000,
    note: '工资',
  }]);
});

test('operation department splits mark old rows without an id as name-only', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '管理支出', value: '工资中国' },
    {
      componentType: 'TableField',
      id: 'TableField_13B0RI3JBQXS0',
      details: [[
        { id: 'DepartmentField_1UHJJHSCID6O0', value: '历史部门' },
        { id: 'MoneyField_T2TFVV7BXN40', value: '1000' },
      ]],
    },
  ]);

  assert.deepEqual(result.salaryByDepartment, [{
    department: '历史部门',
    departmentId: null,
    departmentSource: 'name_only',
    amount: 1000,
    note: '',
  }]);
});
