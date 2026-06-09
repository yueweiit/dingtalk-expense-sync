/**
 * 从钉钉重新拉取详情并覆盖写入库（依赖库里 raw_data.processInstanceId 或列 process_instance_id）
 * 若日志提示「仍用 business_id 兜底」且 HTTP 400：请改用 refresh-from-dingtalk-window.js 按时间窗口拉列表 ID。
 * 例：node scripts/refresh-from-dingtalk.js --department=IT --limit=200
 */
const dingtalk = require('../src/dingtalk');
const processor = require('../src/processor');
const database = require('../src/database');
const config = require('../src/config');
const { resolveProcessInstanceFetchId } = require('../src/workflowIds');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    args[k] = v ?? '';
  }
  return args;
}

function getProcessType(processCode) {
  const processCodes = config.dingtalk.processCodes;
  const index = processCodes.indexOf(processCode);
  if (index === 0) return '运营支出';
  if (index === 1) return '采购支出';
  return '其他';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const department = args.department || '';
  const limit = Math.min(500, Math.max(1, Number(args.limit || 200)));
  const processTypeFilter = args.processType || '';

  if (!department) {
    console.error('请指定 --department=IT（或关键词）');
    process.exit(1);
  }

  await database.ensureProcessInstanceIdColumn();
  await database.ensureBaseCurrencyAmountColumn();

  const client = await database.pool.connect();
  let rows;
  try {
    let sql = `SELECT business_id, process_code, raw_data, process_instance_id FROM approval_instances WHERE department LIKE $1`;
    const params = [`%${department}%`];
    if (processTypeFilter) {
      sql += ` AND process_type = $2`;
      params.push(processTypeFilter);
    }
    sql += ` ORDER BY update_time ASC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await client.query(sql, params);
    rows = result.rows;
  } finally {
    client.release();
  }

  if (!rows.length) {
    console.log(JSON.stringify({ message: '无匹配记录', department, limit }, null, 2));
    await database.close();
    return;
  }

  const fetchPlan = rows.map((r) => ({
    business_id: r.business_id,
    fetchId: resolveProcessInstanceFetchId(r.raw_data, r.business_id, r.process_instance_id)
  }));
  const processTypeById = new Map(rows.map((r) => [r.business_id, getProcessType(r.process_code)]));

  const fallbackOnly = fetchPlan.filter((p) => p.fetchId === p.business_id).length;
  console.log(
    JSON.stringify(
      {
        message: '开始从钉钉刷新',
        count: fetchPlan.length,
        note:
          fallbackOnly > 0
            ? `有 ${fallbackOnly} 条仍用 business_id 兜底拉详情；若仍报 invalidParameter，请先跑一次正常增量同步写入 process_instance_id/raw_data.processInstanceId`
            : undefined,
        sample: fetchPlan.slice(0, 3)
      },
      null,
      2
    )
  );

  const instanceResults = await dingtalk.getProcessInstances(fetchPlan.map((p) => p.fetchId));
  const fetchFailures = instanceResults.filter((item) => item.error);
  const instances = instanceResults
    .filter((item) => item.instance)
    .map((item) => {
      const instance = item.instance;
      instance.processType = processTypeById.get(instance.businessId) || instance.processType || '其他';
      return instance;
    });

  const results = await processor.processInstances(instances, { force: true });
  console.log(
    JSON.stringify(
      {
        requested: fetchPlan.length,
        fetched: instances.length,
        fetchFailed: fetchFailures.length,
        success: results.success,
        skipped: results.skipped,
        failed: results.failed
      },
      null,
      2
    )
  );

  await database.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
