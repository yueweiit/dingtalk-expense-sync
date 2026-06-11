/**
 * 为历史数据补写 base_currency_amount（按 create_time 北京时间取历史汇率）。
 * 例：npm run backfill:base-currency
 */
import database, { pool } from '../src/database.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';

const BATCH = 80;

async function main(): Promise<void> {
  await database.ensureBaseCurrencyAmountColumn();

  let updated = 0;
  for (;;) {
    const r = await pool.query(
      `
        SELECT business_id, amount, currency, create_time
        FROM approval_instances
        WHERE base_currency_amount IS NULL
          AND amount IS NOT NULL
        ORDER BY update_time DESC NULLS LAST
        LIMIT $1
      `,
      [BATCH]
    );
    if (!r.rows.length) {
      break;
    }
    for (const row of r.rows) {
      const base = await convertAmountToCny({
        amount: row.amount,
        currencyLabel: row.currency,
        createTime: row.create_time
      });
      await pool.query(
        `
          UPDATE approval_instances
          SET base_currency_amount = $2,
              update_time = CURRENT_TIMESTAMP
          WHERE business_id = $1
        `,
        [row.business_id, base]
      );
      updated++;
    }
    console.log(`本批 ${r.rows.length} 条，累计已更新 ${updated} 条`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(JSON.stringify({ done: true, updatedTotal: updated }, null, 2));
  await database.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});


