/**
 * 钉钉「获取单个审批实例详情」必须使用 processInstanceId；
 * 库表 business_id 存的是 businessId，二者不同，不能直接当作查询参数。
 *
 * @param {unknown} rawData 入库的 raw_data（JSON）
 * @param {string} fallbackBusinessId 仅作最后兜底（常与接口要求不符）
 * @param {string|null|undefined} storedProcessInstanceId 表字段 process_instance_id
 */
function resolveProcessInstanceFetchId(rawData, fallbackBusinessId, storedProcessInstanceId) {
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
  if (typeof raw !== 'object') {
    return fallbackBusinessId;
  }
  const pid = raw.processInstanceId;
  if (pid != null && String(pid).trim() !== '') {
    return String(pid).trim();
  }
  return fallbackBusinessId;
}

module.exports = { resolveProcessInstanceFetchId };
