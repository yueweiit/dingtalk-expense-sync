const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

test('backfill-approval-expense-schema writes new ecommerce operation fields', async () => {
  const databaseModule = loadModule('database');
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;

  await database.ensureApprovalExpenseSchema();

  const businessId = `test-backfill-operation-${Date.now()}`;
  const processCode = 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD';
  const processInstanceId = `pid-${businessId}`;
  const rawData = {
    businessId,
    processCode,
    processType: '运营支出',
    processInstanceId,
    status: 'COMPLETED',
    createTime: '2026-07-01T09:30:00+08:00',
    updateTime: '2026-07-01T09:30:00+08:00',
    originatorDeptName: '测试部门',
    formComponentValues: [
      { name: '申请日期Fecha de solicitud', value: '2026-07-01' },
      { componentType: 'DepartmentField', value: '测试部门' },
      { name: '申请类型Tipo de trámite', value: '运营支出' },
      { name: '支出类型', value: '市场' },
      { name: '执行地区Región de ejecución', value: '中国' },
      { name: '管理支出Gastos de operación', value: '市场推广与广告费用' },
      { name: '事项说明Explicación de asuntos', value: '回填脚本字段一致性测试' },
      { name: '金额importe', value: '100' },
      { name: '币种Moneda', value: '人民币CNY' },
      { name: '平台', value: '抖音Douyin' },
      { name: '平台名称', value: '抖音旗舰店' },
      { name: '店铺名称', value: '测试店铺' },
      { name: '本月预算剩余金额', value: '88.80' },
      { name: '付款详细事由', value: '直播投流预充值' },
    ],
  };

  try {
    await pool.query(
      `insert into approval_instances
        (business_id, title, process_code, process_type, status, originator_dept_name, create_time, update_time, process_instance_id, raw_data)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        businessId,
        '测试人提交的电商运营支出',
        processCode,
        '运营支出',
        'COMPLETED',
        '测试部门',
        '2026-07-01T09:30:00+08:00',
        '2026-07-01T09:30:00+08:00',
        processInstanceId,
        JSON.stringify(rawData),
      ]
    );

    const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const scriptResult = spawnSync(
      process.execPath,
      [tsxCli, 'scripts/backfill-approval-expense-schema.ts', `--businessId=${businessId}`],
      {
        cwd: path.resolve(__dirname, '..'),
        env: process.env,
        encoding: 'utf8',
      }
    );

    assert.equal(scriptResult.status, 0, scriptResult.stderr || scriptResult.stdout);

    const result = await pool.query(
      `select
         form_name,
         platform,
         platform_name,
         store_name,
         monthly_budget_remaining_amount::text as monthly_budget_remaining_amount,
         payment_detail_reason
       from approval_expense_operation
       where business_id = $1`,
      [businessId]
    );

    assert.equal(result.rows[0]?.form_name, '电商运营支出');
    assert.equal(result.rows[0]?.platform, '抖音Douyin');
    assert.equal(result.rows[0]?.platform_name, '抖音旗舰店');
    assert.equal(result.rows[0]?.store_name, '测试店铺');
    assert.equal(result.rows[0]?.monthly_budget_remaining_amount, '88.80');
    assert.equal(result.rows[0]?.payment_detail_reason, '直播投流预充值');
  } finally {
    await pool.query('delete from approval_expense_dept_split where business_id = $1', [businessId]);
    await pool.query('delete from approval_expense_operation where business_id = $1', [businessId]);
    await pool.query('delete from approval_instances where business_id = $1', [businessId]);
    await pool.end();
  }
});
