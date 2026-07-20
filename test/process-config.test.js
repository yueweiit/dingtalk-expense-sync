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
    ],
    purchase: [
      forms.OLD_PURCHASE_FORM_CODE,
      forms.NEW_ECOMMERCE_PURCHASE_FORM_CODE,
    ],
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
