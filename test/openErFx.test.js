const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

function loadModule(moduleName) {
  const distPath = path.join('..', 'dist', 'src', moduleName);
  const srcPath = path.join('..', 'src', moduleName);
  try {
    return require(distPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(srcPath);
  }
}

test('buildFxDailyRows converts USD-base rates into CNY-per-unit rows', () => {
  const { buildFxDailyRows } = loadModule('openErFx');

  assert.deepEqual(buildFxDailyRows({ CNY: 7, USD: 1, MXN: 20 }), [
    { currency: 'CNY', cny_per_unit: 1, usd_per_unit: 7, usd_cny: 7 },
    { currency: 'USD', cny_per_unit: 7, usd_per_unit: 1, usd_cny: 7 },
    { currency: 'MXN', cny_per_unit: 0.35, usd_per_unit: 20, usd_cny: 7 }
  ]);
});

test('formatDateShanghai returns null for invalid dates', () => {
  const { formatDateShanghai } = loadModule('openErFx');

  assert.equal(formatDateShanghai('not-a-date'), null);
});

test('cnyPerUnitFromUsdBaseRates rejects unknown currency codes', () => {
  const { cnyPerUnitFromUsdBaseRates } = loadModule('openErFx');

  assert.throws(
    () => cnyPerUnitFromUsdBaseRates({ CNY: 7 }, 'XYZ'),
    /rates 缺少或无效 XYZ/
  );
});

