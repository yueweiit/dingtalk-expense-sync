const axios = require('axios');

/** 基准 USD 的公开汇率 JSON（与入库日表同步任务使用同一地址） */
export const ER_API_LATEST_USD = 'https://open.er-api.com/v6/latest/USD';

type RatesByCurrency = Record<string, number>;

type LatestUsdRatesCache = {
  rates: RatesByCurrency;
  fetchedAt: number;
};

export type FxDailyRow = {
  currency: string;
  cny_per_unit: number;
  usd_per_unit: number;
  usd_cny: number;
};

/** 内存缓存：避免兜底拉接口过于频繁 */
let latestUsdRatesCache: LatestUsdRatesCache | null = null;
const RATES_CACHE_MS = 60 * 60 * 1000;

export function formatDateShanghai(isoOrMs: string | number | Date = Date.now(), timeZone = 'Asia/Shanghai'): string | null {
  const d = new Date(isoOrMs);
  if (!Number.isFinite(d.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function isRatesPayload(value: unknown): value is RatesByCurrency {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function fetchUsdRatesLatest(): Promise<RatesByCurrency> {
  const now = Date.now();
  if (latestUsdRatesCache && now - latestUsdRatesCache.fetchedAt < RATES_CACHE_MS) {
    return latestUsdRatesCache.rates;
  }

  const res = await axios.get(ER_API_LATEST_USD, { timeout: 12000, validateStatus: () => true });
  if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
    throw new Error(`HTTP ${res.status}`);
  }
  if (String(res.data.result || '').toLowerCase() !== 'success' || !isRatesPayload(res.data.rates)) {
    throw new Error(`unexpected payload: ${JSON.stringify(res.data).slice(0, 200)}`);
  }

  const rates = res.data.rates;
  latestUsdRatesCache = { rates, fetchedAt: now };
  return rates;
}

/**
 * 由 open.er-api `rates`（1 USD = rates[X] 个 X）生成按日入库行：每币种 1 单位 X 折合多少 CNY。
 */
export function buildFxDailyRows(rates: RatesByCurrency): FxDailyRow[] {
  const rCny = rates.CNY ?? rates.CNH;
  if (typeof rCny !== 'number' || !Number.isFinite(rCny) || rCny <= 0) {
    throw new Error('rates 缺少有效 CNY/CNH');
  }

  const out: FxDailyRow[] = [];
  for (const [code, r] of Object.entries(rates)) {
    const upper = String(code).toUpperCase();
    if (!Number.isFinite(r) || r <= 0) {
      continue;
    }
    let cnyPer: number;
    if (upper === 'CNY') {
      cnyPer = 1;
    } else if (upper === 'CNH') {
      const rCnh = rates.CNH;
      if (typeof rCnh !== 'number' || !Number.isFinite(rCnh) || rCnh <= 0) {
        continue;
      }
      cnyPer = rCny / rCnh;
    } else {
      cnyPer = rCny / r;
    }
    out.push({
      currency: upper,
      cny_per_unit: cnyPer,
      usd_per_unit: r,
      usd_cny: rCny
    });
  }
  return out;
}

/** 单次折算：1 单位 iso 折合多少 CNY（rates 为 USD 基准）。 */
export function cnyPerUnitFromUsdBaseRates(rates: RatesByCurrency, iso: string): number {
  const upper = String(iso).toUpperCase();
  const rCny = rates.CNY ?? rates.CNH;
  if (typeof rCny !== 'number' || !Number.isFinite(rCny) || rCny <= 0) {
    throw new Error('rates 缺少有效 CNY/CNH');
  }
  if (upper === 'CNY') {
    return 1;
  }
  if (upper === 'CNH') {
    const rCnh = rates.CNH;
    if (typeof rCnh !== 'number' || !Number.isFinite(rCnh) || rCnh <= 0) {
      throw new Error('rates 缺少有效 CNH');
    }
    return rCny / rCnh;
  }
  const r = rates[upper];
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
    throw new Error(`rates 缺少或无效 ${upper}`);
  }
  return rCny / r;
}

export function invalidateUsdRatesCache(): void {
  latestUsdRatesCache = null;
}
