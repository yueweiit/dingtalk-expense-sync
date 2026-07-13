/**
 * 按时间窗口从 oa-source 重建审批实例 ID，再拉详情入库。
 * 适用于库里只有 business_id、raw_data 里没有 processInstanceId，导致 refresh-from-dingtalk.ts 无法按实例 ID 补刷的情况。
 *
 * 例（项目根目录执行）：
 *   npx tsx scripts/refresh-from-dingtalk-window.ts --month=2026-04 --department=IT
 *   npx tsx scripts/refresh-from-dingtalk-window.ts --start=2026-04-01T00:00:00+08:00 --end=2026-04-30T23:59:59+08:00 --department=IT
 */
import { approvalSource } from '../src/oa-source.ts';
import processor from '../src/processor.ts';
import database, { pool } from '../src/database.ts';
import config from '../src/config.ts';
import { getProcessTypeLabel } from '../src/process-config.ts';
import type { ApprovalInstance } from '../src/processor.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    args[k] = v ?? '';
  }
  return args;
}

function getProcessType(processCode: string): string {
  return getProcessTypeLabel(processCode, config.dingtalk);
}

function extractDepartment(instance: Record<string, unknown>): string {
  const vals = (instance.formComponentValues as Array<Record<string, unknown>>) || [];
  const f = vals.find((item) => item.name && String(item.name).includes('部门Departamento'));
  return f && f.value != null ? String(f.value) : '';
}

function resolveTimeRange(args: Record<string, string>): { startMs: number; endMs: number } {
  if (args.month) {
    const [y, m] = args.month.trim().split('-');
    const yi = Number(y);
    const mi = Number(m);
    if (!yi || !mi || mi < 1 || mi > 12) {
      throw new Error('month 格式应为 2026-04');
    }
    const lastDay = new Date(yi, mi, 0).getDate();
    const startMs = new Date(`${y}-${String(mi).padStart(2, '0')}-01T00:00:00+08:00`).getTime();
    const endMs = new Date(
      `${y}-${String(mi).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999+08:00`
    ).getTime();
    return { startMs, endMs };
  }
  if (args.start && args.end) {
    const startMs = new Date(args.start).getTime();
    const endMs = new Date(args.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error('start/end 无法解析为日期');
    }
    if (endMs < startMs) {
      throw new Error('end 必须大于或等于 start');
    }
    return { startMs, endMs };
  }
  throw new Error('请指定 --month=2026-04 或同时指定 --start=... --end=...（ISO 时间字符串）');
}

async function collectInstanceIds(startMs: number, endMs: number): Promise<Array<{ processInstanceId: string; processCode: string }>> {
  const items: Array<{ processInstanceId: string; processCode: string }> = [];
  const processCodes = config.dingtalk.processCodes || [];

  for (const processCode of processCodes) {
    let nextToken = 0;
    let page = 0;
    do {
      const queryResult = await approvalSource.queryProcessInstanceIds(startMs, endMs, processCode, nextToken);
      if (!queryResult || !queryResult.list || queryResult.list.length === 0) {
        break;
      }
      for (const id of queryResult.list) {
        items.push({ processInstanceId: String(id), processCode });
      }
      page++;
      nextToken = queryResult.nextToken;
      console.log(`流程 ${processCode} 第${page}页: ${queryResult.list.length} 个实例 ID`);
      await approvalSource.sleep(150);
    } while (nextToken && nextToken !== 0);
  }

  const seen = new Set<string>();
  const unique: Array<{ processInstanceId: string; processCode: string }> = [];
  for (const it of items) {
    if (seen.has(it.processInstanceId)) continue;
    seen.add(it.processInstanceId);
    unique.push(it);
  }
  return unique;
}

async function loadBadPurchaseBusinessIds(startMs: number, endMs: number, limit?: string): Promise<Set<string>> {
  const maxRows = Math.min(5000, Math.max(1, Number(limit || 1000)));
  const r = await pool.query(
    `
      SELECT business_id
      FROM approval_instances
      WHERE process_type = '采购支出'
        AND create_time >= $1
        AND create_time <= $2
        AND (
          process_instance_id IS NULL
          OR department IS NULL
          OR amount IS NULL
          OR amount = 0
          OR currency IS NULL
          OR TRIM(COALESCE(currency, '')) = ''
        )
      ORDER BY create_time ASC
      LIMIT $3
    `,
    [new Date(startMs), new Date(endMs), maxRows]
  );
  return new Set(r.rows.map((row) => String(row.business_id)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const deptKw = (args.department || '').trim();
  const businessIdFilter = (args.businessId || args.business_id || '').trim();
  const onlyBadPurchase = String(args.onlyBadPurchase || args.only_bad_purchase || '') === '1';

  const { startMs, endMs } = resolveTimeRange(args);

  await database.ensureProcessInstanceIdColumn();
  await database.ensureBaseCurrencyAmountColumn();
  const targetBusinessIds = onlyBadPurchase
    ? await loadBadPurchaseBusinessIds(startMs, endMs, args.limit)
    : new Set(businessIdFilter ? [businessIdFilter] : []);

  console.log(
    JSON.stringify(
      {
        message: '按时间窗口向 oa-source 查询实例 ID 列表（此处返回的即为详情读取所需的 processInstanceId）',
        startMs,
        endMs,
        departmentFilter: deptKw || '(不过滤，窗口内全部写入)'
      },
      null,
      2
    )
  );

  const pairs = await collectInstanceIds(startMs, endMs);
  console.log(
    JSON.stringify(
      {
        uniqueInstanceCount: pairs.length,
        targetBusinessIdCount: targetBusinessIds.size,
        onlyBadPurchase
      },
      null,
      2
    )
  );

  if (!pairs.length) {
    await database.close();
    return;
  }

  let ok = 0;
  let skippedDept = 0;
  let skippedBusinessId = 0;
  let skippedProcessor = 0;
  let fetchFail = 0;

  for (const { processInstanceId, processCode } of pairs) {
    try {
      const instance = await approvalSource.getProcessInstance(processInstanceId);
      instance.processCode = instance.processCode || processCode;
      instance.processType = getProcessTypeLabel(processCode, config.dingtalk);

      if (targetBusinessIds.size > 0 && !targetBusinessIds.has(String(instance.businessId || ''))) {
        skippedBusinessId++;
        await approvalSource.sleep(120);
        continue;
      }

      if (deptKw) {
        const d = extractDepartment(instance);
        if (!d.toUpperCase().includes(deptKw.toUpperCase())) {
          skippedDept++;
          await approvalSource.sleep(120);
          continue;
        }
      }

      const r = await processor.processInstance(instance as unknown as ApprovalInstance, { force: true });
      if (r.skipped) {
        skippedProcessor++;
      } else {
        ok++;
      }
    } catch (e: unknown) {
      fetchFail++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`实例 ${processInstanceId}: ${message}`);
    }
      await approvalSource.sleep(120);
  }

  console.log(
    JSON.stringify(
      {
        uniqueIds: pairs.length,
        upsertedOrUpdated: ok,
        skippedBusinessIdMismatch: skippedBusinessId,
        skippedDepartmentMismatch: skippedDept,
        skippedByProcessor: skippedProcessor,
        fetchOrProcessFail: fetchFail
      },
      null,
      2
    )
  );

  await database.close();
  await approvalSource.close();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await database.close().catch(() => {});
  await approvalSource.close().catch(() => {});
  process.exit(1);
});


