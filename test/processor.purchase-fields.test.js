const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

process.env.DB_PASSWORD ??= 'test-password';
process.env.DINGTALK_APPKEY ??= 'test-appkey';
process.env.DINGTALK_APPSECRET ??= 'test-appsecret';

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

function getProcessor() {
  const processorModule = loadModule('processor');
  return processorModule.default || processorModule;
}

function getFormSourceModule() {
  return loadModule('form-source');
}

test('parsePurchaseExpenseData extracts ecommerce purchase remaining budget field', () => {
  const processor = getProcessor();
  const result = processor.parsePurchaseExpenseData([
    { name: '申请日期Fecha de solicitud', value: '2026-07-08' },
    { componentType: 'DepartmentField', value: '电商采购组' },
    { name: '生产/非生产Producción', value: '非生产' },
    { name: '本月预算金额Importe presupuestado', value: '1000.00' },
    { name: '本月预算已用金额Importe utilizado', value: '250.50' },
    { name: '本月预算剩余金额Saldo restante del presupuesto mensual', value: '749.50' },
    { name: '采购支出Gastos de Compra', value: '服务类采购' },
    { name: '订单Pedido', value: 'PO-001' },
    { name: '项目Proyecto', value: 'TikTok Shop' },
    { name: '产品Producto', value: '直播设备' },
    { name: '关键凭证Comprobante', value: 'voucher.pdf' },
  ]);

  assert.equal(result.requestDate, '2026-07-08');
  assert.equal(result.applicantDepartment, '电商采购组');
  assert.equal(result.monthlyBudgetAmount, 1000);
  assert.equal(result.monthlyBudgetUsedAmount, 250.5);
  assert.equal(result.monthlyBudgetRemainingAmount, 749.5);
  assert.equal(result.purchaseExpense, '服务类采购');
  assert.equal(result.orderName, 'PO-001');
  assert.equal(result.projectName, 'TikTok Shop');
  assert.equal(result.productName, '直播设备');
  assert.equal(result.keyVoucher, 'voucher.pdf');
});

test('resolvePurchaseFormName maps legacy and ecommerce purchase process codes', () => {
  const formSourceModule = getFormSourceModule();
  const resolvePurchaseFormName =
    formSourceModule.resolvePurchaseFormName || formSourceModule.default?.resolvePurchaseFormName;

  assert.equal(
    resolvePurchaseFormName('PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B'),
    '采购支出'
  );
  assert.equal(
    resolvePurchaseFormName('PROC-6E11B527-2F82-439C-817D-C868DE086C97'),
    '电商采购支出'
  );
  assert.equal(resolvePurchaseFormName('PROC-UNKNOWN'), null);
});
