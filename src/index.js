const scheduler = require('./scheduler');
const { startServer } = require('./server');
const logger = require('./logger');

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  logger.error(`未捕获的异常: ${error.stack || error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.stack || reason.message : reason;
  logger.error(`未处理的Promise拒绝: ${message}`);
});

// 优雅退出
process.on('SIGINT', async () => {
  logger.info('收到SIGINT信号，正在优雅退出...');
  await scheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('收到SIGTERM信号，正在优雅退出...');
  await scheduler.stop();
  process.exit(0);
});

logger.info('='.repeat(50));
logger.info('钉钉审批数据同步服务启动');
logger.info('='.repeat(50));

// 启动HTTP服务器（供钉钉连接器调用）
startServer().catch((e) => {
  logger.error(`HTTP 服务启动失败: ${e.message}`);
});

// 启动定时任务
scheduler.start();

// 导出手动同步方法供外部调用
module.exports = scheduler;
