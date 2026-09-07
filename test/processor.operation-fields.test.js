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

test('parseOperationExpenseData keeps existing operation parsing and split tables unchanged', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '\u7533\u8bf7\u65e5\u671fFecha de solicitud', value: '2026-06-30' },
    { name: '申请部门/组织 Departamento Solicitante', componentType: 'DepartmentField', value: '\u8425\u8fd0\u4e2d\u5fc3' },
    { name: '\u751f\u4ea7/\u975e\u751f\u4ea7Producci\u00f3n', value: '\u975e\u751f\u4ea7' },
    { name: '\u672c\u6708\u9884\u7b97\u91d1\u989dImporte presupuestado', value: '12345.67' },
    { name: '\u672c\u6708\u9884\u7b97\u5df2\u7528\u91d1\u989dImporte utilizado', value: '2345.67' },
    { name: '\u7533\u8bf7\u7c7b\u578bTipo de tr\u00e1mite', value: '\u8fd0\u8425\u652f\u51fa' },
    { name: '\u652f\u51fa\u7c7b\u578b', value: '\u5e02\u573a' },
    { name: '\u6267\u884c\u5730\u533aRegi\u00f3n de ejecuci\u00f3n', value: '\u58a8\u897f\u54e5' },
    {
      name: '\u7ba1\u7406\u652f\u51faGastos de operaci\u00f3n',
      value: '\u5de5\u8d44\u4e2d\u56fd,\u793e\u4fdd\u516c\u79ef\u91d1,\u529e\u516c\u573a\u5730\u603b\u8d39\u7528'
    },
    { name: '\u4e8b\u9879\u8bf4\u660eExplicaci\u00f3n de asuntos', value: '\u65e7\u5b57\u6bb5\u4ecd\u7136\u8981\u89e3\u6790' },
    { name: '\u6536\u6b3e\u4ebabeneficiario', value: 'Alice' },
    { name: '\u91d1\u989dimporte', value: '' },
    { name: '\u91d1\u989dimporte', value: '888.50' },
    { name: '\u4ed8\u6b3e\u6761\u4ef6T\u00e9rminos de pago', value: 'Net 30' },
    { name: '\u5e01\u79cdMoneda', value: '' },
    { name: '\u5e01\u79cdMoneda', value: 'USD' },
    { name: '\u4ed8\u6b3e\u65e5\u671fFecha de pago', value: '2026-07-05' },
    { name: '\u5173\u952e\u51ed\u8bc1Comprobante', value: 'voucher.pdf' },
    {
      componentType: 'TableField',
      id: 'TableField_13B0RI3JBQXS0',
      details: [[
        { id: 'DepartmentField_ROW1', value: '\u8bbe\u8ba1\u90e8' },
        { id: 'MoneyField_T2TFVV7BXN40', value: '1000' },
        { id: 'TextField_SZ57CIDK9J40', value: '\u5de5\u8d44' }
      ]]
    },
    {
      componentType: 'TableField',
      id: 'TableField_G2ELEALN0S80',
      details: [[
        { id: 'DepartmentField_ROW2', value: '\u4eba\u4e8b\u90e8' },
        { id: 'MoneyField_X5KBWAODJ1S0', value: '2000' }
      ]]
    },
    {
      componentType: 'TableField',
      id: 'TableField_9KUR3Y1BQYW0',
      details: [[
        { id: 'DepartmentField_ROW3', value: '\u884c\u653f\u90e8' },
        { id: 'MoneyField_O4L4S81Y0MO0', value: '3000' }
      ]]
    }
  ]);

  assert.equal(result.requestDate, '2026-06-30');
  assert.equal(result.applicantDepartment, '\u8425\u8fd0\u4e2d\u5fc3');
  assert.equal(result.productionType, '\u975e\u751f\u4ea7');
  assert.equal(result.monthlyBudgetAmount, 12345.67);
  assert.equal(result.monthlyBudgetUsedAmount, 2345.67);
  assert.equal(result.applicationType, '\u8fd0\u8425\u652f\u51fa');
  assert.equal(result.expenseType, '\u5e02\u573a');
  assert.equal(result.executionRegion, '\u58a8\u897f\u54e5');
  assert.equal(result.operationExpense, '\u5de5\u8d44\u4e2d\u56fd,\u793e\u4fdd\u516c\u79ef\u91d1,\u529e\u516c\u573a\u5730\u603b\u8d39\u7528');
  assert.equal(result.matterDescription, '\u65e7\u5b57\u6bb5\u4ecd\u7136\u8981\u89e3\u6790');
  assert.equal(result.beneficiary, 'Alice');
  assert.equal(result.amount, 888.5);
  assert.equal(result.paymentTerms, 'Net 30');
  assert.equal(result.currency, 'USD');
  assert.equal(result.paymentDate, '2026-07-05');
  assert.equal(result.keyVoucher, 'voucher.pdf');
  assert.deepEqual(result.salaryByDepartment, [
    { department: '\u8bbe\u8ba1\u90e8', departmentId: null, departmentSource: 'name_only', amount: 1000, note: '\u5de5\u8d44' }
  ]);
  assert.deepEqual(result.socialInsuranceByDepartment, [
    { department: '\u4eba\u4e8b\u90e8', departmentId: null, departmentSource: 'name_only', amount: 2000, note: '' }
  ]);
  assert.deepEqual(result.officeSpaceByDepartment, [
    { department: '\u884c\u653f\u90e8', departmentId: null, departmentSource: 'name_only', amount: 3000, note: '' }
  ]);
});

