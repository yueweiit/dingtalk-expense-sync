/**
 * 手动拉取 open.er-api 并写入 fx_rates_daily（上海当日）。
 * 例：npm run sync:fx-rates
 */
import database from '../src/database.js';
import {
  ER_API_LATEST_USD,
  formatDateShanghai,
  fetchUsdRatesLatest,
  buildFxDailyRows,
  invalidateUsdRatesCache
} from '../src/openErFx.js';
import config from '../src/config.js';

async function main(): Promise<void> {
  const tz = config.scheduler?.fxRatesTimezone || 'Asia/Shanghai';
  await database.ensureFxRatesDailyTable();
  const rateDate = formatDateShanghai(Date.now(), tz);
  if (!rateDate) {
    throw new Error('无法计算上海日期');
  }
  const rates = await fetchUsdRatesLatest();
  const rows = buildFxDailyRows(rates);
  await database.replaceFxRatesForDate(rateDate, rows, ER_API_LATEST_USD);
  invalidateUsdRatesCache();
  console.log(JSON.stringify({ ok: true, rateDate, rows: rows.length }, null, 2));
  await database.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
