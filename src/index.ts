import scheduler from './scheduler.ts';
import { startServer } from './server.ts';
import logger from './logger.ts';

// 捕获未处理的异常
process.on('uncaughtException', (error: Error) => {
  logger.error(`未捕获的异常: ${error.stack || error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
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
startServer().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  logger.error(`HTTP 服务启动失败: ${message}`);
});

// 启动定时任务
scheduler.start();

// 导出手动同步方法供外部调用
export default scheduler;
