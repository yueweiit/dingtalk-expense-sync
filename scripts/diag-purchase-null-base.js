/**
 * 诊断：采购支出 base_currency_amount 为 NULL 的原因分布；抽样看 raw_data 表单字段名。
 * 用法：node scripts/diag-purchase-null-base.js [--dingtalk=1]  后一项会拉 2 条钉钉详情对比
 */
const { Pool } = require('pg');
const config = require('../config.json');

const pool = new Pool(config.database);
const wantDingtalk = process.argv.includes('--dingtalk=1');

function collectMoneyCurrencyNames(formComponentValues) {
  if (!Array.isArray(formComponentValues)) {
    return { names: [], hits: [] };
  }
  const names = formComponentValues.map((x) => x && x.name).filter(Boolean);
  const hits = names.filter((n) => /币|moneda|importe|金额|currency|money/i.test(String(n)));
  return { names, hits };
}

async function main() {
  const r1 = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(currency), ''), '(空)') AS cur,
           COUNT(*)::int AS n
    FROM approval_instances
    WHERE process_type = '采购支出' AND base_currency_amount IS NULL
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 30
  `);
  console.log('\n=== 采购支出 base=NULL 按 currency 分布（前30）===');
  console.table(r1.rows);

  const r2 = await pool.query(`
    SELECT status, COUNT(*)::int AS n
    FROM approval_instances
    WHERE process_type = '采购支出' AND base_currency_amount IS NULL
    GROUP BY status
    ORDER BY n DESC
  `);
  console.log('\n=== 采购支出 base=NULL 按 status ===');
  console.table(r2.rows);

  const r3 = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE amount IS NULL)::int AS null_amount,
      COUNT(*) FILTER (WHERE create_time IS NULL)::int AS null_create_time,
      COUNT(*)::int AS total_null_base
    FROM approval_instances
    WHERE process_type = '采购支出' AND base_currency_amount IS NULL
  `);
  console.log('\n=== 采购支出 base=NULL 时 amount/create_time 空值统计 ===');
  console.log(r3.rows[0]);

  const r4 = await pool.query(`
    SELECT business_id, process_instance_id, amount, currency, status, create_time
    FROM approval_instances
    WHERE process_type = '采购支出' AND base_currency_amount IS NULL
    ORDER BY create_time DESC NULLS LAST
    LIMIT 8
  `);
  console.log('\n=== 样本（库内）===');
  for (const row of r4.rows) {
    const r5 = await pool.query(
      `SELECT raw_data->'formComponentValues' AS fc FROM approval_instances WHERE business_id = $1`,
      [row.business_id]
    );
    const fc = r5.rows[0]?.fc;
    const { hits } = collectMoneyCurrencyNames(fc);
    console.log(JSON.stringify({ ...row, formFieldHits: hits }, null, 2));
  }

  if (wantDingtalk) {
    const dingtalk = require('../src/dingtalk');
    const { resolveProcessInstanceFetchId } = require('../src/workflowIds');
    console.log('\n=== 钉钉详情抽样（最多 2 条）===');
    for (const row of r4.rows.slice(0, 2)) {
      const r6 = await pool.query(
        `SELECT raw_data, process_instance_id FROM approval_instances WHERE business_id = $1`,
        [row.business_id]
      );
      const raw = r6.rows[0]?.raw_data;
      const pid = resolveProcessInstanceFetchId(raw, row.business_id, r6.rows[0]?.process_instance_id);
      try {
        const inst = await dingtalk.getProcessInstance(pid);
        const parsed = collectMoneyCurrencyNames(inst.formComponentValues);
        const moneyField = Array.isArray(inst.formComponentValues)
          ? inst.formComponentValues.find((x) => x && x.name && String(x.name).includes('金额'))
          : null;
        const curField = Array.isArray(inst.formComponentValues)
          ? inst.formComponentValues.find((x) => x && x.name && /币|Moneda/i.test(String(x.name)))
          : null;
        console.log(
          JSON.stringify(
            {
              businessId: inst.businessId,
              processInstanceId: inst.processInstanceId,
              moneyFieldName: moneyField?.name,
              moneyValue: moneyField?.value,
              currencyFieldName: curField?.name,
              currencyValue: curField?.value,
              formFieldHits: parsed.hits
            },
            null,
            2
          )
        );
      } catch (e) {
        console.log(`钉钉拉取失败 business_id=${row.business_id} fetchId=${pid}: ${e.message}`);
      }
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
