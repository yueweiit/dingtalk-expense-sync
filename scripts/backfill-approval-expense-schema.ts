/**
 * Backfill structured approval_expense_* tables from approval_instances.
 *
 * Safe defaults:
 * - Does not change approval_instances.
 * - Upserts approval_expense_operation / approval_expense_purchase by business_id.
 * - Rebuilds child rows (items, processors, payments, attachments) for each processed record.
 *
 * Examples:
 *   npx tsx scripts/backfill-approval-expense-schema.ts --limit=10
 *   npx tsx scripts/backfill-approval-expense-schema.ts --processType=采购支出 --limit=100
 *   npx tsx scripts/backfill-approval-expense-schema.ts --dry-run=1 --limit=5
 */
import database, { pool } from '../src/database.ts';
import dingtalk from '../src/dingtalk.ts';
import config from '../src/config.ts';
import { convertAmountToCny } from '../src/fxToCny.ts';
import { resolveOperationFormName, resolvePurchaseFormName } from '../src/form-source.ts';
import processor from '../src/processor.ts';
import { resolveProcessInstanceFetchId } from '../src/workflowIds.ts';
import { normalizeNumber } from '../src/utils.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    const m = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (m) {
      args[m[1]] = m[2] == null ? '1' : m[2];
    }
  }
  return args;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compact(value: unknown, maxLen: number | null = null): string | null {
  if (value == null) return null;
  let text: string;
  if (typeof value === 'string') {
    text = value.trim();
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else {
    text = JSON.stringify(value);
  }
  if (!text) return null;
  return maxLen ? text.substring(0, maxLen) : text;
}

function norm(value: unknown): string {
  return compact(value)
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase() || '';
}

function nameMatches(name: unknown, tokens: string[]): boolean {
  const n = norm(name);
  return tokens.some((token) => n.includes(norm(token)));
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function componentValue(item: unknown): unknown {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (obj.value != null) return parseJsonMaybe(obj.value);
  if (obj.extValue != null) return parseJsonMaybe(obj.extValue);
  return null;
}

function formComponents(raw: unknown): unknown[] {
  return asArray(asObject(raw).formComponentValues);
}

function findValue(components: unknown[], tokens: string[]): unknown {
  for (const item of components) {
    if (nameMatches((item as Record<string, unknown>)?.name, tokens)) {
      const value = componentValue(item);
      if (compact(value) != null) return value;
    }
  }
  return null;
}

function findLastValue(components: unknown[], tokens: string[]): unknown {
  for (let i = components.length - 1; i >= 0; i--) {
    const item = components[i];
    if (nameMatches((item as Record<string, unknown>)?.name, tokens)) {
      const value = componentValue(item);
      if (compact(value) != null) return value;
    }
  }
  return null;
}

function findDepartment(components: unknown[], fallback: unknown): string | null {
  if (compact(fallback)) return String(fallback);
  const deptField = components.find((item) => norm((item as Record<string, unknown>)?.componentType) === 'departmentfield');
  return String(componentValue(deptField) || findValue(components, ['Departamento Solicitante', '申请部门', '部门']) || '');
}


function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = compact(value);
  if (!text) return null;
  const m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const ms = Date.parse(text);
  if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  return null;
}

function dateFromBusinessId(businessId: unknown): string | null {
  const text = compact(businessId);
  const m = text && text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayRangeMs(dateText: string): { startMs: number; endMs: number } | null {
  const startMs = new Date(`${dateText}T00:00:00+08:00`).getTime();
  const endMs = new Date(`${dateText}T23:59:59.999+08:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

function addDays(dateText: string, days: number): string | null {
  const ms = new Date(`${dateText}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  const next = new Date(ms + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(next);
}

function taskTime(task: Record<string, unknown>): number {
  const value = task?.finishTime || task?.createTime || task?.startTime;
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) ? n : 0;
}

function approvalMeta(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw);
  const tasks = asArray(obj.tasks);
  const userTasks = tasks.filter((t) => t && (t as Record<string, unknown>).userId && (t as Record<string, unknown>).userId !== 'bpms_system');
  const running = tasks.filter((t) => String((t as Record<string, unknown>)?.status || '').toUpperCase() === 'RUNNING');
  const historical = userTasks
    .sort((a, b) => taskTime(a as Record<string, unknown>) - taskTime(b as Record<string, unknown>))
    .map((t) => compact((t as Record<string, unknown>).userName || (t as Record<string, unknown>).userId))
    .filter(Boolean);

  return {
    approvalNo: obj.approvalNo || obj.approval_no || obj.businessId,
    currentNode: running.map((t) => compact((t as Record<string, unknown>).activityName || (t as Record<string, unknown>).name)).filter(Boolean).join(', ') || null,
    currentOwner: running.map((t) => compact((t as Record<string, unknown>).userName || (t as Record<string, unknown>).userId)).filter(Boolean).join(', ') || null,
    historicalApprovers: historical.join(', ') || null,
    approvalCompletedAt: obj.status === 'COMPLETED' ? (obj.endTime || obj.finishTime || null) : null,
    approvalStatus: obj.status || null,
    creatorName: obj.originatorUserName || obj.originator_user_name || obj.originatorUserId || null,
    sourceCreatedAt: obj.createTime || null,
    sourceUpdatedAt: obj.updateTime || obj.modifyTime || null,
    creatorDepartment: obj.originatorDeptName || null
  };
}

function labelFromRow(rowObj: unknown, tokens: string[]): unknown {
  if (!rowObj || typeof rowObj !== 'object') return null;
  for (const [key, rawValue] of Object.entries(rowObj as Record<string, unknown>)) {
    if (!nameMatches(key, tokens)) continue;
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return (rawValue as Record<string, unknown>).value ?? (rawValue as Record<string, unknown>).label ?? (rawValue as Record<string, unknown>).text ?? (rawValue as Record<string, unknown>).name ?? rawValue;
    }
    return rawValue;
  }
  return null;
}

function extractTableRows(components: unknown[], tableTokens: string[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const item of components) {
    const type = norm((item as Record<string, unknown>)?.componentType);
    const value = componentValue(item);
    const looksLikeTable = type.includes('table') || type.includes('detail') || Array.isArray(value);
    if (!looksLikeTable) continue;
    if (tableTokens.length && !nameMatches((item as Record<string, unknown>)?.name, tableTokens)) continue;
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
      }
    }
  }
  return rows;
}