test('parseOperationExpenseData ignores retired platform fields and keeps ecommerce sales fields', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '\u5e73\u53f0\u540d\u79f0', value: 'Amazon MX' },
    { name: '\u5e73\u53f0', value: 'Amazon' },
    { name: '\u5e97\u94fa\u540d\u79f0', value: 'North Store' },
    { name: '\u672c\u6708\u9884\u7b97\u5269\u4f59\u91d1\u989d', value: '9988.66' },
    { name: '\u4ed8\u6b3e\u8be6\u7ec6\u4e8b\u7531', value: '\u7ad9\u5185\u5e7f\u544a\u9884\u5145' },
    { name: '\u9500\u552e\u8d39\u7528', value: '\u5e7f\u544a\u6295\u653e' },
    { name: '\u9500\u552e\u6e20\u9053\u7ba1\u7406\u4e0e\u4f63\u91d1\u8d39\u7528', value: '\u5e73\u53f0\u4f63\u91d1' },
    { name: '\u91d1\u989dimporte', value: '12.30' },
    { name: '\u5e01\u79cdMoneda', value: 'USD' }
  ]);

  assert.equal(result.platform, null);
  assert.equal(result.platformName, null);
  assert.equal(result.storeName, null);
  assert.equal(result.monthlyBudgetRemainingAmount, 9988.66);
  assert.equal(result.paymentDetailReason, '\u7ad9\u5185\u5e7f\u544a\u9884\u5145');
  assert.equal(result.salesExpense, '\u5e7f\u544a\u6295\u653e');
  assert.equal(result.salesChannelCommissionExpense, '\u5e73\u53f0\u4f63\u91d1');
  assert.equal(result.salaryByDepartment, null);
  assert.equal(result.socialInsuranceByDepartment, null);
  assert.equal(result.officeSpaceByDepartment, null);
  assert.equal(result.amount, 12.3);
  assert.equal(result.currency, 'USD');
});

test('parseOperationExpenseData leaves new fields empty when old forms do not provide them', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '\u7533\u8bf7\u7c7b\u578b', value: '\u8fd0\u8425\u652f\u51fa' },
    { name: '\u91d1\u989dimporte', value: '55.50' }
  ]);

  assert.equal(result.applicationType, '\u8fd0\u8425\u652f\u51fa');
  assert.equal(result.amount, 55.5);
  assert.equal(result.platform, null);
  assert.equal(result.platformName, null);
  assert.equal(result.storeName, null);
  assert.equal(result.monthlyBudgetRemainingAmount, null);
  assert.equal(result.paymentDetailReason, null);
  assert.equal(result.businessEntity, null);
});

test('parseOperationExpenseData archives business entity without changing applicant department identity', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '申请部门/组织 Departamento Solicitante', componentType: 'DepartmentField', value: '广州凌翔', extendValue: '{"id":"1089383728"}' },
    { name: '业务主体', value: '星铭' },
  ]);

  assert.equal(result.businessEntity, '星铭');
  assert.equal(result.applicantDepartment, '广州凌翔');
  assert.equal(result.applicantDepartmentId, '1089383728');
});

test('parseOperationExpenseData keeps retired bilingual platform fields empty', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '\u672c\u6708\u9884\u7b97\u5269\u4f59\u91d1\u989dSaldo restante del presupuesto mensual', value: '0.00' },
    { name: '\u5e73\u53f0plataforma de comercio electr\u00f3nico', value: '\u6296\u97f3Douyin' },
    { name: '\u5e73\u53f0\u540d\u79f0Nombre de la plataforma', value: '' },
    { name: '\u5e97\u94fa\u540d\u79f0Nombre de la tienda', value: '\u6d4b\u8bd5' },
    { name: '\u91d1\u989dimporte', value: '10000' },
    { name: '\u5e01\u79cdMoneda', value: '\u4eba\u6c11\u5e01RMB' }
  ]);

  assert.equal(result.platform, null);
  assert.equal(result.platformName, null);
  assert.equal(result.storeName, null);
  assert.equal(result.monthlyBudgetRemainingAmount, 0);
});

test('parses reserve-fund department details only for the designated completed form', () => {
  const processor = getProcessor();
  const result = processor.parseOperationExpenseData([
    { name: '管理支出Gastos de operación', value: '备用金' },
    {
      componentType: 'TableField',
      id: 'TableField_reserve_fund',
      name: '备用金明细',
      details: [[
        { id: 'DepartmentField_ROW1', value: '测试部门' },
        { id: 'NumberField_reserve_fund', name: '备用金金额', value: '100' },
      ]],
    },
  ], {
    processCode: 'PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B',
    status: 'COMPLETED',
    result: 'AGREE',
  });

  assert.deepEqual(result.bonusByDepartment, [
    { department: '测试部门', departmentId: null, departmentSource: 'name_only', amount: 100, note: '' },
  ]);
});

