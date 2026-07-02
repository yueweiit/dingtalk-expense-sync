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

test('buildLegacyProcessTypeMap preserves the original first-two-codes behavior', () => {
  const processConfig = getProcessConfigModule();
  const buildLegacyProcessTypeMap =
    processConfig.buildLegacyProcessTypeMap || processConfig.default?.buildLegacyProcessTypeMap;

  assert.deepEqual(
    buildLegacyProcessTypeMap([
      'PROC-OLD-OPERATION',
      'PROC-PURCHASE',
      'PROC-IGNORED-OTHER',
    ]),
    {
      operation: ['PROC-OLD-OPERATION'],
      purchase: ['PROC-PURCHASE'],
    }
  );
});

test('resolveProcessTypeMap merges explicit mapping with legacy compatibility', () => {
  const processConfig = getProcessConfigModule();
  const resolveProcessTypeMap =
    processConfig.resolveProcessTypeMap || processConfig.default?.resolveProcessTypeMap;

  assert.deepEqual(
    resolveProcessTypeMap({
      processCodes: ['PROC-OLD-OPERATION', 'PROC-PURCHASE'],
      processTypeMap: {
        operation: ['PROC-NEW-ECOMMERCE-OPERATION'],
      },
    }),
    {
      operation: ['PROC-OLD-OPERATION', 'PROC-NEW-ECOMMERCE-OPERATION'],
      purchase: ['PROC-PURCHASE'],
    }
  );
});

test('getConfiguredProcessCodes keeps mapped codes and unmapped legacy codes together', () => {
  const processConfig = getProcessConfigModule();
  const getConfiguredProcessCodes =
    processConfig.getConfiguredProcessCodes || processConfig.default?.getConfiguredProcessCodes;

  assert.deepEqual(
    getConfiguredProcessCodes({
      processCodes: ['PROC-OLD-OPERATION', 'PROC-PURCHASE', 'PROC-UNMAPPED'],
      processTypeMap: {
        operation: ['PROC-NEW-ECOMMERCE-OPERATION'],
      },
    }),
    ['PROC-OLD-OPERATION', 'PROC-NEW-ECOMMERCE-OPERATION', 'PROC-PURCHASE', 'PROC-UNMAPPED']
  );
});

test('getProcessKind and getProcessTypeLabel classify both old and new operation forms', () => {
  const processConfig = getProcessConfigModule();
  const getProcessKind = processConfig.getProcessKind || processConfig.default?.getProcessKind;
  const getProcessTypeLabel =
    processConfig.getProcessTypeLabel || processConfig.default?.getProcessTypeLabel;

  const config = {
    processCodes: ['PROC-OLD-OPERATION', 'PROC-PURCHASE'],
    processTypeMap: {
      operation: ['PROC-NEW-ECOMMERCE-OPERATION'],
    },
  };

  assert.equal(getProcessKind('PROC-OLD-OPERATION', config), 'operation');
  assert.equal(getProcessKind('PROC-NEW-ECOMMERCE-OPERATION', config), 'operation');
  assert.equal(getProcessKind('PROC-PURCHASE', config), 'purchase');
  assert.equal(getProcessKind('PROC-UNKNOWN', config), 'other');

  assert.equal(getProcessTypeLabel('PROC-OLD-OPERATION', config), '运营支出');
  assert.equal(getProcessTypeLabel('PROC-NEW-ECOMMERCE-OPERATION', config), '运营支出');
  assert.equal(getProcessTypeLabel('PROC-PURCHASE', config), '采购支出');
  assert.equal(getProcessTypeLabel('PROC-UNKNOWN', config), '其他');
});

test('getProcessKind prefers explicit processTypeMap over expanded processCodes at runtime', () => {
  const processConfig = getProcessConfigModule();
  const getProcessKind = processConfig.getProcessKind || processConfig.default?.getProcessKind;

  assert.equal(
    getProcessKind('PROC-PURCHASE', {
      processCodes: [
        'PROC-OLD-OPERATION',
        'PROC-NEW-ECOMMERCE-OPERATION',
        'PROC-PURCHASE',
      ],
      processTypeMap: {
        operation: ['PROC-OLD-OPERATION', 'PROC-NEW-ECOMMERCE-OPERATION'],
        purchase: ['PROC-PURCHASE'],
      },
    }),
    'purchase'
  );
});