function extractAttachments(components: unknown[]): Array<Record<string, unknown>> {
  const attachments: Array<Record<string, unknown>> = [];
  for (const item of components) {
    const name = (item as Record<string, unknown>)?.name || '';
    if (!nameMatches(name, ['关键凭证', 'Comprobante', '附件', 'Adjunto'])) continue;
    const value = componentValue(item);
    if (!value) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && (trimmed.startsWith('http') || trimmed.startsWith('/'))) {
        attachments.push({ attachmentType: '关键凭证', fileName: trimmed.split('/').pop() || trimmed, fileUrl: trimmed, rawData: item });
      }
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string' && v.trim()) {
          attachments.push({ attachmentType: '关键凭证', fileName: v.trim().split('/').pop() || v.trim(), fileUrl: v.trim(), rawData: v });
        } else if (v && typeof v === 'object') {
          const url = (v as Record<string, unknown>).url || (v as Record<string, unknown>).fileUrl || (v as Record<string, unknown>).downloadUrl || '';
          if (url) attachments.push({ attachmentType: (v as Record<string, unknown>).type || '关键凭证', fileName: (v as Record<string, unknown>).fileName || (v as Record<string, unknown>).name || String(url).split('/').pop() || '', fileUrl: url, rawData: v });
        }
      }
    } else if (typeof value === 'object') {
      const url = (value as Record<string, unknown>).url || (value as Record<string, unknown>).fileUrl || (value as Record<string, unknown>).downloadUrl || '';
      if (url) attachments.push({ attachmentType: (value as Record<string, unknown>).type || '关键凭证', fileName: (value as Record<string, unknown>).fileName || (value as Record<string, unknown>).name || String(url).split('/').pop() || '', fileUrl: url, rawData: value });
    }
  }
  return attachments;
}

