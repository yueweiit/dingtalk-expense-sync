const assert = require('node:assert/strict');
const test = require('node:test');

const forms = require('../src/form-source.ts');
const processConfig = require('../src/process-config.ts');

const processTypeMap = {
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
};

test('maps LEMOS, mold-print, and YUEWEI MX forms to their correct process types', () => {
  assert.deepEqual(processConfig.validateProcessTypeMap(processTypeMap), processTypeMap);
  assert.equal(processConfig.getProcessKind(forms.LEMOS_OPERATION_FORM_CODE, { processTypeMap }), 'operation');
  assert.equal(processConfig.getProcessKind(forms.MOLD_PRINT_OPERATION_FORM_CODE, { processTypeMap }), 'operation');
  assert.equal(processConfig.getProcessKind(forms.YUEWEI_MX_OPERATION_FORM_CODE, { processTypeMap }), 'operation');
  assert.equal(processConfig.getProcessKind(forms.LEMOS_PURCHASE_FORM_CODE, { processTypeMap }), 'purchase');
  assert.equal(processConfig.getProcessKind(forms.MOLD_PRINT_PURCHASE_FORM_CODE, { processTypeMap }), 'purchase');
  assert.equal(processConfig.getProcessKind(forms.YUEWEI_MX_PURCHASE_FORM_CODE, { processTypeMap }), 'purchase');
});

test('maps the six new process codes to stable form names', () => {
  assert.equal(forms.resolveOperationFormName(forms.LEMOS_OPERATION_FORM_CODE), 'LEMOS\u8fd0\u8425\u652f\u51fa');
  assert.equal(forms.resolveOperationFormName(forms.MOLD_PRINT_OPERATION_FORM_CODE), '\u6a21\u5177\u6216\u5f69\u5370\u8fd0\u8425\u652f\u51fa');
  assert.equal(forms.resolveOperationFormName(forms.YUEWEI_MX_OPERATION_FORM_CODE), 'YUEWEI MX\u8fd0\u8425\u652f\u51fa');
  assert.equal(forms.resolvePurchaseFormName(forms.LEMOS_PURCHASE_FORM_CODE), 'LEMOS\u91c7\u8d2d\u652f\u51fa');
  assert.equal(forms.resolvePurchaseFormName(forms.MOLD_PRINT_PURCHASE_FORM_CODE), '\u6a21\u5177\u6216\u5f69\u5370\u91c7\u8d2d\u652f\u51fa');
  assert.equal(forms.resolvePurchaseFormName(forms.YUEWEI_MX_PURCHASE_FORM_CODE), 'YUEWEI MX\u91c7\u8d2d\u652f\u51fa');
});
