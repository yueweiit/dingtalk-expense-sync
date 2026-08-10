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

test('replacePurchaseDetails replaces detail rows and clears removed rows', async () => {
  const databaseModule = loadModule('database');
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;
  const businessId = `test-purchase-details-${Date.now()}`;

  await database.ensureApprovalExpenseSchema();

  try {
    const purchaseId = await database.upsertPurchaseExpense({
      businessId,
      requestDate: '2026-07-14',
      applicantDepartment: '采购部',
      businessEntity: '凌翔',
      serviceEntity: '拉丁购',
      rawData: {},
    });

    const archivedEntities = await pool.query(
      'select business_entity, service_entity from approval_expense_purchase where business_id = $1',
      [businessId]
    );
    assert.deepEqual(archivedEntities.rows[0], {
      business_entity: '凌翔',
      service_entity: '拉丁购',
    });

    assert.equal(typeof database.replacePurchaseDetails, 'function');
    await database.replacePurchaseDetails(purchaseId, {
      items: [{ rowNo: 1, itemName: '手机壳', quantity: 10, totalAmount: 81.6, rawData: {} }],
      processors: [{ rowNo: 1, processorName: '测试加工商', quantity: 5, totalAmount: 16, rawData: {} }],
    });

    const written = await pool.query(
      `select
         (select count(*)::int from approval_expense_purchase_items where purchase_id = $1) as item_count,
         (select count(*)::int from approval_expense_purchase_processors where purchase_id = $1) as processor_count`,
      [purchaseId]
    );
    assert.deepEqual(written.rows[0], { item_count: 1, processor_count: 1 });

    await database.replacePurchaseDetails(purchaseId, { items: [], processors: [] });
    const cleared = await pool.query(
      `select
         (select count(*)::int from approval_expense_purchase_items where purchase_id = $1) as item_count,
         (select count(*)::int from approval_expense_purchase_processors where purchase_id = $1) as processor_count`,
      [purchaseId]
    );
    assert.deepEqual(cleared.rows[0], { item_count: 0, processor_count: 0 });
  } finally {
    await pool.query('delete from approval_expense_purchase where business_id = $1', [businessId]);
    await pool.end();
  }
});
