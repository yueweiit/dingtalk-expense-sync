/**
 * Sync DingTalk approval details directly into approval_expense_* tables.
 *
 * Examples:
 *   npx tsx scripts/sync-approval-expenses-from-dingtalk.ts --month=2026-04
 *   npx tsx scripts/sync-approval-expenses-from-dingtalk.ts --month=2026-04 --process=purchase
 *   npx tsx scripts/sync-approval-expenses-from-dingtalk.ts --start=2026-04-01T00:00:00+08:00 --end=2026-04-30T23:59:59+08:00
 *   npx tsx scripts/sync-approval-expenses-from-dingtalk.ts --month=2026-04 --department=IT --limit=100
 *   npx tsx scripts/sync-approval-expenses-from-dingtalk.ts --month=2026-04 --dry-run=1
 */
import fs from 'fs';
import path from 'path';
import { approvalSource } from '../src/oa-source.ts';
import processor from '../src/processor.ts';
import database, { pool } from '../src/database.ts';
import config from '../src/config.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';
import { resolveFixedApplicantDepartment, resolveOperationFormName, resolvePurchaseFormName } from '../src/form-source.ts';
import { collectOperationDeptSplits } from '../src/operation-dept-splits.ts';
import {
  getProcessKind as resolveProcessKind,
  getProcessTypeLabel as resolveProcessTypeLabel,
} from '../src/process-config.ts';
import type { ApprovalInstance } from '../src/processor.ts';
import type { PurchaseItemData, PurchaseProcessorData } from '../src/database/types.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const item of argv.slice(2)) {
    if (!item.startsWith('--')) continue;
    const [k, ...rest] = item.slice(2).split('=');
    args[k] = rest.length ? rest.join('=') : '1';
  }
  return args;
}

function parseProcessArg(value: string): string {
  const text = String(value || 'all').trim().toLowerCase();
  if (!text || text === 'all') return 'all';
  if (text === 'operation' || text.includes('运营')) return 'operation';
  if (text === 'purchase' || text.includes('采购')) return 'purchase';
  throw new Error('--process must be all, operation, or purchase');
}

function getProcessKind(processCode: string): string {
  return resolveProcessKind(processCode, config.dingtalk);
}

function getProcessType(processCode: string): string {
  return resolveProcessTypeLabel(processCode, config.dingtalk);
}

function normalizeNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function resolveTimeRange(args: Record<string, string>): { startMs: number; endMs: number } {
  if (args.month) {
    const m = String(args.month).trim().match(/^(\d{4})-(\d{1,2})$/);
    if (!m) throw new Error('--month format must be YYYY-MM, for example 2026-04');
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!year || month < 1 || month > 12) {
      throw new Error('--month format must be YYYY-MM, for example 2026-04');
    }
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    return {
      startMs: new Date(`${year}-${mm}-01T00:00:00+08:00`).getTime(),
      endMs: new Date(`${year}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59.999+08:00`).getTime()
    };
  }

  if (args.start && args.end) {
    const startMs = new Date(args.start).getTime();
    const endMs = new Date(args.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error('--start/--end cannot be parsed as dates');
    }
    if (endMs < startMs) {
      throw new Error('--end must be later than --start');
    }
    return { startMs, endMs };
  }

  throw new Error('Please pass --month=YYYY-MM or both --start=... --end=...');
}

async function ensureExpenseSchema(): Promise<void> {
  const sqlPath = path.join(__dirname, '..', 'sql', 'ensure_approval_expense_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function collectInstanceIds(startMs: number, endMs: number, processFilter: string): Promise<Array<{ processInstanceId: string; processCode: string; kind: string }>> {
  const allProcessCodes = config.dingtalk.allProcessCodes;
  const items: Array<{ processInstanceId: string; processCode: string; kind: string }> = [];

  for (const processCode of allProcessCodes) {
    const kind = resolveProcessKind(processCode, config.dingtalk);
    if (processFilter !== 'all' && kind !== processFilter) continue;

    let nextToken = 0;
    let page = 0;
    do {
      const result = await approvalSource.queryProcessInstanceIds(startMs, endMs, processCode, nextToken, 20);
      const list = result?.list || [];
      for (const id of list) {
        items.push({ processInstanceId: String(id), processCode, kind });
      }
      page++;
      console.log(`process=${kind} code=${processCode} page=${page} ids=${list.length}`);
      nextToken = result?.nextToken || 0;
      await approvalSource.sleep(150);
    } while (nextToken && nextToken !== 0);
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.processInstanceId)) return false;
    seen.add(item.processInstanceId);
    return true;
  });
}

