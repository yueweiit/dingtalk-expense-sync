/**
 * Centralized configuration module
 * Loads sensitive values from .env (via dotenv), non-sensitive from config.json
 * Provides backward compatibility: falls back to config.json if env vars not set
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  validateProcessTypeMap,
  type ProcessTypeMap,
} from './process-config.ts';

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
}

interface OaDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
}

interface DingtalkConfig {
  appkey: string | undefined;
  appsecret: string | undefined;
  robotCode: string | undefined;
  robotAppkey: string | undefined;
  robotAppsecret: string | undefined;
  allProcessCodes: string[];
  processTypeMap: Required<ProcessTypeMap>;
  paymentEventUserIds: string[];
}

interface SchedulerConfig {
  cron: string;
  startTime: string;
  oaUpdatedAtInitialLookbackDays: number;
  oaUpdatedAtOverlapMinutes: number;
  oaUpdatedAtDailyReconciliationLookbackDays: number;
  compensationCron: string;
  fxRatesCron: string;
  fxRatesTimezone: string;
  fxRatesRunOnStartup: boolean;
  pendingCompensationLimit: number;
  staleAgreedRefreshLimit: number;
  weeklyReportCron: string;
  weeklyReportTimezone: string;
  weeklyReportEnabled: boolean;
  weeklyReportDryRun: boolean;
  weeklyReportAdminUserId: string;
  weeklyReportDeptRecipients: Record<string, string[]>;
}

interface ServerConfig {
  port: number;
}

export interface Config {
  database: Readonly<DatabaseConfig>;
  oaDatabase: Readonly<OaDatabaseConfig>;
  dingtalk: Readonly<DingtalkConfig>;
  scheduler: Readonly<SchedulerConfig>;
  server: Readonly<ServerConfig>;
}

interface FileConfigShape {
  database?: Partial<DatabaseConfig>;
  oaDatabase?: Partial<OaDatabaseConfig>;
  dingtalk?: Partial<DingtalkConfig> & {
    processCodes?: unknown;
    processTypeMap?: ProcessTypeMap;
  };
  scheduler?: Partial<SchedulerConfig>;
  server?: Partial<ServerConfig>;
}

// Load .env from project root (works whether called from src/ or scripts/)
// __dirname is src/ when running via tsx, so go up one level to reach project root
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// Load non-sensitive config from config.json (fallback)
let fileConfig: FileConfigShape = {};
try {
  const configPath = path.join(projectRoot, 'config.json');
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FileConfigShape;
  }
} catch (error: unknown) {
  // config.json is optional when all values are provided via env vars
  const message = error instanceof Error ? error.message : String(error);
  console.warn('Warning: Could not load config.json:', message);
}

// Validate required secrets are present
const requiredEnvVars = ['DB_PASSWORD'] as const;
const missing = requiredEnvVars.filter(envVar => {
  const value = process.env[envVar];
  return !value || value.trim() === '';
});

if (missing.length > 0) {
  // Check if ALL missing values exist in config.json as fallback
  // Using AND logic: all missing vars must have config.json fallbacks
  const hasJsonFallback = 
    (!missing.includes('DB_PASSWORD') || fileConfig.database?.password);
  
  if (!hasJsonFallback) {
    throw new Error(
      `Missing required configuration: ${missing.join(', ')}\n` +
      'Set these in .env file or provide them in config.json'
    );
  }
}

/**
 * Parse JSON string from environment variable
 * Returns undefined if value is empty or invalid JSON
 */
function parseJsonEnv(value: string | undefined): unknown {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value; // Return as string if not valid JSON
  }
}

/**
 * Parse boolean from environment variable
 * Handles 'true', 'false', '1', '0' (case-insensitive)
 */
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value || typeof value !== 'string') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return defaultValue;
}

/**
 * Parse department recipients mapping from env var or config.json
 * Format: {"deptName": ["userId1", "userId2"], ...}
 * - Empty/missing → empty object (OK)
 * - Invalid JSON → throw (fail fast)
 * - Invalid values (not string[]) → throw
 * - Empty arrays → skip with warning
 */
