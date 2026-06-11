import { defineConfig } from 'drizzle-kit';
import fs from 'fs';
import path from 'path';

function loadConfigFromJson(): { host: string; port: string; database: string; user: string; password: string } | null {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config?.database) {
      return {
        host: config.database.host || 'localhost',
        port: String(config.database.port || 5432),
        database: config.database.database || 'dingtalk_approval',
        user: config.database.user || 'postgres',
        password: config.database.password || '',
      };
    }
  } catch {
    // 忽略 config.json 读取错误
  }
  return null;
}

function buildConnectionUrl(): string {
  const jsonConfig = loadConfigFromJson();
  const host = process.env.DB_HOST || jsonConfig?.host || 'localhost';
  const port = process.env.DB_PORT || jsonConfig?.port || '5432';
  const database = process.env.DB_NAME || jsonConfig?.database || 'dingtalk_approval';
  const user = process.env.DB_USER || jsonConfig?.user || 'postgres';
  const password = process.env.DB_PASSWORD || jsonConfig?.password || '';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: buildConnectionUrl(),
  },
});
