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

test('backfill-approval-expense-schema writes ecommerce purchase form_name and remaining budget', async () => {
  const databaseModule = loadModule('database');
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;

  await database.ensureApprovalExpenseSchema();

  const businessId = `test-backfill-purchase-${Date.now()}`;
  const processCode = 'PROC-6E11B527-2F82-439C-817D-C868DE086C97';
  const processInstanceId = `pid-${businessId}`;
  const rawData = {
    businessId,
    processCode,
    processType: '采购支出',
    processInstanceId,
    status: 'COMPLETED',
    createTime: '2026-07-08T10:30:00+08:00',
    updateTime: '2026-07-08T10:30:00+08:00',
    originatorDeptName: '电商采购组',
    formComponentValues: [
      { name: '申请日期Fecha de solicitud', value: '2026-07-08' },
      { componentType: 'DepartmentField', value: '电商采购组' },
      { name: '生产/非生产Producción', value: '非生产' },
      { name: '本月预算金额Importe presupuestado', value: '1000.00' },
      { name: '本月预算已用金额Importe utilizado', value: '250.50' },
      { name: '本月预算剩余金额Importe restante del presupuesto mensual', value: '749.50' },
      { name: '采购支出Gastos de Compra', value: '服务类采购' },
      { name: '订单Pedido', value: 'PO-001' },
      { name: '项目Proyecto', value: 'TikTok Shop' },
      { name: '产品Producto', value: '直播设备' },
      { name: '关键凭证Comprobante', value: 'voucher.pdf' },
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
        '测试人提交的电商采购支出',
        processCode,
        '采购支出',
        'COMPLETED',
        '电商采购组',
        '2026-07-08T10:30:00+08:00',
        '2026-07-08T10:30:00+08:00',
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
         monthly_budget_remaining_amount::text as monthly_budget_remaining_amount,
         purchase_expense,
         order_name
       from approval_expense_purchase
       where business_id = $1`,
      [businessId]
    );

    assert.equal(result.rows[0]?.form_name, '电商采购支出');
    assert.equal(result.rows[0]?.monthly_budget_remaining_amount, '749.50');
    assert.equal(result.rows[0]?.purchase_expense, '服务类采购');
    assert.equal(result.rows[0]?.order_name, 'PO-001');
  } finally {
    await pool.query('delete from approval_expense_purchase_payments where purchase_id in (select id from approval_expense_purchase where business_id = $1)', [businessId]);
    await pool.query('delete from approval_expense_purchase_processors where purchase_id in (select id from approval_expense_purchase where business_id = $1)', [businessId]);
    await pool.query('delete from approval_expense_purchase_items where purchase_id in (select id from approval_expense_purchase where business_id = $1)', [businessId]);
    await pool.query('delete from approval_expense_attachments where parent_type = $1 and parent_id in (select id from approval_expense_purchase where business_id = $2)', ['purchase', businessId]);
    await pool.query('delete from approval_expense_purchase where business_id = $1', [businessId]);
    await pool.query('delete from approval_instances where business_id = $1', [businessId]);
    await pool.end();
  }
});
