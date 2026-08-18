const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PASSWORD ??= 'test-password';

function loadModule(moduleName) {
  const srcPath = path.join('..', 'src', moduleName);
  const distPath = path.join('..', 'dist', 'src', moduleName);
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(distPath);
  }
}

const processorModule = loadModule('processor');
const databaseModule = loadModule('database');
const operationDeptSplitsModule = loadModule('operation-dept-splits');
const processor = processorModule.default || processorModule;
const database = databaseModule.default || databaseModule;
const pool = databaseModule.pool || databaseModule.default?.pool;
const collectOperationDeptSplits =
  operationDeptSplitsModule.collectOperationDeptSplits || operationDeptSplitsModule.default?.collectOperationDeptSplits;

test('collectOperationDeptSplits converts configured split arrays and ignores empty ecommerce splits', () => {
  assert.deepEqual(
    collectOperationDeptSplits({
      salaryByDepartment: [{ department: '设计部', amount: 100, note: '工资' }],
      socialInsuranceByDepartment: [{ department: '人事部', amount: 200 }],
      officeSpaceByDepartment: [{ department: '行政部', amount: 300 }],
    }),
    [
      { splitType: 'salary', department: '设计部', departmentId: null, departmentSource: 'name_only', departmentPathIds: null, departmentPathNames: null, amount: 100, note: '工资' },
      { splitType: 'social_insurance', department: '人事部', departmentId: null, departmentSource: 'name_only', departmentPathIds: null, departmentPathNames: null, amount: 200, note: undefined },
      { splitType: 'office_space', department: '行政部', departmentId: null, departmentSource: 'name_only', departmentPathIds: null, departmentPathNames: null, amount: 300, note: undefined },
    ]
  );

  assert.deepEqual(
    collectOperationDeptSplits({
      salaryByDepartment: null,
      socialInsuranceByDepartment: null,
      officeSpaceByDepartment: null,
    }),
    []
  );
});

function operationInstance(businessId, status, tasks = []) {
  return {
    businessId,
    processInstanceId: `pid-${businessId}`,
    processCode: 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD',
    processType: '运营支出',
    status,
    createTime: '2026-07-12T10:00:00+08:00',
    tasks,
    formComponentValues: [
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '申请日期', value: '2026-07-12' },
      { name: '生产/非生产', value: '非生产' },
      { name: '管理支出', value: '工资中国' },
      { name: '金额importe', value: '100' },
      { name: '币种Moneda', value: '人民币RMB' },
      {
        componentType: 'TableField',
        id: 'TableField_13B0RI3JBQXS0',
        details: [[
          { id: 'DepartmentField_ROW1', value: '测试部门' },
          { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
          { id: 'TextField_SZ57CIDK9J40', value: '工资拆分' },
        ]],
      },
    ],
  };
}

function ywIntelligentOperationInstance(businessId) {
  return {
    ...operationInstance(businessId, 'RUNNING'),
    processCode: 'PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8',
    formComponentValues: [
      { name: '申请日期', value: '2026-07-20' },
      { name: '金额importe', value: '100' },
      { name: '币种Moneda', value: '人民币RMB' },
    ],
  };
}

function individualIncomeTaxInstance(businessId) {
  return {
    businessId,
    processInstanceId: `pid-${businessId}`,
    processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
    processType: '运营支出',
    status: 'RUNNING',
    createTime: '2026-07-16T10:00:00+08:00',
    formComponentValues: [
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '申请日期', value: '2026-07-16' },
      { name: '生产/非生产', value: '非生产' },
      { name: '税费Impuestos', value: '个税' },
      { name: '金额importe', value: '1234.56' },
      { name: '币种Moneda', value: '人民币RMB' },
      {
        componentType: 'TableField',
        name: '薪酬税费总支出(分部门)',
        details: [[
          { id: 'DepartmentField_TAX_1', value: '测试部门' },
          { id: 'MoneyField_TAX_1', value: '1234.56' },
          { id: 'TextField_TAX_1', value: '六月个税' },
        ]],
      },
    ],
  };
}