test('parses office equipment details only for the designated completed form', () => {
  const processor = getProcessor();
  const components = [
    {
      name: '\u7ba1\u7406\u8d39\u7528Gastos administrativos',
      value: '\u529e\u516c\u8bbe\u5907\u7684\u8d2d\u7f6e\u3001\u7ef4\u4fee\u6216\u79df\u8d41\u8d39',
    },
    {
      componentType: 'TableField',
      id: 'TableField_rental_details',
      name: '\u79df\u8d41\u660e\u7ec6',
      details: [[
        { id: 'DepartmentField_office_equipment', value: '\u6d4b\u8bd5\u90e8\u95e8' },
        { id: 'MoneyField_rental_amount', name: '\u91d1\u989d\uff08\u5143\uff09 Monto (yuan)', value: '456.78' },
        { id: 'TextField_rental_note', name: '\u5907\u6ce8Nota', value: '\u529e\u516c\u8bbe\u5907\u62c6\u5206' },
      ]],
    },
    {
      componentType: 'TableField',
      id: 'TableField_13B0RI3JBQXS0',
      name: '\u5de5\u8d44\u4e2d\u56fd',
      details: [[
        { id: 'DepartmentField_salary', value: '\u4e0d\u5e94\u8bfb\u53d6\u90e8\u95e8' },
        { id: 'MoneyField_T2TFVV7BXN40', value: '999.99' },
      ]],
    },
  ];
  const completed = {
    processCode: 'PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B',
    status: 'COMPLETED',
    result: 'AGREE',
  };

  const result = processor.parseOperationExpenseData(components, completed);
  assert.equal(result.salaryByDepartment, null);
  assert.deepEqual(result.officeEquipmentByDepartment, [{
    department: '\u6d4b\u8bd5\u90e8\u95e8',
    departmentId: null,
    departmentSource: 'name_only',
    amount: 456.78,
    note: '\u529e\u516c\u8bbe\u5907\u62c6\u5206',
  }]);

  assert.equal(
    processor.parseOperationExpenseData(components, { ...completed, status: 'RUNNING' }).officeEquipmentByDepartment,
    null,
  );
  assert.equal(
    processor.parseOperationExpenseData(components, { ...completed, processCode: 'PROC-OTHER' }).officeEquipmentByDepartment,
    null,
  );
});

test('resolveOperationFormName maps old and new operation process codes to stable form names', () => {
  const formSourceModule = getFormSourceModule();
  const resolveOperationFormName =
    formSourceModule.resolveOperationFormName || formSourceModule.default?.resolveOperationFormName;

  assert.equal(
    resolveOperationFormName('PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA'),
    '\u8fd0\u8425\u652f\u51fa'
  );
  assert.equal(
    resolveOperationFormName('PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD'),
    '\u7535\u5546\u8fd0\u8425\u652f\u51fa'
  );
  assert.equal(
    resolveOperationFormName('PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8'),
    '\u60a6\u4e3a\u667a\u80fd\u8fd0\u8425\u652f\u51fa'
  );
  assert.equal(resolveOperationFormName('PROC-UNKNOWN'), null);
});

test('Yuewei Intelligent operation form uses its fixed department', () => {
  const formSourceModule = getFormSourceModule();
  const resolveFixedDepartment =
    formSourceModule.resolveFixedApplicantDepartment || formSourceModule.default?.resolveFixedApplicantDepartment;

  assert.equal(
    resolveFixedDepartment('PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8'),
    '\u60a6\u4e3a\u667a\u80fd YW Tech_Ai'
  );
  assert.equal(resolveFixedDepartment('PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA'), null);
});

test('resolveOperationFormName maps Xingming and Lingxiang operation forms', () => {
  const formSourceModule = getFormSourceModule();
  const resolveOperationFormName =
    formSourceModule.resolveOperationFormName || formSourceModule.default?.resolveOperationFormName;

  assert.equal(
    resolveOperationFormName('PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B'),
    '\u51cc\u7fd4\u661f\u94ed\u8fd0\u8425\u652f\u51fa'
  );
  assert.equal(resolveOperationFormName('PROC-A4AA23BD-8980-4098-87E8-6898667371CC'), null);
  assert.equal(
    resolveOperationFormName('PROC-14972EC1-2E3B-47DA-8346-9B1DBFE578C5'),
    '\u5e7f\u5dde\u51cc\u7fd4\u8fd0\u8425\u652f\u51fa'
  );
});

test('getStandaloneOperationProcessCodes returns isolated process-code lists for legacy and ecommerce sync', () => {
  const formSourceModule = getFormSourceModule();
  const getStandaloneOperationProcessCodes =
    formSourceModule.getStandaloneOperationProcessCodes || formSourceModule.default?.getStandaloneOperationProcessCodes;

  assert.deepEqual(
    getStandaloneOperationProcessCodes('legacy'),
    ['PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA']
  );
  assert.deepEqual(
    getStandaloneOperationProcessCodes('ecommerce'),
    ['PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD']
  );
});
