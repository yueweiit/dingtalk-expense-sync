/**
 * Backfill structured approval_expense_* tables from approval_instances.
 *
 * Safe defaults:
 * - Does not change approval_instances.
 * - Upserts approval_expense_operation / approval_expense_purchase by business_id.
 * - Rebuilds child rows (items, processors, payments, attachments) for each processed record.
 *
 * Examples:
 *   node scripts/backfill-approval-expense-schema.js --limit=10
 *   node scripts/backfill-approval-expense-schema.js --processType=采购支出 --limit=100
 *   node scripts/backfill-approval-expense-schema.js --dry-run=1 --limit=5
 */
const database = require('../src/database');
const dingtalk = require('../src/dingtalk');
const config = require('../src/config');
const { convertAmountToCny } = require('../src/fxToCny');
const { resolveProcessInstanceFetchId } = require('../src/workflowIds');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const m = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (m) {
      args[m[1]] = m[2] == null ? '1' : m[2];
    }
  }
  return args;
}

function asObject(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value, maxLen = null) {
  if (value == null) return null;
  let text;
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

function norm(value) {
  return compact(value)
    ?.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase() || '';
}

function nameMatches(name, tokens) {
  const n = norm(name);
  return tokens.some((token) => n.includes(norm(token)));
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function componentValue(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.value != null) return parseJsonMaybe(item.value);
  if (item.extValue != null) return parseJsonMaybe(item.extValue);
  return null;
}

function formComponents(raw) {
  return asArray(asObject(raw).formComponentValues);
}

function findValue(components, tokens) {
  for (const item of components) {
    if (nameMatches(item?.name, tokens)) {
      const value = componentValue(item);
      if (compact(value) != null) return value;
    }
  }
  return null;
}

function findLastValue(components, tokens) {
  for (let i = components.length - 1; i >= 0; i--) {
    const item = components[i];
    if (nameMatches(item?.name, tokens)) {
      const value = componentValue(item);
      if (compact(value) != null) return value;
    }
  }
  return null;
}

function findDepartment(components, fallback) {
  if (compact(fallback)) return fallback;
  const deptField = components.find((item) => norm(item?.componentType) === 'departmentfield');
  return componentValue(deptField) || findValue(components, ['Departamento Solicitante', '申请部门', '部门']);
}

function normalizeNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = compact(value);
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value) {
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

function dateFromBusinessId(businessId) {
  const text = compact(businessId);
  const m = text && text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayRangeMs(dateText) {
  const startMs = new Date(`${dateText}T00:00:00+08:00`).getTime();
  const endMs = new Date(`${dateText}T23:59:59.999+08:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

function addDays(dateText, days) {
  const ms = new Date(`${dateText}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  const next = new Date(ms + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(next);
}

function taskTime(task) {
  const value = task?.finishTime || task?.createTime || task?.startTime;
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

function approvalMeta(raw) {
  const obj = asObject(raw);
  const tasks = asArray(obj.tasks);
  const userTasks = tasks.filter((t) => t && t.userId && t.userId !== 'bpms_system');
  const running = tasks.filter((t) => String(t?.status || '').toUpperCase() === 'RUNNING');
  const historical = userTasks
    .sort((a, b) => taskTime(a) - taskTime(b))
    .map((t) => compact(t.userName || t.userId))
    .filter(Boolean);

  return {
    approvalNo: obj.approvalNo || obj.approval_no || obj.businessId,
    currentNode: running.map((t) => compact(t.activityName || t.name)).filter(Boolean).join(', ') || null,
    currentOwner: running.map((t) => compact(t.userName || t.userId)).filter(Boolean).join(', ') || null,
    historicalApprovers: historical.join(', ') || null,
    approvalCompletedAt: obj.status === 'COMPLETED' ? (obj.endTime || obj.finishTime || null) : null,
    approvalStatus: obj.status || null,
    creatorName: obj.originatorUserName || obj.originator_user_name || obj.originatorUserId || null,
    sourceCreatedAt: obj.createTime || null,
    sourceUpdatedAt: obj.updateTime || obj.modifyTime || null,
    creatorDepartment: obj.originatorDeptName || null
  };
}

function labelFromRow(rowObj, tokens) {
  if (!rowObj || typeof rowObj !== 'object') return null;
  for (const [key, rawValue] of Object.entries(rowObj)) {
    if (!nameMatches(key, tokens)) continue;
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return rawValue.value ?? rawValue.label ?? rawValue.text ?? rawValue.name ?? rawValue;
    }
    return rawValue;
  }
  return null;
}

function extractTableRows(components, tableTokens) {
  const rows = [];
  for (const item of components) {
    const type = norm(item?.componentType);
    const value = componentValue(item);
    const looksLikeTable = type.includes('table') || type.includes('detail') || Array.isArray(value);
    if (!looksLikeTable) continue;
    if (tableTokens.length && !nameMatches(item?.name, tableTokens)) continue;
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (row && typeof row === 'object') rows.push(row);
      }
    }
  }
  return rows;
}

function extractAttachments(components) {
  const attachments = [];
  for (const item of components) {
    const name = item?.name || '';
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
          const url = v.url || v.fileUrl || v.downloadUrl || '';
          if (url) attachments.push({ attachmentType: v.type || '关键凭证', fileName: v.fileName || v.name || url.split('/').pop() || '', fileUrl: url, rawData: v });
        }
      }
    } else if (typeof value === 'object') {
      const url = value.url || value.fileUrl || value.downloadUrl || '';
      if (url) attachments.push({ attachmentType: value.type || '关键凭证', fileName: value.fileName || value.name || url.split('/').pop() || '', fileUrl: url, rawData: value });
    }
  }
  return attachments;
}

