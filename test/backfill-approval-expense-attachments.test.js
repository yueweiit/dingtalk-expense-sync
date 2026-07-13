const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function loadDatabase() {
  const srcPath = path.join('..', 'src', 'database');
  const distPath = path.join('..', 'dist', 'src', 'database');
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(distPath);
  }
}

test('attachment backfill only writes attachments for the requested business id', async () => {
  const databaseModule = loadDatabase();
  const database = databaseModule.default || databaseModule;
  const pool = databaseModule.pool || databaseModule.default?.pool;
  await database.ensureApprovalExpenseSchema();

  const businessId = `test-attachment-backfill-${Date.now()}`;
  const rawData = {
    formComponentValues: [
      {
        name: '关键凭证Comprobante clave',
        value: JSON.stringify([
          { spaceId: 'space-1', fileId: 'file-1', fileName: '附件一.pdf', fileType: 'pdf' },
          { spaceId: 'space-1', fileId: 'file-2', fileName: '附件二.xlsx', fileType: 'xlsx' },
        ]),
      },
    ],
  };

  try {
    await pool.query(
      `insert into approval_expense_purchase (business_id, purchase_expense, raw_data)
       values ($1, $2, $3::jsonb)`,
      [businessId, '服务类采购', JSON.stringify(rawData)]
    );

    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'backfill-approval-expense-attachments.ts');
    const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(
      process.execPath,
      [tsxCli, scriptPath, `--businessId=${businessId}`],
      { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const attachments = await pool.query(
      `select attachment_type, file_name, raw_data
       from approval_expense_attachments
       where parent_type = 'purchase'
         and parent_id = (select id from approval_expense_purchase where business_id = $1)
       order by row_no`,
      [businessId]
    );

    assert.deepEqual(
      attachments.rows.map((attachment) => ({
        attachmentType: attachment.attachment_type,
        fileName: attachment.file_name,
        fileId: attachment.raw_data?.fileId,
      })),
      [
        { attachmentType: 'pdf', fileName: '附件一.pdf', fileId: 'file-1' },
        { attachmentType: 'xlsx', fileName: '附件二.xlsx', fileId: 'file-2' },
      ]
    );

    const purchase = await pool.query(
      `select purchase_expense from approval_expense_purchase where business_id = $1`,
      [businessId]
    );
    assert.equal(purchase.rows[0]?.purchase_expense, '服务类采购');
  } finally {
    await pool.query(
      `delete from approval_expense_attachments
       where parent_type = 'purchase'
         and parent_id in (select id from approval_expense_purchase where business_id = $1)`,
      [businessId]
    );
    await pool.query('delete from approval_expense_purchase where business_id = $1', [businessId]);
    await pool.end();
  }
});
