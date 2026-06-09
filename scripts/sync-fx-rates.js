/**
 * 手动拉取 open.er-api 并写入 fx_rates_daily（上海当日）。
 * 例：npm run sync:fx-rates
 */
const database = require('../src/database');
const {
  ER_API_LATEST_USD,
  formatDateShanghai,
  fetchUsdRatesLatest,
  buildFxDailyRows,
  invalidateUsdRatesCache
} = require('../src/openErFx');
const config = require('../config.json');

async function main() {
  const tz = config.scheduler?.fxRatesTimezone || 'Asia/Shanghai';
  await database.ensureFxRatesDailyTable();
  const rateDate = formatDateShanghai(Date.now(), tz);
  const rates = await fetchUsdRatesLatest();
  const rows = buildFxDailyRows(rates);
  await database.replaceFxRatesForDate(rateDate, rows, ER_API_LATEST_USD);
  invalidateUsdRatesCache();
  console.log(JSON.stringify({ ok: true, rateDate, rows: rows.length }, null, 2));
  await database.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
