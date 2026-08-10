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

test('parsePurchaseExpenseData keeps purchase detail tables and normalizes customs multi-select values', () => {
  const processor = getProcessor();
  const result = processor.parsePurchaseExpenseData([
    {
      name: '采购需求明细Detalle de requisitos de compra',
      componentType: 'TableField',
      value: JSON.stringify([
        {
          物品名称: '手机壳',
          编码: 'CASE-001',
          规格: '透明',
          数量: '10',
          库存: '2',
          单位: '个',
          单价: '8.16',
          总金额: '81.60',
        },
      ]),
    },
    {
      name: '加工商明细Detalle de procesadores',
      componentType: 'TableField',
      value: JSON.stringify([
        {
          加工商名字: '测试加工商',
          加工商电话: '13800000000',
          ODT: 'ODT-001',
          销售订单: 'SO-001',
          加工物料: '塑料',
          数量: '5',
          单价: '3.20',
          总金额: '16.00',
          需求说明: '透明注塑',
          交付日期: '2026-07-31',
        },
      ]),
    },
    {
      name: '清关服务Servicios de despacho aduanero',
      value: JSON.stringify(['报关服务', '清关代理', '报关服务']),
    },
  ]);

  assert.deepEqual(
    result.items?.map(({ rowNo, itemName, itemCode, quantity, totalAmount }) => ({
      rowNo,
      itemName,
      itemCode,
      quantity,
      totalAmount,
    })),
    [{ rowNo: 1, itemName: '手机壳', itemCode: 'CASE-001', quantity: 10, totalAmount: 81.6 }]
  );
  assert.deepEqual(
    result.processors?.map(({ rowNo, processorName, odt, quantity, totalAmount }) => ({
      rowNo,
      processorName,
      odt,
      quantity,
      totalAmount,
    })),
    [{ rowNo: 1, processorName: '测试加工商', odt: 'ODT-001', quantity: 5, totalAmount: 16 }]
  );
  assert.equal(result.customsClearanceService, '报关服务、清关代理');
});

test('parsePurchaseExpenseData archives business and service entities without changing the applicant department', () => {
  const processor = getProcessor();
  const result = processor.parsePurchaseExpenseData([
    { componentType: 'DepartmentField', value: '东莞星铭', extendValue: '{"id":"1109001296"}' },
    { name: '业务主体Empresa', value: '凌翔' },
    { name: '服务主体Cliente', value: '拉丁购' },
  ]);

  assert.equal(result.businessEntity, '凌翔');
  assert.equal(result.serviceEntity, '拉丁购');
  assert.equal(result.applicantDepartment, '东莞星铭');
  assert.equal(result.applicantDepartmentId, '1109001296');
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
  assert.equal(
    resolvePurchaseFormName('PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF'),
    '悦为智能采购支出'
  );
  assert.equal(resolvePurchaseFormName('PROC-UNKNOWN'), null);
});

test('Yuewei Intelligent purchase form uses its fixed department', () => {
  const formSourceModule = getFormSourceModule();
  const resolveFixedDepartment =
    formSourceModule.resolveFixedApplicantDepartment || formSourceModule.default?.resolveFixedApplicantDepartment;

  assert.equal(
    resolveFixedDepartment('PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF'),
    '悦为智能 YW Tech_Ai'
  );
  assert.equal(resolveFixedDepartment('PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B'), null);
});

test('resolvePurchaseFormName maps Xingming and Lingxiang purchase forms', () => {
  const formSourceModule = getFormSourceModule();
  const resolvePurchaseFormName =
    formSourceModule.resolvePurchaseFormName || formSourceModule.default?.resolvePurchaseFormName;

  assert.equal(
    resolvePurchaseFormName('PROC-E69FCD3E-E374-4C54-9D8F-6E1F55AD741F'),
    '\u51cc\u7fd4\u661f\u94ed\u91c7\u8d2d\u652f\u51fa'
  );
  assert.equal(
    resolvePurchaseFormName('PROC-866867B6-1F7B-4F70-AB8F-3500D6560785'),
    '\u5e7f\u5dde\u51cc\u7fd4\u91c7\u8d2d\u652f\u51fa'
  );
});
