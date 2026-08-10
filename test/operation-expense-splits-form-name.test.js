const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

function loadModule(moduleName) {
  const srcPath = path.join('..', 'src', moduleName);
  const distPath = path.join('..', 'dist', 'src', moduleName);
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(distPath);
  }
}

test('upsertOperationExpenseWithSplits preserves form_name on insert and update', async () => {
  const databaseModule = loadModule('database');
  const expenseModule = loadModule(path.join('database', 'expense'));
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;
  const upsertOperationExpenseWithSplits =
    expenseModule.upsertOperationExpenseWithSplits || expenseModule.default?.upsertOperationExpenseWithSplits;

  await database.ensureApprovalExpenseSchema();

  const businessId = `test-split-form-name-${Date.now()}`;
  const payload = {
    processInstanceId: `pid-${businessId}`,
    businessId,
    requestDate: '2026-07-01',
    applicantDepartment: '测试部门',
    productionType: '非生产',
    monthlyBudgetAmount: 100,
    monthlyBudgetUsedAmount: 40,
    monthlyBudgetRemainingAmount: 60,
    applicationType: '运营支出',
    expenseType: '市场',
    executionRegion: '中国',
    businessEntity: '凌翔',
    operationExpense: '工资中国',
    amount: 10,
    baseCurrencyAmount: 10,
    currency: 'CNY',
    approvalStatus: 'COMPLETED',
    sourceCreatedAt: '2026-07-01T10:00:00+08:00',
    sourceUpdatedAt: '2026-07-01T10:00:00+08:00',
    rawData: { processCode: 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD' },
  };
  const splits = [
    { splitType: 'salary', department: '测试部门', amount: 10, note: '回归测试' },
  ];

  try {
    await upsertOperationExpenseWithSplits({
      ...payload,
      formName: '运营支出',
    }, splits);

    let result = await pool.query(
      'select form_name, business_entity from approval_expense_operation where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows[0]?.form_name, '运营支出');
    assert.equal(result.rows[0]?.business_entity, '凌翔');

    await upsertOperationExpenseWithSplits({
      ...payload,
      formName: '电商运营支出',
      businessEntity: '星铭',
    }, splits);

    result = await pool.query(
      'select form_name, business_entity from approval_expense_operation where business_id = $1',
      [businessId]
    );
    assert.equal(result.rows[0]?.form_name, '电商运营支出');
    assert.equal(result.rows[0]?.business_entity, '星铭');
  } finally {
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
    await pool.end();
  }
});
