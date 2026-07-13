import database, { pool } from '../src/database/index.ts';
import processor from '../src/processor.ts';

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

async function main(): Promise<void> {
  const businessId = getArg('businessId') || getArg('business_id');
  const all = getArg('all') === '1';
  const dryRun = getArg('dry-run') === '1' || getArg('dryRun') === '1';
  const limitValue = getArg('limit');
  const limit = limitValue ? Number.parseInt(limitValue, 10) : null;

  if (!businessId && !all) {
    throw new Error('请指定 --businessId=<业务编号>，或显式使用 --all=1 执行全量附件回填');
  }
  if (limitValue && (!Number.isFinite(limit) || !limit || limit < 1)) {
    throw new Error('--limit 必须是正整数');
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (businessId) {
    params.push(businessId);
    conditions.push(`business_id = $${params.length}`);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = limit ? `LIMIT ${limit}` : '';
  const rows = await pool.query<{
    parent_type: 'operation' | 'purchase';
    parent_id: number;
    business_id: string;
    raw_data: Record<string, unknown>;
  }>(`
    WITH expense_parents AS (
      SELECT 'operation'::text AS parent_type, id AS parent_id, business_id, raw_data
      FROM approval_expense_operation
      UNION ALL
      SELECT 'purchase'::text AS parent_type, id AS parent_id, business_id, raw_data
      FROM approval_expense_purchase
    )
    SELECT parent_type, parent_id, business_id, raw_data
    FROM expense_parents
    ${whereSql}
    ORDER BY parent_type, parent_id
    ${limitSql}
  `, params);

  let parsed = 0;
  let written = 0;
  let attachmentCount = 0;

  for (const row of rows.rows) {
    const formComponentValues = Array.isArray(row.raw_data?.formComponentValues)
      ? row.raw_data.formComponentValues
      : [];
    const attachments = processor.extractAttachments(formComponentValues as any);
    if (attachments.length === 0) continue;

    parsed++;
    attachmentCount += attachments.length;
    if (!dryRun) {
      await database.replaceAttachments(row.parent_type, row.parent_id, attachments);
      written++;
    }
  }

  const mode = dryRun ? '预演' : '回填';
  console.log(`${mode}完成：扫描 ${rows.rows.length} 条，识别附件的单据 ${parsed} 条，附件 ${attachmentCount} 个，写入 ${written} 条`);
}

main()
  .catch((error: unknown) => {
    console.error('附件回填失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.close();
  });