function getDepartmentText(instance: Record<string, unknown>, parsedData: Record<string, unknown>): string {
  return String(
    parsedData?.applicantDepartment ||
      instance.originatorDeptName ||
      (instance.rawData as Record<string, unknown>)?.originatorDeptName ||
      ''
  );
}

async function writeExpenseInstance(instance: Record<string, unknown>, kind: string, options: Record<string, string>): Promise<{ skipped?: boolean; id?: number }> {
  const meta = processor.parseApprovalMeta(instance as unknown as ApprovalInstance);
  const attachments = processor.extractAttachments((instance as unknown as ApprovalInstance).formComponentValues);
  const fixedApplicantDepartment = resolveFixedApplicantDepartment(String(instance.processCode || ''));

  if (kind === 'operation') {
    const opData = processor.parseOperationExpenseData((instance as unknown as ApprovalInstance).formComponentValues);
    const opApplicantDepartment = fixedApplicantDepartment ||
      (typeof opData.applicantDepartment === 'string' ? opData.applicantDepartment : null);
    const amount = opData.amount ?? normalizeNumber(processor.parseFormData((instance as unknown as ApprovalInstance).formComponentValues).amount);
    const currency = opData.currency ?? processor.parseFormData((instance as unknown as ApprovalInstance).formComponentValues).currency;
    const baseCurrencyAmount = await convertAmountToCny({
      amount,
      currencyLabel: currency,
      createTime: String(instance.createTime || '')
    });
    const deptSplits = collectOperationDeptSplits(opData);
    const id = await database.upsertOperationExpenseWithSplits({
      ...opData,
      applicantDepartment: opApplicantDepartment,
      processInstanceId: String(instance.processInstanceId || ''),
      businessId: String(instance.businessId),
      formName: resolveOperationFormName(String(instance.processCode || '')),
      amount: amount as number,
      currency: currency as string,
      baseCurrencyAmount: baseCurrencyAmount as number,
      ...meta,
      creatorDepartment: fixedApplicantDepartment || meta.creatorDepartment,
      rawData: instance as unknown as Record<string, unknown>
    }, deptSplits);
    if (id) {
      await database.replaceAttachments('operation', id, attachments);
    }
    return { id, amount: amount as number, currency: currency as string, baseCurrencyAmount: baseCurrencyAmount as number, department: opData.applicantDepartment } as unknown as { skipped?: boolean; id?: number };
  }

  if (kind === 'purchase') {
    const pData = processor.parsePurchaseExpenseData((instance as unknown as ApprovalInstance).formComponentValues);
    const purchaseApplicantDepartment = fixedApplicantDepartment ||
      (typeof pData.applicantDepartment === 'string' ? pData.applicantDepartment : null);
    const formData = processor.parseFormData((instance as unknown as ApprovalInstance).formComponentValues);
    const amount = pData.detailSummaryAmount ?? normalizeNumber(formData.amount);
    const currency = pData.currency ?? formData.currency;
    const baseCurrencyAmount = await convertAmountToCny({
      amount,
      currencyLabel: currency,
      createTime: String(instance.createTime || '')
    });
    const id = await database.upsertPurchaseExpense({
      ...pData,
      applicantDepartment: purchaseApplicantDepartment,
      processInstanceId: String(instance.processInstanceId || ''),
      businessId: String(instance.businessId),
      formName: resolvePurchaseFormName(String(instance.processCode || '')),
      baseCurrencyAmount: baseCurrencyAmount as number,
      ...meta,
      creatorDepartment: fixedApplicantDepartment || meta.creatorDepartment,
      rawData: instance as unknown as Record<string, unknown>
    });
    if (id) {
      const purchaseItems = Array.isArray(pData.items) ? pData.items as PurchaseItemData[] : [];
      const purchaseProcessors = Array.isArray(pData.processors) ? pData.processors as PurchaseProcessorData[] : [];
      await database.replaceAttachments('purchase', id, attachments);
      await database.replacePurchaseDetails(id, {
        items: purchaseItems,
        processors: purchaseProcessors,
      });
    }
    if (id) {
      const payments = [];
      if (amount != null || currency || formData.beneficiary || formData.paymentDate || formData.paymentTerms) {
        payments.push({
          rowNo: 1,
          beneficiary: formData.beneficiary ? String(formData.beneficiary) : undefined,
          amount: amount as number,
          paymentTerms: formData.paymentTerms ? String(formData.paymentTerms) : undefined,
          currency: currency ? String(currency) : undefined,
          paymentDate: formData.paymentDate ? String(formData.paymentDate) : undefined,
          rawData: undefined
        });
      }
      await database.replacePurchasePayments(id, payments);
    }
    return { id, amount: amount as number, currency: currency as string, baseCurrencyAmount: baseCurrencyAmount as number, department: pData.applicantDepartment } as unknown as { skipped?: boolean; id?: number };
  }

  return { skipped: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const processFilter = parseProcessArg(args.process || args.processType || args.process_type);
  const departmentFilter = String(args.department || '').trim().toLowerCase();
  const businessIdFilter = String(args.businessId || args.business_id || '').trim();
  const dryRun = String(args['dry-run'] || args.dryRun || '') === '1';
  const limit = args.limit ? Number.parseInt(args.limit, 10) : null;
  const { startMs, endMs } = resolveTimeRange(args);

  await ensureExpenseSchema();
  await database.ensureFxRatesDailyTable();

  console.log(JSON.stringify({
    sync: 'approval_expense_* from oa-source',
    startMs,
    endMs,
    process: processFilter,
    department: departmentFilter || null,
    businessId: businessIdFilter || null,
    dryRun,
    limit
  }, null, 2));

  let items = await collectInstanceIds(startMs, endMs, processFilter);
  if (Number.isFinite(limit) && limit && limit > 0) {
    items = items.slice(0, limit);
  }

  let fetched = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const instance = await approvalSource.getProcessInstance(item.processInstanceId);
      fetched++;
      instance.processInstanceId = instance.processInstanceId || item.processInstanceId;
      instance.processCode = instance.processCode || item.processCode;
      instance.processType = instance.processType || resolveProcessTypeLabel(item.processCode, config.dingtalk);

      if (businessIdFilter && String(instance.businessId || '') !== businessIdFilter) {
        skipped++;
        await approvalSource.sleep(120);
        continue;
      }

      const previewData = item.kind === 'purchase'
        ? processor.parsePurchaseExpenseData((instance as unknown as ApprovalInstance).formComponentValues)
        : processor.parseOperationExpenseData((instance as unknown as ApprovalInstance).formComponentValues);
      const departmentText = getDepartmentText(instance, previewData).toLowerCase();
      if (departmentFilter && !departmentText.includes(departmentFilter)) {
        skipped++;
        await approvalSource.sleep(120);
        continue;
      }

      if (dryRun) {
        console.log(JSON.stringify({
          processInstanceId: item.processInstanceId,
          businessId: instance.businessId,
          kind: item.kind,
          department: departmentText
        }));
        skipped++;
        await approvalSource.sleep(120);
        continue;
      }

      const result = await writeExpenseInstance(instance, item.kind, args);
      if (result.skipped) {
        skipped++;
      } else {
        written++;
      }
    } catch (e: unknown) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`failed processInstanceId=${item.processInstanceId}: ${message}`);
    }
    await approvalSource.sleep(120);
  }

  console.log(JSON.stringify({
    instanceIds: items.length,
    fetched,
    written,
    skipped,
    failed
  }, null, 2));

  await database.close();
  await approvalSource.close();
}

main().catch(async (e: unknown) => {
  console.error(e);
  await database.close().catch(() => {});
  await approvalSource.close().catch(() => {});
  process.exit(1);
});


