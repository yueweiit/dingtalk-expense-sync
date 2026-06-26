/**
 * 规范化数值字段，避免 "无"、"$263,570.94"、"74,101.60" 等导致 numeric 入库失败。
 * 统一用于 processor 正常写入和 backfill 脚本。
 */
export function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim();
  if (!text) return null;

  const invalidTexts = ['无', 'n/a', 'na', 'none', '-', '--'];
  if (invalidTexts.includes(text.toLowerCase())) return null;

  // 移除空白、逗号、以及所有非数字/小数点/负号字符（覆盖各种货币符号）
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '').replace(/[^\d.-]/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