function buildPurchaseItemRows(components: unknown[]): Array<Record<string, unknown>> {
  const rows = extractTableRows(components, ['Desglose de los gastos', '需求明细']);
  return rows.map((raw, index) => ({
    rowNo: index + 1,
    itemName: compact(labelFromRow(raw, ['Nombre del articulo', 'Nombre del artículo', '物品名称']), 500),
    imageUrl: compact(labelFromRow(raw, ['Imagen', '图片'])),
    itemCode: compact(labelFromRow(raw, ['Codigo', 'Código', '编码']), 128),
    itemSpecification: compact(labelFromRow(raw, ['Especificacion', 'Especificación', '规格'])),
    quantity: normalizeNumber(labelFromRow(raw, ['Cantidad', '数量'])),
    inventory: normalizeNumber(labelFromRow(raw, ['Inventario', '库存'])),
    unit: compact(labelFromRow(raw, ['Unidad', '单位']), 64),
    unitPrice: normalizeNumber(labelFromRow(raw, ['Precio Unitario', 'Precio', '单价'])),
    totalAmount: normalizeNumber(labelFromRow(raw, ['Monto Total', '总金额'])),
    rawData: raw
  }));
}

function buildProcessorRows(components: unknown[]): Array<Record<string, unknown>> {
  const rows = extractTableRows(components, ['procesadores', '加工商明细']);
  return rows.map((raw, index) => ({
    rowNo: index + 1,
    processorName: compact(labelFromRow(raw, ['Nombre del proveedor', '加工商名字']), 500),
    processorPhone: compact(labelFromRow(raw, ['Telefono', 'Teléfono', '加工商电话']), 64),
    odt: compact(labelFromRow(raw, ['ODT']), 128),
    salesOrderNo: compact(labelFromRow(raw, ['orden de venta', '销售订单']), 128),
    processingMaterial: compact(labelFromRow(raw, ['Materiales de Procesamiento', '加工物料'])),
    quantity: normalizeNumber(labelFromRow(raw, ['Cantidad', '数量'])),
    unitPrice: normalizeNumber(labelFromRow(raw, ['Precio Unitario', '单价'])),
    totalAmount: normalizeNumber(labelFromRow(raw, ['Monto Total', '总金额'])),
    specificationRequirementDescription: compact(labelFromRow(raw, ['Descripcion', 'Descripción', '需求说明'])),
    deliveryDate: normalizeDate(labelFromRow(raw, ['Fecha de entrega', '交付日期'])),
    rawData: raw
  }));
}

function buildPaymentRows(components: unknown[]): Array<Record<string, unknown>> {
  const amount = normalizeNumber(findLastValue(components, ['importe', '金额']));
  const currency = compact(findLastValue(components, ['Moneda', '币种']), 32);
  const beneficiary = compact(findLastValue(components, ['beneficiario', '收款人']), 500);
  const paymentTerms = compact(findLastValue(components, ['Terminos de pago', 'Términos de pago', '付款条件']), 255);
  const paymentDate = normalizeDate(findLastValue(components, ['Fecha de pago', '付款日期']));

  if (amount != null || beneficiary || currency || paymentDate) {
    return [{ rowNo: 1, beneficiary, amount, paymentTerms, currency, paymentDate, rawData: null }];
  }
  return [];
}

