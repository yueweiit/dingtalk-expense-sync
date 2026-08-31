const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

process.env.DB_PASSWORD ??= 'test-password';
process.env.DINGTALK_PROCESS_TYPE_MAP ??= JSON.stringify({
  operation: [
    'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
    'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD',
    'PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8',
    'PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B',
    'PROC-75FEF975-C79F-44A3-A02C-21734C2DBC49',
    'PROC-CCB314E9-1458-4D53-9EF2-F68A21EA018D',
    'PROC-D3ED660B-A5D4-4516-BC82-D83E52B5FEF8',
  ],
  purchase: [
    'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B',
    'PROC-6E11B527-2F82-439C-817D-C868DE086C97',
    'PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF',
    'PROC-E69FCD3E-E374-4C54-9D8F-6E1F55AD741F',
    'PROC-CA023EF7-CE63-4A0B-B4BB-66482C0E9972',
    'PROC-525D584D-ED10-4B8B-9C7A-9D67257BF6EE',
    'PROC-98934E07-96ED-491C-8650-DFE8C3B707BF',
  ],
  monthly_settlement: ['PROC-EE85EDD4-5CF2-4C08-B948-1690A6ACC51C'],
});

function loadModule(moduleName) {
  const srcPath = path.join('..', 'src', moduleName);
  return require(srcPath);
}

function getProcessor() {
  const module = loadModule('processor');
  const Processor = module.ApprovalProcessor || module.default?.constructor;
  return module.default || new Processor();
}

test('parses monthly settlement detail rows and related approvals from JSON values', () => {
  const processor = getProcessor();
  const result = processor.parseMonthlySettlementData([
    { id: 'CalculateField-K1UBWYQJ', name: '合计总额（元）', value: '12,600.00' },
    { id: 'DDMultiSelectField_YJUAL2OSMIO0', name: '币种', value: [{ value: '人民币RMB' }] },
    {
      id: 'TableField-K1UBPVJT',
      name: '申请付款明细',
      value: JSON.stringify([
        { rowValue: [
          { id: 'DDDateField-K1UBWYQI', value: '2026-07-31' },
          { id: 'MoneyField_1T807NIET4000', value: '11600' },
          { name: '付款事由', value: '采购尾款' },
        ] },
        { rowValue: [
          { id: 'DDDateField-K1UBWYQI', value: [{ value: '2026-08-01' }] },
          { id: 'MoneyField_1T807NIET4000', value: '1000' },
          { name: '付款说明', value: '补款' },
        ] },
      ]),
    },
    {
      id: 'RelateField_6UB3EQG7DY80',
      value: JSON.stringify({ list: [
        { approvalNo: '202605061637000580820', procInstId: 'source-instance-1' },
        { businessId: 'source-business-2', processInstanceId: 'source-instance-2' },
      ] }),
    },
  ]);

  assert.equal(result.totalAmount, 12600);
  assert.equal(result.currency, '人民币RMB');
  assert.deepEqual(result.details.map((row) => ({
    rowNo: row.rowNo,
    paymentDate: row.paymentDate,
    amount: row.amount,
    paymentReason: row.paymentReason,
  })), [
    { rowNo: 1, paymentDate: '2026-07-31', amount: 11600, paymentReason: '采购尾款' },
    { rowNo: 2, paymentDate: '2026-08-01', amount: 1000, paymentReason: '补款' },
  ]);
  assert.deepEqual(result.links.map((row) => ({
    linkedBusinessId: row.linkedBusinessId,
    linkedProcessInstanceId: row.linkedProcessInstanceId,
  })), [
    { linkedBusinessId: '202605061637000580820', linkedProcessInstanceId: 'source-instance-1' },
    { linkedBusinessId: 'source-business-2', linkedProcessInstanceId: 'source-instance-2' },
  ]);
});

test('does not create monthly settlement details without a positive amount', () => {
  const processor = getProcessor();
  const result = processor.parseMonthlySettlementData([{
    id: 'TableField-K1UBPVJT',
    details: [[
      { id: 'DDDateField-K1UBWYQI', value: '2026-08-01' },
      { id: 'MoneyField_1T807NIET4000', value: '' },
    ]],
  }]);
  assert.deepEqual(result.details, []);
  assert.deepEqual(result.links, []);
});
