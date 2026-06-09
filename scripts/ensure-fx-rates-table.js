/**
 * 仅创建/补全 fx_rates_daily 表结构（不写汇率数据）。
 * 例：npm run db:ensure-fx-rates
 */
const database = require('../src/database');
const logger = require('../src/logger');

async function main() {
  await database.ensureFxRatesDailyTable();
  logger.info('fx_rates_daily 表结构已就绪');
  console.log('OK: fx_rates_daily');
  await database.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
