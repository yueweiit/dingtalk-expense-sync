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
const processor = processorModule.default || processorModule;
const database = databaseModule.default || databaseModule;
const pool = databaseModule.pool || databaseModule.default?.pool;

test.after(async () => {
  await pool.end();
});

function runningOperation(businessId) {
  return {
    businessId,
    processInstanceId: `pid-${businessId}`,
    processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
    processType: '运营支出',
    status: 'RUNNING',
    createTime: '2026-08-05T10:00:00+08:00',
    formComponentValues: [
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '申请日期', value: '2026-08-05' },
      { name: '生产/非生产', value: '非生产' },
      { name: '金额importe', value: '100' },
      { name: '币种Moneda', value: '人民币RMB' },
    ],
    operationRecords: [{
      type: 'ADD_REMARK',
      date: '2026-08-05T12:00:00+08:00',
      userId: '57521312381178275',
      remark: '已支付30元',
    }],
  };
}

function runningOperationWithoutCommentAmount(businessId) {
  return {
    ...runningOperation(businessId),
    operationRecords: [{
      type: 'ADD_REMARK',
      date: '2026-08-05T12:00:00+08:00',
      userId: '57521312381178275',
      remark: '\u5df2\u652f\u4ed8\uff0c\u51ed\u8bc1\u89c1\u9644\u4ef6',
    }],
  };
}

function runningSalaryOperation(businessId) {
  return {
    ...runningOperation(businessId),
    formComponentValues: [
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '申请日期', value: '2026-08-05' },
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

function runningBonusOperation(businessId) {
  return {
    ...runningOperation(businessId),
    processCode: 'PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B',
    formComponentValues: [
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '管理支出Gastos de operación', value: '奖金 Bonificaciones' },
      { name: '金额importe', value: '100' },
      { name: '币种Moneda', value: '人民币RMB' },
      {
        componentType: 'TableField',
        id: 'TableField_bonus',
        name: '奖金明细 Bonificaciones',
        details: [[
          { id: 'DepartmentField_ROW1', value: '测试部门' },
          { id: 'NumberField_bonus', name: '奖金金额 Importe', value: '100' },
        ]],
      },
    ],
  };
}

test('records an authorized payment event once and does not create another on completion', async () => {
  const businessId = `test-payment-event-processor-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(runningOperation(businessId));
    let result = await pool.query(
      'select amount, paid_at from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].amount), 30);

    await processor.processInstance({
      ...runningOperation(businessId),
      status: 'COMPLETED',
      result: 'AGREE',
      endTime: '2026-08-06T12:00:00+08:00',
    });
    result = await pool.query(
      'select count(*)::int as count from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows[0].count, 1);
  } finally {
    await pool.query('delete from approval_expense_payment_events where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
  }
});

test('uses the operation form amount when an authorized paid comment omits the amount', async () => {
  const businessId = `test-payment-event-form-fallback-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(runningOperationWithoutCommentAmount(businessId));
    const result = await pool.query(
      'select amount, raw_data->>\'paymentAmountSource\' as amount_source from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].amount), 100);
    assert.equal(result.rows[0].amount_source, 'form_amount_fallback');
  } finally {
    await pool.query('delete from approval_expense_payment_events where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
  }
});

test('does not create a pending payment event for an operation with department splits', async () => {
  const businessId = `test-payment-event-salary-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(runningSalaryOperation(businessId));
    const result = await pool.query(
      'select count(*)::int as count from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows[0].count, 0);
  } finally {
    await pool.query('delete from approval_expense_payment_events where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
  }
});

test('does not create a pending payment event for the designated bonus form', async () => {
  const businessId = `test-payment-event-bonus-${Date.now()}`;
  await database.ensureApprovalExpenseSchema();
  try {
    await processor.processInstance(runningBonusOperation(businessId));
    const result = await pool.query(
      'select count(*)::int as count from approval_expense_payment_events where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows[0].count, 0);
  } finally {
    await pool.query('delete from approval_expense_payment_events where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
  }
});
