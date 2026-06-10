import { Pool } from 'pg';
import config from '../config.js';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

pool.on('error', (err: Error) => {
  console.error('数据库连接池错误:', err);
});
