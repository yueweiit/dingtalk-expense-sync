/**
 * 钉钉「获取单个审批实例详情」必须使用 processInstanceId；
 * 库表 business_id 存的是 businessId，二者不同，不能直接当作查询参数。
 */
export function resolveProcessInstanceFetchId(
  rawData: unknown,
  fallbackBusinessId: string,
  storedProcessInstanceId: string | null | undefined
): string {
  if (storedProcessInstanceId != null && String(storedProcessInstanceId).trim() !== '') {
    return String(storedProcessInstanceId).trim();
  }
  let raw = rawData;
  if (raw == null) {
    return fallbackBusinessId;
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fallbackBusinessId;
    }
  }
  if (raw === null || typeof raw !== 'object') {
    return fallbackBusinessId;
  }
  if (!('processInstanceId' in raw)) {
    return fallbackBusinessId;
  }
  const pid = raw.processInstanceId;
  if (pid != null && String(pid).trim() !== '') {
    return String(pid).trim();
  }
  return fallbackBusinessId;
}

