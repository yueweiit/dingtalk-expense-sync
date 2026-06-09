import logger from './logger.js';
import database from './database.js';
import {
  ER_API_LATEST_USD,
  formatDateShanghai,
  fetchUsdRatesLatest,
  cnyPerUnitFromUsdBaseRates
} from './openErFx.js';

/**
 * 将钉钉表单「币种」展示文案尽量映射为 ISO4217（三字母）。
 * 无法识别时返回 null（空字符串按人民币处理在 convertAmountToCny 内）。
 */
export function normalizeCurrencyToIso(label: unknown): string | null {
  if (label == null) {
    return null;
  }
  const raw = String(label).trim();
  if (!raw) {
    return null;
  }
  const u = raw.toUpperCase();
  const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/\bRMB\b|\bCNY\b|\bCNH\b/.test(folded)) {
    return 'CNY';
  }
  if (/\bUSD\b|US\$|DOLAR|DOLLAR/.test(folded)) {
    return 'USD';
  }
  if (/\bMXN\b|PESO/.test(folded)) {
    return 'MXN';
  }
  if (/人民币|CNY|CNH|\bRMB\b|元\s*整/i.test(raw)) {
    return 'CNY';
  }
  if (/美元|美金|US\$|\bUSD\b|d[oó]lar|dollar/i.test(raw)) {
    return 'USD';
  }
  if (/欧元|\bEUR\b/i.test(raw)) {
    return 'EUR';
  }
  if (/港币|港幣|\bHKD\b/i.test(raw)) {
    return 'HKD';
  }
  if (/\bGBP\b|英镑/i.test(raw)) {
    return 'GBP';
  }
  if (/\bJPY\b|日元|円/i.test(raw)) {
    return 'JPY';
  }
  // 业务里常见直接写「比索Peso」，默认按墨西哥比索(MXN)处理
  if (/\bMXN\b|墨西哥比索|比索|peso/i.test(raw)) {
    return 'MXN';
  }
  if (/\bCOP\b|哥伦比亚比索/i.test(raw)) {
    return 'COP';
  }
  if (/\bPEN\b|索尔/i.test(raw)) {
    return 'PEN';
  }
  if (/\bCLP\b|智利比索/i.test(raw)) {
    return 'CLP';
  }
  if (/\bBRL\b|巴西雷亚尔/i.test(raw)) {
    return 'BRL';
  }
  if (/\bVES\b/i.test(raw)) {
    return 'VES';
  }
  if (/\bARS\b/i.test(raw)) {
    return 'ARS';
  }
  if (/\bTWD\b|新台币/i.test(raw)) {
    return 'TWD';
  }
  if (/\bSGD\b/i.test(raw)) {
    return 'SGD';
  }
  if (/\bAUD\b/i.test(raw)) {
    return 'AUD';
  }
  if (/\bCAD\b/i.test(raw)) {
    return 'CAD';
  }
  if (/\bCHF\b/i.test(raw)) {
    return 'CHF';
  }
  if (/\bINR\b/i.test(raw)) {
    return 'INR';
  }
  if (/\bKRW\b/i.test(raw)) {
    return 'KRW';
  }
  if (/\bTHB\b/i.test(raw)) {
    return 'THB';
  }
  if (/\bVND\b/i.test(raw)) {
    return 'VND';
  }
  if (/\bIDR\b/i.test(raw)) {
    return 'IDR';
  }
  if (/\bMYR\b/i.test(raw)) {
    return 'MYR';
  }
  if (/\bPHP\b/i.test(raw)) {
    return 'PHP';
  }
  if (/\bNZD\b/i.test(raw)) {
    return 'NZD';
  }
  if (/\bZAR\b/i.test(raw)) {
    return 'ZAR';
  }
  if (/\bTRY\b/i.test(raw)) {
    return 'TRY';
  }
  if (/\bRUB\b/i.test(raw)) {
    return 'RUB';
  }
  if (/\bPLN\b/i.test(raw)) {
    return 'PLN';
  }
  if (/\bSEK\b/i.test(raw)) {
    return 'SEK';
  }
  if (/\bNOK\b/i.test(raw)) {
    return 'NOK';
  }
  if (/\bDKK\b/i.test(raw)) {
    return 'DKK';
  }
  const m = raw.match(/\b([A-Z]{3})\b/i);
  if (m) {
    const c = m[1].toUpperCase();
    if (c === 'RMB') {
      return 'CNY';
    }
    return c;
  }
  if (/\bUSDT\b|\bUSDC\b|\bBUSD\b|\bDAI\b|\bTUSD\b/i.test(u)) {
    return 'USD';
  }
  return null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ConvertAmountParams {
  amount: unknown;
  currencyLabel: unknown;
  createTime: string | number | Date;
}

/**
 * 将原币金额折为人民币（本位币）。
 * 优先：`fx_rates_daily` 按提交日(Asia/Shanghai)取 `cny_per_unit`（<= 提交日的最近一条）。
 * 兜底：直接请求 open.er-api latest/USD（见 {@link ER_API_LATEST_USD}）。
 */
export async function convertAmountToCny({ amount, currencyLabel, createTime }: ConvertAmountParams): Promise<number | null> {
  if (amount == null) {
    return null;
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return null;
  }

  const trimmedCur = currencyLabel != null ? String(currencyLabel).trim() : '';
  const isoGuess = normalizeCurrencyToIso(currencyLabel);
  const iso = isoGuess || (trimmedCur === '' ? 'CNY' : null);
  if (!iso) {
    logger.warn(`无法识别币种，本位币金额置空: currency=${JSON.stringify(currencyLabel)}`);
    return null;
  }
  if (iso === 'CNY') {
    return roundMoney(n);
  }

  const submissionDay = formatDateShanghai(createTime);
  if (!submissionDay) {
    logger.warn('无法解析提交时间，本位币金额置空');
    return null;
  }

  try {
    await database.ensureFxRatesDailyTable();
    const fromDb = await database.getCnyPerUnitForSubmissionDate(iso, submissionDay);
    if (fromDb != null && Number.isFinite(fromDb)) {
      return roundMoney(n * fromDb);
    }

    const rates = await fetchUsdRatesLatest();
    const cnyPerUnit = cnyPerUnitFromUsdBaseRates(rates, iso);
    logger.warn(
      `日表无汇率(${iso}, ${submissionDay})，已兜底 ${ER_API_LATEST_USD}；建议跑定时任务或 npm run sync:fx-rates 写入 fx_rates_daily`
    );
    return roundMoney(n * cnyPerUnit);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`本位币折算失败(${iso}, ${submissionDay}): ${message}`);
    return null;
  }
}
