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

function getProcessConfigModule() {
  return loadModule('process-config');
}

function expectedProcessTypeMap() {
  const forms = loadModule('form-source');
  return {
    operation: [
      forms.OLD_OPERATION_FORM_CODE,
      forms.NEW_ECOMMERCE_OPERATION_FORM_CODE,
      forms.YW_INTELLIGENT_OPERATION_FORM_CODE,
      forms.LINGXIANG_XINGMING_OPERATION_FORM_CODE,
      forms.LEMOS_OPERATION_FORM_CODE,
      forms.MOLD_PRINT_OPERATION_FORM_CODE,
      forms.YUEWEI_MX_OPERATION_FORM_CODE,
    ],
    purchase: [
      forms.OLD_PURCHASE_FORM_CODE,
      forms.NEW_ECOMMERCE_PURCHASE_FORM_CODE,
      forms.YW_INTELLIGENT_PURCHASE_FORM_CODE,
      forms.LINGXIANG_XINGMING_PURCHASE_FORM_CODE,
      forms.LEMOS_PURCHASE_FORM_CODE,
      forms.MOLD_PRINT_PURCHASE_FORM_CODE,
      forms.YUEWEI_MX_PURCHASE_FORM_CODE,
    ],
    monthly_settlement: [forms.MONTHLY_SETTLEMENT_PAYMENT_FORM_CODE],
  };
}

test('strict process mapping keeps all known process codes in their required groups', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();

  assert.deepEqual(
    processConfig.validateProcessTypeMap(processTypeMap),
    processTypeMap
  );
  assert.deepEqual(
    processConfig.getConfiguredProcessCodes({ processTypeMap }),
    [
      ...processTypeMap.operation,
      ...processTypeMap.purchase,
      ...processTypeMap.monthly_settlement,
    ]
  );
});

test('strict process mapping rejects a known operation code placed in purchase', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();
  const oldOperationCode = processTypeMap.operation.shift();
  processTypeMap.purchase.push(oldOperationCode);

  assert.throws(
    () => processConfig.validateProcessTypeMap(processTypeMap),
    /operation|运营/i
  );
});

test('strict process mapping rejects a missing known process code', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();
  processTypeMap.purchase.pop();

  assert.throws(
    () => processConfig.validateProcessTypeMap(processTypeMap),
    /missing|缺少/i
  );
});

test('strict process mapping rejects a code assigned to both groups', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();
  processTypeMap.purchase.push(processTypeMap.operation[0]);

  assert.throws(
    () => processConfig.validateProcessTypeMap(processTypeMap),
    /both|同时/i
  );
});

test('strict process mapping rejects duplicate codes within one group', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();
  processTypeMap.operation.push(processTypeMap.operation[0]);

  assert.throws(
    () => processConfig.validateProcessTypeMap(processTypeMap),
    /重复|duplicate/i
  );
});

test('process mapping accepts the camelCase monthly settlement alias', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();
  const { monthly_settlement: monthlySettlement, ...legacyMap } = processTypeMap;

  const aliasedMap = { ...legacyMap, monthlySettlement };
  assert.equal(processConfig.getProcessKind(monthlySettlement[0], { processTypeMap: aliasedMap }), 'monthly_settlement');
  assert.deepEqual(processConfig.validateProcessTypeMap(aliasedMap), processTypeMap);
});

test('process kind only comes from the explicit process type map', () => {
  const processConfig = getProcessConfigModule();
  const processTypeMap = expectedProcessTypeMap();

  assert.equal(
    processConfig.getProcessKind(processTypeMap.operation[0], { processTypeMap }),
    'operation'
  );
  assert.equal(
    processConfig.getProcessKind(processTypeMap.purchase[0], { processTypeMap }),
    'purchase'
  );
  assert.equal(
    processConfig.getProcessKind('PROC-UNKNOWN', { processTypeMap }),
    'other'
  );
});

test('strict process mapping keeps Yuewei Intelligent codes in their required groups', () => {
  const processConfig = getProcessConfigModule();
  const forms = loadModule('form-source');
  const processTypeMap = expectedProcessTypeMap();

  assert.equal(forms.YW_INTELLIGENT_OPERATION_FORM_CODE, 'PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8');
  assert.equal(forms.YW_INTELLIGENT_PURCHASE_FORM_CODE, 'PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF');
  assert.equal(
    processConfig.getProcessKind(forms.YW_INTELLIGENT_OPERATION_FORM_CODE, { processTypeMap }),
    'operation'
  );
  assert.equal(
    processConfig.getProcessKind(forms.YW_INTELLIGENT_PURCHASE_FORM_CODE, { processTypeMap }),
    'purchase'
  );
});

test('strict process mapping keeps the combined Lingxiang/Xingming codes active and retired codes inactive', () => {
  const processConfig = getProcessConfigModule();
  const forms = loadModule('form-source');
  const processTypeMap = expectedProcessTypeMap();

  assert.equal(forms.LINGXIANG_XINGMING_OPERATION_FORM_CODE, 'PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B');
  assert.equal(forms.LINGXIANG_XINGMING_PURCHASE_FORM_CODE, 'PROC-E69FCD3E-E374-4C54-9D8F-6E1F55AD741F');
  assert.equal(forms.RETIRED_LINGXIANG_GUANGZHOU_OPERATION_FORM_CODE, 'PROC-14972EC1-2E3B-47DA-8346-9B1DBFE578C5');
  assert.equal(forms.RETIRED_LINGXIANG_GUANGZHOU_PURCHASE_FORM_CODE, 'PROC-866867B6-1F7B-4F70-AB8F-3500D6560785');
  assert.equal(forms.MONTHLY_SETTLEMENT_PAYMENT_FORM_CODE, 'PROC-EE85EDD4-5CF2-4C08-B948-1690A6ACC51C');
  assert.equal(processConfig.getProcessKind(forms.LINGXIANG_XINGMING_OPERATION_FORM_CODE, { processTypeMap }), 'operation');
  assert.equal(processConfig.getProcessKind('PROC-A4AA23BD-8980-4098-87E8-6898667371CC', { processTypeMap }), 'other');
  assert.equal(processConfig.getProcessKind(forms.LINGXIANG_XINGMING_PURCHASE_FORM_CODE, { processTypeMap }), 'purchase');
  assert.equal(processConfig.getProcessKind(forms.RETIRED_LINGXIANG_GUANGZHOU_OPERATION_FORM_CODE, { processTypeMap }), 'other');
  assert.equal(processConfig.getProcessKind(forms.RETIRED_LINGXIANG_GUANGZHOU_PURCHASE_FORM_CODE, { processTypeMap }), 'other');
});
