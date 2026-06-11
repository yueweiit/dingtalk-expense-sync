/**
 * 仅创建/补全 fx_rates_daily 表结构（不写汇率数据）。
 * 例：npm run db:ensure-fx-rates
 */
import database from '../src/database.ts';
import logger from '../src/logger.ts';

async function main(): Promise<void> {
  await database.ensureFxRatesDailyTable();
  logger.info('fx_rates_daily 表结构已就绪');
  console.log('OK: fx_rates_daily');
  await database.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
