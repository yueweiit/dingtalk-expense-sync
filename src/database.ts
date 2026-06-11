// 重导出：保持 import database from './database.ts' 兼容
export { default, pool } from './database/index.ts';
// 导出 Drizzle 数据库实例供需要直接使用 Drizzle 查询的代码使用
export { db } from './database/pool.ts';