function parseRow(row: Record<string, unknown>): Record<string, unknown> {
  const raw = asObject(row.raw_data);
  const components = formComponents(raw);
  const meta = approvalMeta(raw);

  const typeText = norm(row.process_type);
  const isPurchase = typeText.includes(norm('采购')) || typeText.includes('purchase');

  // 通用字段
  const common: Record<string, unknown> = {
    ...meta,
    requestDate: normalizeDate(findValue(components, ['Fecha de solicitud', '申请日期'])) || normalizeDate(row.create_time),
    applicantDepartment: findDepartment(components, row.originator_dept_name || row.department),
    productionType: findValue(components, ['Produccion', 'Producción', '生产/非生产']),
    monthlyBudgetAmount: normalizeNumber(findValue(components, ['Importe presupuestado', '本月预算金额'])) || normalizeNumber(row.monthly_budget),
    monthlyBudgetUsedAmount: normalizeNumber(findValue(components, ['Importe utilizado', '本月预算已用金额'])) || normalizeNumber(row.monthly_budget_used),
    monthlyBudgetRemainingAmount: normalizeNumber(findValue(components, ['Importe restante del presupuesto mensual', '本月预算剩余金额'])),
    processInstanceId: row.process_instance_id || null,
    businessId: row.business_id,
    rawData: raw
  };

  if (isPurchase) {
    return {
      type: 'purchase',
      ...common,
      formName: resolvePurchaseFormName(compact(row.process_code, 64)),
      purchaseExpense: findValue(components, ['Gastos de Compra', '采购支出']),
      orderName: findValue(components, ['Pedido', '订单']),
      projectName: findValue(components, ['Proyecto', '项目']),
      productName: findValue(components, ['Producto', '产品']),
      ywOemImlPhoneCase: findValue(components, ['YW OEM IML']),
      ywOemPhoneCase: findValue(components, ['YW OEM Phone Case']),
      ywOemTabletCase: findValue(components, ['YW OEM Tablet Case']),
      ywOemSupport: findValue(components, ['YW OEM Soporte', '支架类']),
      ywMoldesOdm: findValue(components, ['YW MOLDES ODM', '模具ODM']),
      consultingServices: findValue(components, ['咨询服务', 'Consultoria', 'Consultoría']),
      tiktokOnlineStore: findValue(components, ['Tiktok线上店铺']),
      executionRegion: findValue(components, ['Region de ejecucion', 'Región de ejecución', '执行地区']),
      orderPurchase: findValue(components, ['Compras por pedido', '订单采购']),
      expenseClassification: findValue(components, ['Clasificacion de gastos', 'Clasificación de gastos', '费用分类']),
      investmentPurchase: findValue(components, ['Compra de inversion', 'Compra de inversión', '投资采购']),
      servicePurchase: findValue(components, ['Adquisiciones de servicios', '服务类采购']),
      mroClassification: findValue(components, ['Clasificacion MRO', 'Clasificación MRO', 'MRO分类']),
      productiveMro: findValue(components, ['Productivo MRO', '生产性']),
      nonProductiveMro: findValue(components, ['No productivo MRO', '非生产性']),
      pdsClassification: findValue(components, ['Clasificacion PDS', 'Clasificación PDS', 'PDS分类']),
      pieceworkOutsourcing: findValue(components, ['Outsourcing por pieza', '计件外包']),
      logisticsTransportService: findValue(components, ['logística y transporte', '物流']),
      customsClearanceService: findValue(components, ['despacho aduanero', '清关']),
      detailSummaryAmount: normalizeNumber(findValue(components, ['Monto total detallado', '明细汇总金额'])),
      keyVoucher: compact(findValue(components, ['Comprobante clave', '关键凭证']), 2000),
      items: buildPurchaseItemRows(components),
      processors: buildProcessorRows(components),
      payments: buildPaymentRows(components),
      attachments: extractAttachments(components)
    };
  }

  // 运营支出
  const operationFields = processor.parseOperationExpenseData(components as any);
  return {
    type: 'operation',
    ...common,
    applicationType: findValue(components, ['Tipo de tramite', 'Tipo de trámite', '申请类型']),
    expenseType: findValue(components, ['支出类型']),
    executionRegion: findValue(components, ['Region de ejecucion', 'Región de ejecución', '执行地区']),
    formName: resolveOperationFormName(compact(row.process_code, 64)),
    operationExpense: findValue(components, ['Gastos de operacion', 'Gastos de operación', '管理支出']),
    employeeBenefitsExpense: findValue(components, ['Gastos de beneficios', '职工福利费']),
    bonusExpense: findValue(components, ['Bonificaciones', '奖金']),
    salaryExpense: findValue(components, ['salario', '工资']),
    administrativeExpense: findValue(components, ['Gastos administrativos', '管理费用']),
    vehicleUsageExpense: findValue(components, ['vehiculo', 'vehículo', '车辆使用费']),
    taxExpense: findValue(components, ['Impuestos', '税费']),
    financeRelatedExpense: findValue(components, ['finanzas', '财务相关费用']),
    salesExpense: findValue(components, ['Gastos de venta', '销售费用']),
    salesChannelCommissionExpense: findValue(components, ['canales de venta', '销售渠道管理']),
    salesTeamCustomerServiceExpense: findValue(components, ['equipo de ventas', '销售团队']),
    otherSalesRelatedExpense: findValue(components, ['Otros gastos relacionados', '其他销售']),
    marketingAdvertisingExpense: findValue(components, ['marketing', 'publici', '市场推广', '广告']),
    matterDescription: findValue(components, ['Explicacion de asuntos', 'Explicación de asuntos', '事项说明']),
    beneficiary: compact(findLastValue(components, ['beneficiario', '收款人']), 500),
    amount: normalizeNumber(findLastValue(components, ['importe', '金额'])) || normalizeNumber(row.amount),
    paymentTerms: compact(findLastValue(components, ['Terminos de pago', 'Términos de pago', '付款条件']), 255),
    currency: compact(findLastValue(components, ['Moneda', '币种']), 32) || row.currency,
    paymentDate: normalizeDate(findLastValue(components, ['Fecha de pago', '付款日期'])),
    keyVoucher: compact(findValue(components, ['Comprobante clave', '关键凭证']), 2000),
    ...operationFields,
    attachments: extractAttachments(components)
  };
}