function buildPurchaseItemRows(components) {
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

function buildProcessorRows(components) {
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

function buildPaymentRows(components) {
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

function parseRow(row) {
  const raw = asObject(row.raw_data);
  const components = formComponents(raw);
  const meta = approvalMeta(raw);

  const typeText = norm(row.process_type);
  const isPurchase = typeText.includes(norm('采购')) || typeText.includes('purchase');

  // 通用字段
  const common = {
    ...meta,
    requestDate: normalizeDate(findValue(components, ['Fecha de solicitud', '申请日期'])) || normalizeDate(row.create_time),
    applicantDepartment: findDepartment(components, row.originator_dept_name || row.department),
    productionType: findValue(components, ['Produccion', 'Producción', '生产/非生产']),
    monthlyBudgetAmount: normalizeNumber(findValue(components, ['Importe presupuestado', '本月预算金额'])) || normalizeNumber(row.monthly_budget),
    monthlyBudgetUsedAmount: normalizeNumber(findValue(components, ['Importe utilizado', '本月预算已用金额'])) || normalizeNumber(row.monthly_budget_used),
    processInstanceId: row.process_instance_id || null,
    businessId: row.business_id,
    rawData: raw
  };

  if (isPurchase) {
    return {
      type: 'purchase',
      ...common,
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
      keyVoucher: findValue(components, ['Comprobante clave', '关键凭证']),
      items: buildPurchaseItemRows(components),
      processors: buildProcessorRows(components),
      payments: buildPaymentRows(components),
      attachments: extractAttachments(components)
    };
  }

  // 运营支出
  return {
    type: 'operation',
    ...common,
    applicationType: findValue(components, ['Tipo de tramite', 'Tipo de trámite', '申请类型']),
    expenseType: findValue(components, ['支出类型']),
    executionRegion: findValue(components, ['Region de ejecucion', 'Región de ejecución', '执行地区']),
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
    keyVoucher: findValue(components, ['Comprobante clave', '关键凭证']),
    attachments: extractAttachments(components)
  };
}

async function findDingtalkInstanceByBusinessId(row, cache) {
  const processCode = compact(row.process_code, 64);
  const businessId = compact(row.business_id, 64);
  const dateText = normalizeDate(row.create_time) || dateFromBusinessId(businessId);
  if (!businessId || !dateText) return null;

  const configuredCodes = Array.isArray(config.dingtalk?.processCodes) ? config.dingtalk.processCodes : [];
  const processCodes = [...new Set([processCode, ...configuredCodes].filter(Boolean))];
  const dates = [...new Set([addDays(dateText, -1), dateText, addDays(dateText, 1)].filter(Boolean))];

  for (const code of processCodes) {
    for (const day of dates) {
      const range = dayRangeMs(day);
      if (!range) continue;
      const cacheKey = `${code}:${day}`;
      if (!cache.has(cacheKey)) {
        const candidates = [];
        let nextToken = 0;
        do {
          const result = await dingtalk.queryProcessInstanceIds(range.startMs, range.endMs, code, nextToken, 20);
          for (const pid of result?.list || []) candidates.push(String(pid));
          nextToken = result?.nextToken || 0;
          await dingtalk.sleep(120);
        } while (nextToken && nextToken !== 0);
        cache.set(cacheKey, { candidates, detailsByBusinessId: new Map(), scanned: false });
      }
      const entry = cache.get(cacheKey);
      if (entry.detailsByBusinessId.has(businessId)) return entry.detailsByBusinessId.get(businessId);
      if (entry.scanned) continue;
      for (const pid of entry.candidates) {
        const instance = await dingtalk.getProcessInstance(pid);
        if (instance?.businessId) entry.detailsByBusinessId.set(String(instance.businessId), instance);
        await dingtalk.sleep(120);
        if (String(instance?.businessId || '') === businessId) return instance;
      }
      entry.scanned = true;
      if (entry.detailsByBusinessId.has(businessId)) return entry.detailsByBusinessId.get(businessId);
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const limit = args.limit ? Number.parseInt(args.limit, 10) : null;
  const dryRun = String(args['dry-run'] || args.dryRun || '') === '1';
  const fromDingtalk = String(args['from-dingtalk'] || args.fromDingtalk || '') === '1';
  const resolveByWindow = String(args['resolve-by-window'] || args.resolveByWindow || '') === '1';
  const processType = args.processType || args.process_type || null;
  const businessId = args.businessId || args.business_id || null;

  const conditions = [];
  const params = [];
  if (processType) { params.push(processType); conditions.push(`process_type = $${params.length}`); }
  if (businessId) { params.push(businessId); conditions.push(`business_id = $${params.length}`); }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitSql = Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : '';

  const client = await database.pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM approval_instances ${whereSql} ORDER BY create_time ASC NULLS LAST, id ASC ${limitSql}`,
      params
    );

    let ok = 0;
    let fetchFailed = 0;
    let resolvedByWindow = 0;
    const windowCache = new Map();

    for (const row of rows) {
      let sourceRow = row;
      if (fromDingtalk) {
        const fetchId = resolveProcessInstanceFetchId(row.raw_data, row.business_id, row.process_instance_id);
        try {
          let instance = null;
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
        } catch (e) {
          fetchFailed++;
          console.error(`fetch failed business_id=${row.business_id}, fetchId=${fetchId}: ${e.message}`);
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
          items: parsed.items?.length || 0,
          processors: parsed.processors?.length || 0,
          payments: parsed.payments?.length || 0,
          attachments: parsed.attachments?.length || 0
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

      let expenseId;
      if (parsed.type === 'purchase') {
        expenseId = await database.upsertPurchaseExpense({ ...parsed, baseCurrencyAmount });
        if (expenseId) {
          if (parsed.items.length > 0) await database.replacePurchaseItems(expenseId, parsed.items);
          if (parsed.processors.length > 0) await database.replacePurchaseProcessors(expenseId, parsed.processors);
          if (parsed.payments.length > 0) await database.replacePurchasePayments(expenseId, parsed.payments);
        }
      } else {
        expenseId = await database.upsertOperationExpense({ ...parsed, baseCurrencyAmount });
      }

      if (expenseId && parsed.attachments.length > 0) {
        await database.replaceAttachments(parsed.type, expenseId, parsed.attachments);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