async function splitCount(businessId) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM approval_expense_dept_split WHERE business_id = $1',
    [businessId]
  );
  return result.rows[0].count;
}

async function clean(businessId) {
  await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
  await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
}

test('审批中运营单据保留部门拆分', async () => {
  const businessId = `test-split-running-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(operationInstance(businessId, 'RUNNING'));
    assert.equal(await splitCount(businessId), 1);
  } finally {
    await clean(businessId);
  }
});

test('悦为智能运营支出只在没有真实部门时使用固定部门兜底', async () => {
  const businessId = `test-yw-intelligent-operation-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(ywIntelligentOperationInstance(businessId));
    const result = await pool.query(
      `select form_name, applicant_department, creator_department
       from approval_expense_operation
       where business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows[0], {
      form_name: '悦为智能运营支出',
      applicant_department: '悦为智能 YW Tech_Ai',
      creator_department: null,
    });
  } finally {
    await clean(businessId);
  }
});

test('个税分部门明细会写入运营主表和部门拆分表', async () => {
  const businessId = `test-split-tax-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(individualIncomeTaxInstance(businessId));

    const operation = await pool.query(
      'SELECT individual_income_tax_by_department FROM approval_expense_operation WHERE business_id = $1',
      [businessId]
    );
    assert.deepEqual(operation.rows[0].individual_income_tax_by_department, [
      { department: '测试部门', departmentId: null, departmentSource: 'name_only', amount: 1234.56, note: '六月个税' },
    ]);

    const splits = await pool.query(
      'SELECT split_type, department, amount::text AS amount, note FROM approval_expense_dept_split WHERE business_id = $1',
      [businessId]
    );
    assert.deepEqual(splits.rows, [{
      split_type: 'individual_income_tax',
      department: '测试部门',
      amount: '1234.56',
      note: '六月个税',
    }]);
  } finally {
    await clean(businessId);
  }
});

test('运营单据变为已撤回后清理历史部门拆分', async () => {
  const businessId = `test-split-terminated-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(operationInstance(businessId, 'RUNNING'));
    assert.equal(await splitCount(businessId), 1);

    await processor.processInstance(operationInstance(businessId, 'TERMINATED'));
    assert.equal(await splitCount(businessId), 0);
  } finally {
    await clean(businessId);
  }
});

test('最终完成单据保留部门拆分，即使任务历史包含驳回', async () => {
  const businessId = `test-split-refused-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(operationInstance(businessId, 'RUNNING'));
    assert.equal(await splitCount(businessId), 1);

    await processor.processInstance({
      ...operationInstance(businessId, 'COMPLETED', [{ userId: 'approver-1', result: 'REFUSE' }]),
      result: 'AGREE',
    });
    assert.equal(await splitCount(businessId), 1);
  } finally {
    await clean(businessId);
  }
});

test('最终驳回单据清理历史部门拆分', async () => {
  const businessId = `test-split-final-refused-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(operationInstance(businessId, 'RUNNING'));
    assert.equal(await splitCount(businessId), 1);

    await processor.processInstance({
      ...operationInstance(businessId, 'COMPLETED'),
      result: 'REFUSE',
    });
    assert.equal(await splitCount(businessId), 0);
  } finally {
    await clean(businessId);
  }
});

test('部门拆分回填会清理已撤回单据的历史拆分', async () => {
  const businessId = `test-split-backfill-terminated-${Date.now()}`;
  const expenseModule = loadModule(path.join('database', 'expense'));
  const backfillDeptSplits = expenseModule.backfillDeptSplits || expenseModule.default?.backfillDeptSplits;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(operationInstance(businessId, 'RUNNING'));
    assert.equal(await splitCount(businessId), 1);

    await pool.query(
      "UPDATE approval_expense_operation SET approval_status = 'TERMINATED' WHERE business_id = $1",
      [businessId]
    );
    await backfillDeptSplits();
    assert.equal(await splitCount(businessId), 0);
  } finally {
    await clean(businessId);
  }
});

test.after(async () => {
  await pool.end();
});
