/**
 * 从库内 raw_data.formComponentValues 重新解析金额/币种（修复采购多组「金额importe」只取到空行的问题），
 * 并更新 amount、currency、base_currency_amount。不调用钉钉。
 *
 * 例：node scripts/reparse-amount-from-raw.js
 *     node scripts/reparse-amount-from-raw.js --processType=采购支出
 */
const database = require('../src/database');
const processor = require('../src/processor');
const { convertAmountToCny } = require('../src/fxToCny');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    args[k] = v ?? '';
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const processType = args.processType || '采购支出';
  const limit = Math.min(5000, Math.max(1, Number(args.limit || 2000)));

  await database.ensureBaseCurrencyAmountColumn();

  const r = await database.pool.query(
    `
      SELECT business_id, raw_data, create_time
      FROM approval_instances
      WHERE process_type = $1
        AND (amount IS NULL OR TRIM(COALESCE(currency, '')) = '')
        AND raw_data IS NOT NULL
        AND jsonb_typeof(raw_data->'formComponentValues') = 'array'
      ORDER BY update_time DESC NULLS LAST
      LIMIT $2
    `,
    [processType, limit]
  );

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const row of r.rows) {
    try {
      const raw = row.raw_data;
      const fc = raw.formComponentValues;
      if (!Array.isArray(fc)) {
        skip++;
        continue;
      }
      const formData = processor.parseFormData(fc);
      const amount = processor.normalizeNumber(formData.amount);
      const currency = formData.currency != null ? String(formData.currency).trim().substring(0, 32) : null;
      if (amount == null && !currency) {
        skip++;
        continue;
      }
      const base = await convertAmountToCny({
        amount,
        currencyLabel: currency,
        createTime: row.create_time
      });
      await database.pool.query(
        `
          UPDATE approval_instances
          SET amount = COALESCE($2, amount),
              currency = COALESCE(NULLIF($3, ''), currency),
              base_currency_amount = $4,
              update_time = CURRENT_TIMESTAMP
          WHERE business_id = $1
        `,
        [row.business_id, amount, currency || null, base]
      );
      ok++;
    } catch (e) {
      fail++;
      console.error(`${row.business_id}: ${e.message}`);
    }
  }

  console.log(
    JSON.stringify(
      { processType, scanned: r.rows.length, updated: ok, skipped: skip, failed: fail },
      null,
      2
    )
  );
  await database.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
