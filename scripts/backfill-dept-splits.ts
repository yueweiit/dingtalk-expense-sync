/**
 * 回填/重建 approval_expense_dept_split 表
 * 从 approval_expense_operation 的 JSONB 列派生 split 数据
 *
 * 用法：
 *   tsx scripts/backfill-dept-splits.ts [--dryRun] [--backfill]
 *
 *   --backfill  只处理尚无 split 数据的记录（增量）
 *   默认        全量重建（删除旧数据，重新写入）
 *   --dryRun    仅统计，不写入
 */

import { rebuildAllDeptSplits, backfillDeptSplits } from '../src/database/expense.ts';
import database from '../src/database/index.ts';
import { pool } from '../src/database/pool.ts';

const isDryRun = process.argv.includes('--dryRun');
const isBackfill = process.argv.includes('--backfill');
const mode = isBackfill ? '回填（增量）' : '全量重建';

async function main() {
  console.log(`=== ${mode} approval_expense_dept_split ===`);
  if (isDryRun) {
    console.log('[DRY RUN] 仅统计，不写入');
  }

  const start = Date.now();

  if (isDryRun) {
    try {
      const whereClause = isBackfill
        ? `WHERE (salary_by_department IS NOT NULL
                OR social_insurance_by_department IS NOT NULL
                OR office_space_by_department IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM approval_expense_dept_split ds
             WHERE ds.business_id = approval_expense_operation.business_id
           )`
        : `WHERE salary_by_department IS NOT NULL
              OR social_insurance_by_department IS NOT NULL
              OR office_space_by_department IS NOT NULL`;

      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM approval_expense_operation ${whereClause}`
      );
      const count = result.rows[0]?.cnt || 0;
      console.log(`[DRY RUN] 待处理记录数: ${count}`);
    } finally {
      await pool.end();
    }
    return;
  }

  try {
    const fn = isBackfill ? backfillDeptSplits : rebuildAllDeptSplits;
    const { total, rebuilt } = await fn();
    const duration = Date.now() - start;
    console.log(`${mode}完成: 总计 ${total} 条, 有拆分数据 ${rebuilt} 条, 耗时 ${duration}ms`);
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(`${mode}失败:`, err);
  process.exit(1);
});
