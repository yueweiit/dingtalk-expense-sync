const cron = require('node-cron');
const dingtalk = require('./dingtalk');
const processor = require('./processor');
const database = require('./database');
const logger = require('./logger');
const config = require('./config');
const { resolveProcessInstanceFetchId } = require('./workflowIds');
const {
  ER_API_LATEST_USD,
  formatDateShanghai,
  fetchUsdRatesLatest,
  buildFxDailyRows,
  invalidateUsdRatesCache
} = require('./openErFx');

class Scheduler {
  constructor() {
    this.isRunning = false;
    this.isCompensating = false;
    this.isFxSyncing = false;
  }

  // 将配置时间或字符串时间转换为时间戳（毫秒）
  toTimestamp(value) {
    if (typeof value === 'number') {
      return value;
    }
    return new Date(value).getTime();
  }

  // 将时间戳格式化为北京时间字符串（Asia/Shanghai）
  formatBeijingTime(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(timestamp));
  }

  getFallbackStartTime() {
    return this.toTimestamp(config.scheduler.startTime);
  }

  getProcessType(processCode) {
    const processCodes = config.dingtalk.processCodes;
    const index = processCodes.indexOf(processCode);
    if (index === 0) {
      return '运营支出';
    } else if (index === 1) {
      return '采购支出';
    }
    return '其他';
  }

  async syncSingleProcess(processCode, start, end) {
    logger.info(`开始获取流程 ${processCode} 的实例`);

    let totalInstanceIds = [];
    let nextToken = 0;
    let pageCount = 0;

    do {
      const queryResult = await dingtalk.queryProcessInstanceIds(start, end, processCode, nextToken);

      if (!queryResult || !queryResult.list || queryResult.list.length === 0) {
        break;
      }

      queryResult.list.forEach(id => {
        totalInstanceIds.push({ processInstanceId: id, processCode });
      });

      pageCount++;
      nextToken = queryResult.nextToken;

      logger.info(`流程 ${processCode} 第${pageCount}页: 获取到 ${queryResult.list.length} 个实例, nextToken: ${nextToken}`);

      await dingtalk.sleep(150);
    } while (nextToken && nextToken !== 0);

    logger.info(`流程 ${processCode} 获取完成, 共 ${pageCount} 页`);
    return totalInstanceIds;
  }

  getFxRatesTimezone() {
    return config.scheduler?.fxRatesTimezone || 'Asia/Shanghai';
  }

  /** 拉取 open.er-api 并写入 fx_rates_daily（上海日历日 = 任务执行当日） */
  async syncFxRatesDaily() {
    if (this.isFxSyncing) {
      logger.warn('日汇率任务进行中，跳过本次');
      return;
    }
    this.isFxSyncing = true;
    try {
      await database.ensureFxRatesDailyTable();
      const tz = this.getFxRatesTimezone();
      const rateDate = formatDateShanghai(Date.now(), tz);
      if (!rateDate) {
        throw new Error('无法计算上海日期');
      }
      const rates = await fetchUsdRatesLatest();
      const rows = buildFxDailyRows(rates);
      await database.replaceFxRatesForDate(rateDate, rows, ER_API_LATEST_USD);
      invalidateUsdRatesCache();
      logger.info(`日汇率已写入 fx_rates_daily: ${rateDate}，共 ${rows.length} 条币种`);
    } catch (e) {
      logger.error(`日汇率同步失败: ${e.message}`);
    } finally {
      this.isFxSyncing = false;
    }
  }

  /** 若当日尚无日表数据则拉一次，避免凌晨任务前审批入库失败 */
  async maybeEnsureTodayFxRates() {
    try {
      await database.ensureFxRatesDailyTable();
      const tz = this.getFxRatesTimezone();
      const today = formatDateShanghai(Date.now(), tz);
      if (!today) {
        return;
      }
      const cnt = await database.countFxRatesForDate(today);
      if (cnt <= 0) {
        logger.warn(`fx_rates_daily 尚无 ${today} 数据，立即拉取一次…`);
        await this.syncFxRatesDaily();
      }
    } catch (e) {
      logger.warn(`检查/补写日汇率失败: ${e.message}`);
    }
  }

  async processInstanceIdBatch(totalInstanceIds) {
    if (totalInstanceIds.length === 0) {
      logger.info('当前时间范围内没有新的审批实例');
      return true;
    }

    logger.info(`共找到 ${totalInstanceIds.length} 个审批实例`);

    const ids = totalInstanceIds.map(item => item.processInstanceId);
    const instanceResults = await dingtalk.getProcessInstances(ids);
    const metaById = new Map(totalInstanceIds.map((item) => [item.processInstanceId, item]));
    const fetchFailures = instanceResults.filter((item) => item.error);
    const instances = instanceResults
      .filter((item) => item.instance)
      .map((item) => {
        const meta = metaById.get(item.id);
        const instance = item.instance;
        if (meta) {
          instance.processInstanceId = instance.processInstanceId || meta.processInstanceId;
          instance.processCode = instance.processCode || meta.processCode;
          instance.processType = this.getProcessType(meta.processCode);
        }
        return instance;
      });

    fetchFailures.forEach((item) => {
      logger.error(`审批实例详情获取失败，暂不推进游标: processInstanceId=${item.id}, error=${item.error}`);
    });

    logger.info(`成功获取 ${instances.length} 个实例详情`);

    const results = await processor.processInstances(instances);
    logger.info(`数据同步完成: 成功 ${results.success}, 跳过 ${results.skipped}, 失败 ${results.failed}`);
    return fetchFailures.length === 0 && results.failed === 0;
  }

  // 执行一次增量同步（按流程游标持久化）
  async syncApprovals() {
    if (this.isRunning) {
      logger.warn('上次任务尚未完成，跳过本次执行');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      await database.ensureSyncStateTable();
      await database.ensureApprovalExpenseSchema();
      await this.maybeEnsureTodayFxRates();
      const end = Date.now();
      const processCodes = config.dingtalk.processCodes;

      logger.info(`开始增量同步审批数据，结束时间(北京时间): ${this.formatBeijingTime(end)}, 流程数量: ${processCodes.length}`);

      let failedProcessCount = 0;
      const fallbackStart = this.getFallbackStartTime();

      for (const processCode of processCodes) {
        const cursorKey = `process:${processCode}`;
        try {
          const cursor = await database.getSyncCursor(cursorKey);
          const start = cursor || fallbackStart;

          logger.info(`流程 ${processCode} 增量窗口(北京时间): ${this.formatBeijingTime(start)} ~ ${this.formatBeijingTime(end)}`);

          const ids = await this.syncSingleProcess(processCode, start, end);
          const processed = await this.processInstanceIdBatch(ids);
          if (!processed) {
            failedProcessCount++;
            logger.warn(`流程 ${processCode} 存在详情获取或入库失败，本次不推进游标`);
            continue;
          }

          // 仅流程同步成功时推进该流程游标，避免失败导致数据缺口
          await database.setSyncCursor(cursorKey, end);
        } catch (error) {
          failedProcessCount++;
          logger.error(`流程 ${processCode} 拉取失败，将继续下一个流程: ${error.message}`);
        }
      }

      if (failedProcessCount > 0) {
        logger.warn(`本次有 ${failedProcessCount} 个流程拉取失败，已跳过失败流程继续执行`);
      }
    } catch (error) {
      logger.error(`同步审批数据失败: ${error.message}`);
    } finally {
      this.isRunning = false;
      const duration = Date.now() - startTime;
      logger.info(`本次同步耗时: ${duration}ms`);
    }
  }

  // 每日补偿：只拉取数据库中“尚未出纳同意”的记录，防止漏同步
  async compensatePendingApprovals() {
    if (this.isCompensating) {
      logger.warn('上次补偿任务尚未完成，跳过本次执行');
      return;
    }

    this.isCompensating = true;
    const taskStart = Date.now();

    try {
      await database.ensureApprovalExpenseSchema();
      await this.maybeEnsureTodayFxRates();

      const limit = Number(config.scheduler.pendingCompensationLimit || 500);
      const staleLimit = Number(config.scheduler.staleAgreedRefreshLimit || 0);

      const pendingRows = await database.getPendingExpenseInstances(limit);
      const staleRows = staleLimit > 0 ? await database.getStaleExpenseAgreed(staleLimit) : [];

      const merged = new Map();
      for (const row of pendingRows) {
        merged.set(row.business_id, row);
      }
      for (const row of staleRows) {
        if (!merged.has(row.business_id)) {
          merged.set(row.business_id, row);
        }
      }
      const refreshRows = [...merged.values()];

      if (!refreshRows.length) {
        logger.info('补偿任务：没有待补偿记录');
        return;
      }

      logger.info(
        `补偿任务：待刷新 ${refreshRows.length} 条（含未出纳同意 ${pendingRows.length}，抽样刷新已同意 ${staleRows.length}）`
      );

      const fetchIds = refreshRows.map((row) =>
        resolveProcessInstanceFetchId(row.raw_data, row.business_id, row.process_instance_id)
      );
      const processTypeById = new Map(
        refreshRows.map(row => [
          row.business_id,
          row.expense_type === 'operation'
            ? '运营支出'
            : row.expense_type === 'purchase'
              ? '采购支出'
              : this.getProcessType(row.process_code)
        ])
      );

      const instanceResults = await dingtalk.getProcessInstances(fetchIds);
      const fetchFailures = instanceResults.filter((item) => item.error);
      fetchFailures.forEach((item) => {
        logger.error(`补偿任务获取实例详情失败: processInstanceId=${item.id}, error=${item.error}`);
      });
      const instances = instanceResults
        .filter((item) => item.instance)
        .map((item) => {
          const instance = item.instance;
          instance.processType = processTypeById.get(instance.businessId) || instance.processType || '其他';
          return instance;
        });

      const results = await processor.processInstances(instances, { force: true });
      logger.info(`补偿任务完成: 成功 ${results.success}, 跳过 ${results.skipped}, 失败 ${results.failed}`);
    } catch (error) {
      logger.error(`补偿任务失败: ${error.message}`);
    } finally {
      this.isCompensating = false;
      logger.info(`补偿任务耗时: ${Date.now() - taskStart}ms`);
    }
  }

  // 启动定时任务
  start() {
    const cronExpression = config.scheduler.cron;
    const compensationCron = config.scheduler.compensationCron || '17 3 * * *';
    const fxRatesCron = config.scheduler.fxRatesCron || '5 0 * * *';
    const fxTz = this.getFxRatesTimezone();

    logger.info(`启动增量定时任务，表达式: ${cronExpression}`);
    logger.info(`启动补偿定时任务，表达式: ${compensationCron}`);
    logger.info(`启动日汇率任务，表达式: ${fxRatesCron}（时区 ${fxTz}）`);

    cron.schedule(cronExpression, async () => {
      await this.syncApprovals();
    });

    cron.schedule(compensationCron, async () => {
      await this.compensatePendingApprovals();
    });

    cron.schedule(
      fxRatesCron,
      async () => {
        await this.syncFxRatesDaily();
      },
      { timezone: fxTz }
    );

    if (config.scheduler?.fxRatesRunOnStartup !== false) {
      logger.info('启动时执行一次日汇率同步…');
      void this.syncFxRatesDaily().catch((e) => logger.warn(`启动日汇率同步: ${e.message}`));
    }

    // 立即执行一次
    logger.info('立即执行一次增量数据同步...');
    this.syncApprovals();
  }

  // 手动触发同步
  async manualSync() {
    logger.info('手动触发数据同步');
    await this.syncApprovals();
  }

  // 停止定时任务
  async stop() {
    logger.info('停止定时任务');
    await database.close();
  }
}

module.exports = new Scheduler();