async function findDingtalkInstanceByBusinessId(row: Record<string, unknown>, cache: Map<string, { candidates: string[]; detailsByBusinessId: Map<string, Record<string, unknown>>; scanned: boolean }>): Promise<Record<string, unknown> | null> {
  const processCode = compact(row.process_code, 64);
  const businessId = compact(row.business_id, 64);
  const dateText = normalizeDate(row.create_time) || dateFromBusinessId(businessId);
  if (!businessId || !dateText) return null;

  const configuredCodes = Array.isArray(config.dingtalk?.processCodes) ? config.dingtalk.processCodes : [];
  const processCodes = [...new Set([processCode, ...configuredCodes].filter(Boolean) as string[])];
  const dates = [...new Set([addDays(dateText, -1), dateText, addDays(dateText, 1)].filter(Boolean) as string[])];

  for (const code of processCodes) {
    for (const day of dates) {
      const range = dayRangeMs(day);
      if (!range) continue;
      const cacheKey = `${code}:${day}`;
      if (!cache.has(cacheKey)) {
        const candidates: string[] = [];
        let nextToken = 0;
        do {
          const result = await dingtalk.queryProcessInstanceIds(range.startMs, range.endMs, code, nextToken, 20);
          for (const pid of result?.list || []) candidates.push(String(pid));
          nextToken = result?.nextToken || 0;
          await dingtalk.sleep(120);
        } while (nextToken && nextToken !== 0);
        cache.set(cacheKey, { candidates, detailsByBusinessId: new Map(), scanned: false });
      }
      const entry = cache.get(cacheKey)!;
      if (entry.detailsByBusinessId.has(businessId)) return entry.detailsByBusinessId.get(businessId) || null;
      if (entry.scanned) continue;
      for (const pid of entry.candidates) {
        const instance = await dingtalk.getProcessInstance(pid);
        if (instance?.businessId) entry.detailsByBusinessId.set(String(instance.businessId), instance);
        await dingtalk.sleep(120);
        if (String(instance?.businessId || '') === businessId) return instance;
      }
      entry.scanned = true;
      if (entry.detailsByBusinessId.has(businessId)) return entry.detailsByBusinessId.get(businessId) || null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const limit = args.limit ? Number.parseInt(args.limit, 10) : null;
  const dryRun = String(args['dry-run'] || args.dryRun || '') === '1';
  const fromDingtalk = String(args['from-dingtalk'] || args.fromDingtalk || '') === '1';
  const resolveByWindow = String(args['resolve-by-window'] || args.resolveByWindow || '') === '1';
  const processType = args.processType || args.process_type || null;
  const businessId = args.businessId || args.business_id || null;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (processType) { params.push(processType); conditions.push(`process_type = $${params.length}`); }
  if (businessId) { params.push(businessId); conditions.push(`business_id = $${params.length}`); }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = Number.isFinite(limit) && limit && limit > 0 ? `LIMIT ${limit}` : '';

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM approval_instances ${whereSql} ORDER BY create_time ASC NULLS LAST, id ASC ${limitSql}`,
      params
    );

    let ok = 0;
    let fetchFailed = 0;
    let resolvedByWindow = 0;
    const windowCache = new Map<string, { candidates: string[]; detailsByBusinessId: Map<string, Record<string, unknown>>; scanned: boolean }>();

    for (const row of rows) {
      let sourceRow = row;
      if (fromDingtalk) {
        const fetchId = resolveProcessInstanceFetchId(row.raw_data, row.business_id, row.process_instance_id);
        try {
          let instance: Record<string, unknown> | null = null;
          if (fetchId !== row.business_id) {
            instance = await dingtalk.getProcessInstance(fetchId);
          } else if (resolveByWindow) {
            instance = await findDingtalkInstanceByBusinessId(row, windowCache);
            if (instance) resolvedByWindow++;
          }
          if (!instance) throw new Error('missing process_instance_id and window resolve did not find a matching DingTalk instance');
          sourceRow = {
            ...row,
            raw_data: { ...instance, processType: instance.processType || row.process_type, processCode: instance.processCode || row.process_code },
            process_instance_id: instance.processInstanceId || fetchId,
            process_code: instance.processCode || row.process_code,
            process_type: instance.processType || row.process_type,
            status: instance.status || row.status,
            create_time: instance.createTime || row.create_time
          };
          await dingtalk.sleep(120);
        } catch (e: unknown) {
          fetchFailed++;
          const message = e instanceof Error ? e.message : String(e);
          console.error(`fetch failed business_id=${row.business_id}, fetchId=${fetchId}: ${message}`);
          continue;
        }
      }

      const parsed = parseRow(sourceRow);
      if (dryRun) {
        console.log(JSON.stringify({
          business_id: sourceRow.business_id,
          type: parsed.type,
          amount: parsed.amount,
          currency: parsed.currency,
          items: (parsed.items as unknown[])?.length || 0,
          processors: (parsed.processors as unknown[])?.length || 0,
          payments: (parsed.payments as unknown[])?.length || 0,
          attachments: (parsed.attachments as unknown[])?.length || 0
        }, null, 2));
        ok++;
        continue;
      }

      // 计算本位币金额
      const amountForFx = parsed.type === 'purchase'
        ? (parsed.detailSummaryAmount ?? parsed.amount ?? normalizeNumber(sourceRow.amount))
        : (parsed.amount ?? normalizeNumber(sourceRow.amount));
      const currencyForFx = parsed.currency || sourceRow.currency || null;
      const createTimeForFx = sourceRow.create_time || parsed.sourceCreatedAt || null;
      const baseCurrencyAmount = amountForFx != null
        ? await convertAmountToCny({ amount: amountForFx, currencyLabel: currencyForFx, createTime: createTimeForFx })
        : null;

      let expenseId: number | undefined;
      if (parsed.type === 'purchase') {
        expenseId = await database.upsertPurchaseExpense({ ...parsed, baseCurrencyAmount } as any);
        if (expenseId) {
          if ((parsed.items as unknown[]).length > 0) await database.replacePurchaseItems(expenseId, parsed.items as any);
          if ((parsed.processors as unknown[]).length > 0) await database.replacePurchaseProcessors(expenseId, parsed.processors as any);
          if ((parsed.payments as unknown[]).length > 0) await database.replacePurchasePayments(expenseId, parsed.payments as any);
        }
      } else {
        const splitTypeMap: Record<string, 'salary' | 'social_insurance' | 'office_space'> = {
          salaryByDepartment: 'salary',
          socialInsuranceByDepartment: 'social_insurance',
          officeSpaceByDepartment: 'office_space',
        };
        const deptSplits: Array<{ splitType: 'salary' | 'social_insurance' | 'office_space'; department: string; amount: number; note?: string }> = [];

        for (const [key, splitType] of Object.entries(splitTypeMap)) {
          const rows = parsed[key] as Array<{ department?: string; amount?: number; note?: string }> | undefined;
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (!row?.department || row.amount == null) continue;
            deptSplits.push({
              splitType,
              department: String(row.department),
              amount: Number(row.amount),
              note: row.note ? String(row.note) : undefined,
            });
          }
        }

        if (deptSplits.length > 0) {
          expenseId = await database.upsertOperationExpenseWithSplits({ ...parsed, baseCurrencyAmount } as any, deptSplits as any);
        } else {
          expenseId = await database.upsertOperationExpense({ ...parsed, baseCurrencyAmount } as any);
        }
      }

      if (expenseId && (parsed.attachments as unknown[]).length > 0) {
        await database.replaceAttachments(String(parsed.type), expenseId, parsed.attachments as any);
      }

      ok++;
      if (ok % 100 === 0) console.log(`processed ${ok}/${rows.length}`);
    }

    if (dryRun) {
      console.log(`DRY RUN: parsed ${ok} rows; fetch failed ${fetchFailed}; resolved by window ${resolvedByWindow}; no data was written.`);
    } else {
      console.log(`OK: backfilled ${ok} approval expense rows; fetch failed ${fetchFailed}; resolved by window ${resolvedByWindow}.`);
    }
  } catch (e) {
    throw e;
  } finally {
    client.release();
    await database.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});


