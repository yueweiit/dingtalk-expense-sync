const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PASSWORD ??= 'test-password';

function loadModule(moduleName) {
  const sourcePath = path.join('..', 'src', moduleName);
  const module = require(sourcePath);
  return module.default || module;
}

const processorModule = require(path.join('..', 'src', 'processor.ts'));
const processor = processorModule.default || processorModule;
const ApprovalProcessor = processorModule.ApprovalProcessor;
const databaseModule = require(path.join('..', 'src', 'database'));
const database = databaseModule.default || databaseModule;
const pool = databaseModule.pool || databaseModule.default?.pool;

test('department split writes the selected department id and source', async () => {
  const businessId = `test-department-identity-${Date.now()}`;
  const processorWithoutPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map(),
  });
  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithoutPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [[
            {
              id: 'DepartmentField_1UHJJHSCID6O0',
              value: 'FC CN财务中心 Centro de finanzas',
              extendValue: [{ id: '1079492125' }],
            },
            { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
          ]],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department, department_id, department_source,
              department_path_ids, department_path_names
       FROM approval_expense_dept_split
       WHERE business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows, [{
      department: 'FC CN财务中心 Centro de finanzas',
      department_id: '1079492125',
      department_source: 'id',
      department_path_ids: null,
      department_path_names: null,
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('department split writes a path snapshot when OA has an unambiguous department id', async () => {
  const businessId = `test-department-path-${Date.now()}`;
  const processorWithPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async (departmentIds) => {
    assert.deepEqual(departmentIds, ['1079492125']);
    return new Map([['1079492125', {
      department: 'FC CN财务中心 Centro de finanzas',
      departmentPathIds: ['1', '1004758048', '1059222339', '1059287403', '1079492125'],
      departmentPathNames: ['ROOT', 'YUEWEI', '管理规划中心', 'FC 财务中心', 'FC CN财务中心'],
    }]]);
    },
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [[
            {
              id: 'DepartmentField_1UHJJHSCID6O0',
              value: 'FC CN财务中心 Centro de finanzas',
              extendValue: [{ id: '1079492125' }],
            },
            { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
          ]],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department_path_ids, department_path_names
       FROM approval_expense_dept_split
       WHERE business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows, [{
      department_path_ids: ['1', '1004758048', '1059222339', '1059287403', '1079492125'],
      department_path_names: ['ROOT', 'YUEWEI', '管理规划中心', 'FC 财务中心', 'FC CN财务中心'],
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('department splits keep same-name departments separate when their ids differ', async () => {
  const businessId = `test-department-identity-duplicate-name-${Date.now()}`;
  const processorWithoutPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map(),
  });
  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithoutPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '300' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [
            [
              { id: 'DepartmentField_1UHJJHSCID6O0', value: '同名部门', extendValue: [{ id: '100' }] },
              { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
            ],
            [
              { id: 'DepartmentField_1UHJJHSCID6O0', value: '同名部门', extendValue: [{ id: '200' }] },
              { id: 'MoneyField_T2TFVV7BXN40', value: '200' },
            ],
          ],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department_id, amount
       FROM approval_expense_dept_split
       WHERE business_id = $1
       ORDER BY department_id`,
      [businessId]
    );
    assert.deepEqual(result.rows, [
      { department_id: '100', amount: '100.00' },
      { department_id: '200', amount: '200.00' },
    ]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test.after(async () => {
  await pool.end();
});