function parseDeptRecipients(
  envValue: string | undefined,
  fileValue: Record<string, string[]> | undefined
): Record<string, string[]> {
  const raw = envValue || JSON.stringify(fileValue || {});
  if (!raw || raw.trim() === '' || raw.trim() === '{}') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS JSON 解析失败: ${raw.slice(0, 100)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS 必须是 JSON 对象');
  }

  const result: Record<string, string[]> = {};
  for (const [dept, ids] of Object.entries(parsed)) {
    if (!Array.isArray(ids)) {
      throw new Error(`SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS["${dept}"] 必须是数组`);
    }
    if (ids.some(id => typeof id !== 'string')) {
      throw new Error(`SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS["${dept}"] 数组元素必须是字符串`);
    }
    if (ids.length === 0) {
      console.warn(`Warning: SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS["${dept}"] 数组为空，将跳过该部门`);
      continue;
    }
    result[dept] = ids;
  }
  return result;
}

function parseUserIds(envValue: string | undefined, fileValue: string[] | undefined): string[] {
  const values = envValue?.trim()
    ? envValue.split(/[\s,;]+/)
    : Array.isArray(fileValue) ? fileValue : [];
  const result = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (result.some((value) => !/^\d+$/.test(value))) {
    throw new Error('DINGTALK_PAYMENT_EVENT_USER_IDS must contain numeric user IDs');
  }
  return result;
}

const AUTHORIZED_PAYMENT_EVENT_USER_IDS = Object.freeze([
  '57521312381178275',
  '02183637680221426194',
]);

function validatePaymentEventUserIds(configuredUserIds: string[]): void {
  if (configuredUserIds.length === 0) return;
  const expected = [...AUTHORIZED_PAYMENT_EVENT_USER_IDS].sort();
  const actual = [...configuredUserIds].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error('DINGTALK_PAYMENT_EVENT_USER_IDS is fixed to the authorized payment commenters');
  }
}

// Build configuration object with env vars taking precedence over config.json
if (process.env.DINGTALK_PROCESS_CODES?.trim()) {
  throw new Error('DINGTALK_PROCESS_CODES 已废弃，请仅配置 DINGTALK_PROCESS_TYPE_MAP');
}
if (fileConfig.dingtalk?.processCodes !== undefined) {
  throw new Error('config.json 中的 dingtalk.processCodes 已废弃，请仅配置 dingtalk.processTypeMap');
}

const processTypeMapEnv = process.env.DINGTALK_PROCESS_TYPE_MAP;
const rawProcessTypeMap = processTypeMapEnv?.trim()
  ? parseJsonEnv(processTypeMapEnv) as ProcessTypeMap | undefined
  : fileConfig.dingtalk?.processTypeMap;
const resolvedProcessTypeMap = validateProcessTypeMap(rawProcessTypeMap);
const allProcessCodes = [
  ...resolvedProcessTypeMap.operation,
  ...resolvedProcessTypeMap.purchase,
  ...resolvedProcessTypeMap.monthly_settlement,
];
const configuredPaymentEventUserIds = parseUserIds(
  process.env.DINGTALK_PAYMENT_EVENT_USER_IDS,
  fileConfig.dingtalk?.paymentEventUserIds,
);
validatePaymentEventUserIds(configuredPaymentEventUserIds);

