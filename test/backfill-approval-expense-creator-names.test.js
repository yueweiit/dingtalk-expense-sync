const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const pg = require('pg');

function loadDatabase() {
  const srcPath = path.join('..', 'src', 'database');
  const distPath = path.join('..', 'dist', 'src', 'database');
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(distPath);
  }
}

function createOaPool() {
  return new pg.Pool({
    host: process.env.OA_DB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.OA_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.OA_DB_NAME || 'dingtalk_oa',
    user: process.env.OA_DB_USER || process.env.DB_USER || 'postgres',
    password: process.env.OA_DB_PASSWORD || process.env.DB_PASSWORD,
  });
}

async function insertOaSource(oaPool, { businessId, processInstanceId, userId, storedUserId = userId, sourceName, storedName = sourceName, snapshotName, corpId }) {
  await oaPool.query(
    `insert into ding_approval_instance
      (corp_id, process_instance_id, process_code, originator_user_id, originator_user_name, create_time, raw_payload)
     values ($1, $2, $3, $4, $5, now(), $6::jsonb)`,
    [
      corpId,
      processInstanceId,
      'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      storedUserId,
      storedName,
      JSON.stringify({ businessId, processInstanceId, originatorUserId: userId, originatorUserName: sourceName }),
    ]
  );

  if (snapshotName) {
    await oaPool.query(
      `insert into ding_user_snapshot
        (corp_id, user_id, name, snapshot_hash, fetch_status, is_current)
       values ($1, $2, $3, $4, 'success', true)`,
      [corpId, userId, snapshotName, `snapshot-${businessId}`]
    );
  }
}

function runBackfill(businessId) {
  const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return spawnSync(
    process.execPath,
    [tsxCli, 'scripts/backfill-approval-expense-creator-names.ts', `--businessId=${businessId}`, '--write=1'],
    { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' }
  );
}

test('creator name backfill uses snapshots without replacing existing text names', async () => {
  const databaseModule = loadDatabase();
  const database = databaseModule.default || databaseModule;
  const approvalPool = databaseModule.pool || databaseModule.default?.pool;
  const oaPool = createOaPool();
  const suffix = `${Date.now()}`;
  const numericBusinessId = `test-creator-name-numeric-${suffix}`;
  const textBusinessId = `test-creator-name-text-${suffix}`;
  const rawTextBusinessId = `test-creator-name-raw-text-${suffix}`;
  const unresolvedBusinessId = `test-creator-name-unresolved-${suffix}`;
  const corpId = `test-corp-${suffix}`;
  const numericProcessInstanceId = `pid-${numericBusinessId}`;
  const textProcessInstanceId = `pid-${textBusinessId}`;
  const rawTextProcessInstanceId = `pid-${rawTextBusinessId}`;
  const unresolvedProcessInstanceId = `pid-${unresolvedBusinessId}`;
  const numericUserId = '15598386624892751';

  await database.ensureApprovalExpenseSchema();

  try {
    await insertOaSource(oaPool, {
      businessId: numericBusinessId,
      processInstanceId: numericProcessInstanceId,
      userId: numericUserId,
      storedUserId: null,
      sourceName: numericUserId,
      snapshotName: 'Snapshot User',
      corpId,
    });
    await insertOaSource(oaPool, {
      businessId: textBusinessId,
      processInstanceId: textProcessInstanceId,
      userId: 'source-user-text',
      sourceName: 'Source User',
      snapshotName: 'Different Snapshot User',
      corpId,
    });
    await insertOaSource(oaPool, {
      businessId: rawTextBusinessId,
      processInstanceId: rawTextProcessInstanceId,
      userId: 'source-user-raw-text',
      sourceName: 'Historical Source User',
      storedName: null,
      snapshotName: 'Current Snapshot User',
      corpId,
    });
    await insertOaSource(oaPool, {
      businessId: unresolvedBusinessId,
      processInstanceId: unresolvedProcessInstanceId,
      userId: '99999999999999999',
      storedUserId: null,
      sourceName: null,
      storedName: null,
      snapshotName: null,
      corpId,
    });

    await approvalPool.query(
      `insert into approval_expense_operation (business_id, process_instance_id, creator_name)
       values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9), ($10, $11, $12)`,
      [
        numericBusinessId, numericProcessInstanceId, numericUserId,
        textBusinessId, textProcessInstanceId, 'Source User',
        unresolvedBusinessId, unresolvedProcessInstanceId, '99999999999999999',
        rawTextBusinessId, rawTextProcessInstanceId, '12345678901234567',
      ]
    );
    await approvalPool.query(
      `insert into approval_expense_purchase (business_id, process_instance_id, creator_name)
       values ($1, $2, $3)`,
      [numericBusinessId, numericProcessInstanceId, numericUserId]
    );

    const numericResult = runBackfill(numericBusinessId);
    assert.equal(numericResult.status, 0, numericResult.stderr || numericResult.stdout);
    const textResult = runBackfill(textBusinessId);
    assert.equal(textResult.status, 0, textResult.stderr || textResult.stdout);
    const rawTextResult = runBackfill(rawTextBusinessId);
    assert.equal(rawTextResult.status, 0, rawTextResult.stderr || rawTextResult.stdout);
    const unresolvedResult = runBackfill(unresolvedBusinessId);
    assert.equal(unresolvedResult.status, 0, unresolvedResult.stderr || unresolvedResult.stdout);
    assert.match(unresolvedResult.stdout, /"updated":\s*0/);

    const operationRows = await approvalPool.query(
      `select business_id, creator_name from approval_expense_operation
       where business_id = any($1::text[]) order by business_id`,
       [[numericBusinessId, textBusinessId, unresolvedBusinessId]]
    );
    assert.deepEqual(operationRows.rows, [
      { business_id: numericBusinessId, creator_name: 'Snapshot User' },
      { business_id: textBusinessId, creator_name: 'Source User' },
      { business_id: unresolvedBusinessId, creator_name: '99999999999999999' },
    ]);

    const purchaseRows = await approvalPool.query(
      `select creator_name from approval_expense_purchase where business_id = $1`,
      [numericBusinessId]
    );
    assert.equal(purchaseRows.rows[0]?.creator_name, 'Snapshot User');

    const rawTextRows = await approvalPool.query(
      'select creator_name from approval_expense_operation where business_id = $1',
      [rawTextBusinessId]
    );
    assert.equal(rawTextRows.rows[0]?.creator_name, 'Historical Source User');
  } finally {
    await approvalPool.query(
      'delete from approval_expense_operation where business_id = any($1::text[])',
      [[numericBusinessId, textBusinessId, rawTextBusinessId, unresolvedBusinessId]]
    );
    await approvalPool.query(
      'delete from approval_expense_purchase where business_id = $1',
      [numericBusinessId]
    );
    await oaPool.query('delete from ding_user_snapshot where corp_id = $1', [corpId]);
    await oaPool.query('delete from ding_approval_instance where corp_id = $1', [corpId]);
    await Promise.all([approvalPool.end(), oaPool.end()]);
  }
});
