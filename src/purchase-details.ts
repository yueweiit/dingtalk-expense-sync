import type { PurchaseItemData, PurchaseProcessorData } from './database/types.ts';
import { normalizeNumber } from './utils.ts';

type RecordValue = Record<string, unknown>;

export interface PurchaseDetails {
  items: PurchaseItemData[];
  processors: PurchaseProcessorData[];
}

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function matchesLabel(value: unknown, labels: string[]): boolean {
  const normalizedValue = normalizeLabel(value);
  return labels.some((label) => normalizedValue.includes(normalizeLabel(label)));
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function unwrapValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.value ?? record.label ?? record.text ?? record.name ?? value;
}

function toText(value: unknown, maxLength?: number): string | undefined {
  if (value == null) return undefined;
  const text = String(unwrapValue(value)).trim();
  if (!text) return undefined;
  return maxLength ? text.slice(0, maxLength) : text;
}

function toDate(value: unknown): string | undefined {
  const text = toText(value);
  if (!text) return undefined;
  const match = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return undefined;
}

function tableRow(value: unknown): RecordValue | null {
  if (Array.isArray(value)) {
    const result: RecordValue = {};
    for (const cell of value) {
      const record = asRecord(cell);
      const label = record?.label ?? record?.name ?? record?.key ?? record?.id;
      if (label) result[String(label)] = record?.value;
    }
    return Object.keys(result).length ? result : null;
  }

  const record = asRecord(value);
  if (!record) return null;
  if (Array.isArray(record.rowValue)) return tableRow(record.rowValue);
  return record;
}

function tableRows(components: unknown[] | undefined, tableLabels: string[]): RecordValue[] {
  const rows: RecordValue[] = [];
  for (const component of components || []) {
    const record = asRecord(component);
    if (!record || !matchesLabel(record.name, tableLabels)) continue;

    const value = parseJson(record.value ?? record.extValue);
    if (!Array.isArray(value)) continue;
    for (const rawRow of value) {
      const row = tableRow(rawRow);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function valueFromRow(row: RecordValue, labels: string[]): unknown {
  for (const [label, value] of Object.entries(row)) {
    if (matchesLabel(label, labels)) return unwrapValue(value);
  }
  return undefined;
}

export function parsePurchaseDetails(components: unknown[] | undefined): PurchaseDetails {
  const itemRows = tableRows(components, ['Desglose de los gastos', '需求明细', '采购需求明细']);
  const processorRows = tableRows(components, ['procesadores', '加工商明细']);

  return {
    items: itemRows.map((row, index) => ({
      rowNo: index + 1,
      itemName: toText(valueFromRow(row, ['Nombre del articulo', 'Nombre del artículo', '物品名称']), 500),
      imageUrl: toText(valueFromRow(row, ['Imagen', '图片'])),
      itemCode: toText(valueFromRow(row, ['Codigo', 'Código', '编码']), 128),
      itemSpecification: toText(valueFromRow(row, ['Especificacion', 'Especificación', '规格'])),
      quantity: normalizeNumber(valueFromRow(row, ['Cantidad', '数量'])) ?? undefined,
      inventory: normalizeNumber(valueFromRow(row, ['Inventario', '库存'])) ?? undefined,
      unit: toText(valueFromRow(row, ['Unidad', '单位']), 64),
      unitPrice: normalizeNumber(valueFromRow(row, ['Precio Unitario', 'Precio', '单价'])) ?? undefined,
      totalAmount: normalizeNumber(valueFromRow(row, ['Monto Total', '总金额'])) ?? undefined,
      rawData: row,
    })),
    processors: processorRows.map((row, index) => ({
      rowNo: index + 1,
      processorName: toText(valueFromRow(row, ['Nombre del proveedor', '加工商名字']), 500),
      processorPhone: toText(valueFromRow(row, ['Telefono', 'Teléfono', '加工商电话']), 64),
      odt: toText(valueFromRow(row, ['ODT']), 128),
      salesOrderNo: toText(valueFromRow(row, ['orden de venta', '销售订单']), 128),
      processingMaterial: toText(valueFromRow(row, ['Materiales de Procesamiento', '加工物料'])),
      quantity: normalizeNumber(valueFromRow(row, ['Cantidad', '数量'])) ?? undefined,
      unitPrice: normalizeNumber(valueFromRow(row, ['Precio Unitario', '单价'])) ?? undefined,
      totalAmount: normalizeNumber(valueFromRow(row, ['Monto Total', '总金额'])) ?? undefined,
      specificationRequirementDescription: toText(valueFromRow(row, ['Descripcion', 'Descripción', '需求说明'])),
      deliveryDate: toDate(valueFromRow(row, ['Fecha de entrega', '交付日期'])),
      rawData: row,
    })),
  };
}

export function normalizePurchaseMultiSelect(value: unknown): string | undefined {
  const parsed = parseJson(value);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const unique = new Set<string>();
  for (const item of values) {
    const text = toText(item);
    if (text) unique.add(text);
  }
  return unique.size ? [...unique].join('、') : undefined;
}