const config: Config = Object.freeze({
  database: Object.freeze({
    host: process.env.DB_HOST || fileConfig.database?.host || 'localhost',
    port: Number(process.env.DB_PORT) || fileConfig.database?.port || 5432,
    database: process.env.DB_NAME || fileConfig.database?.database || 'dingtalk_approval',
    user: process.env.DB_USER || fileConfig.database?.user || 'postgres',
    password: process.env.DB_PASSWORD || fileConfig.database?.password,
  }),
  oaDatabase: Object.freeze({
    host: process.env.OA_DB_HOST || fileConfig.oaDatabase?.host || process.env.DB_HOST || fileConfig.database?.host || 'localhost',
    port: Number(process.env.OA_DB_PORT) || fileConfig.oaDatabase?.port || Number(process.env.DB_PORT) || fileConfig.database?.port || 5432,
    database: process.env.OA_DB_NAME || fileConfig.oaDatabase?.database || 'dingtalk_oa',
    user: process.env.OA_DB_USER || fileConfig.oaDatabase?.user || process.env.DB_USER || fileConfig.database?.user || 'postgres',
    password: process.env.OA_DB_PASSWORD || fileConfig.oaDatabase?.password || process.env.DB_PASSWORD || fileConfig.database?.password,
  }),
  dingtalk: Object.freeze({
    appkey: process.env.DINGTALK_APPKEY || fileConfig.dingtalk?.appkey,
    appsecret: process.env.DINGTALK_APPSECRET || fileConfig.dingtalk?.appsecret,
    robotCode: process.env.DINGTALK_ROBOT_CODE || fileConfig.dingtalk?.robotCode,
    robotAppkey: process.env.DINGTALK_ROBOT_APPKEY || fileConfig.dingtalk?.robotAppkey,
    robotAppsecret: process.env.DINGTALK_ROBOT_APPSECRET || fileConfig.dingtalk?.robotAppsecret,
    allProcessCodes,
    processTypeMap: resolvedProcessTypeMap,
    paymentEventUserIds: [...AUTHORIZED_PAYMENT_EVENT_USER_IDS],
  }),
  scheduler: Object.freeze({
    cron: process.env.SCHEDULER_CRON || fileConfig.scheduler?.cron || '7,37 * * * *',
    startTime: process.env.SCHEDULER_START_TIME || fileConfig.scheduler?.startTime || '2026-04-01T00:00:00+08:00',
    oaUpdatedAtInitialLookbackDays: Number(process.env.SCHEDULER_OA_UPDATED_AT_INITIAL_LOOKBACK_DAYS) || fileConfig.scheduler?.oaUpdatedAtInitialLookbackDays || 45,
    oaUpdatedAtOverlapMinutes: Number(process.env.SCHEDULER_OA_UPDATED_AT_OVERLAP_MINUTES) || fileConfig.scheduler?.oaUpdatedAtOverlapMinutes || 120,
    oaUpdatedAtDailyReconciliationLookbackDays: Number(process.env.SCHEDULER_OA_UPDATED_AT_DAILY_RECONCILIATION_LOOKBACK_DAYS) || fileConfig.scheduler?.oaUpdatedAtDailyReconciliationLookbackDays || 7,
    compensationCron: process.env.SCHEDULER_COMPENSATION_CRON || fileConfig.scheduler?.compensationCron || '17 3 * * *',
    fxRatesCron: process.env.SCHEDULER_FX_RATES_CRON || fileConfig.scheduler?.fxRatesCron || '5 0 * * *',
    fxRatesTimezone: process.env.SCHEDULER_FX_RATES_TIMEZONE || fileConfig.scheduler?.fxRatesTimezone || 'Asia/Shanghai',
    fxRatesRunOnStartup: parseBooleanEnv(process.env.SCHEDULER_FX_RATES_RUN_ON_STARTUP, fileConfig.scheduler?.fxRatesRunOnStartup ?? true),
    pendingCompensationLimit: Number(process.env.SCHEDULER_PENDING_COMPENSATION_LIMIT) || fileConfig.scheduler?.pendingCompensationLimit || 500,
    staleAgreedRefreshLimit: Number(process.env.SCHEDULER_STALE_AGREED_REFRESH_LIMIT) || fileConfig.scheduler?.staleAgreedRefreshLimit || 80,
    weeklyReportCron: process.env.SCHEDULER_WEEKLY_REPORT_CRON || fileConfig.scheduler?.weeklyReportCron || '0 10 * * 1',
    weeklyReportTimezone: process.env.SCHEDULER_WEEKLY_REPORT_TIMEZONE || fileConfig.scheduler?.weeklyReportTimezone || 'Asia/Shanghai',
    weeklyReportEnabled: parseBooleanEnv(process.env.SCHEDULER_WEEKLY_REPORT_ENABLED, fileConfig.scheduler?.weeklyReportEnabled ?? false),
    weeklyReportDryRun: parseBooleanEnv(process.env.SCHEDULER_WEEKLY_REPORT_DRY_RUN, fileConfig.scheduler?.weeklyReportDryRun ?? false),
    weeklyReportAdminUserId: process.env.SCHEDULER_WEEKLY_REPORT_ADMIN_USER_ID || fileConfig.scheduler?.weeklyReportAdminUserId || '',
    weeklyReportDeptRecipients: parseDeptRecipients(
      process.env.SCHEDULER_WEEKLY_REPORT_DEPT_RECIPIENTS,
      fileConfig.scheduler?.weeklyReportDeptRecipients
    ),
  }),
  server: Object.freeze({
    port: Number(process.env.PORT) || fileConfig.server?.port || 3002,
  }),
});

export default config;
