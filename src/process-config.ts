import {
  NEW_ECOMMERCE_OPERATION_FORM_CODE,
  NEW_ECOMMERCE_PURCHASE_FORM_CODE,
  LINGXIANG_XINGMING_OPERATION_FORM_CODE,
  LINGXIANG_XINGMING_PURCHASE_FORM_CODE,
  LEMOS_OPERATION_FORM_CODE,
  LEMOS_PURCHASE_FORM_CODE,
  MOLD_PRINT_OPERATION_FORM_CODE,
  MOLD_PRINT_PURCHASE_FORM_CODE,
  OLD_OPERATION_FORM_CODE,
  OLD_PURCHASE_FORM_CODE,
  YW_INTELLIGENT_OPERATION_FORM_CODE,
  YW_INTELLIGENT_PURCHASE_FORM_CODE,
  YUEWEI_MX_OPERATION_FORM_CODE,
  YUEWEI_MX_PURCHASE_FORM_CODE,
  MONTHLY_SETTLEMENT_PAYMENT_FORM_CODE,
} from './form-source.ts';

export type ProcessKind = 'operation' | 'purchase' | 'monthly_settlement' | 'other';

export interface ProcessTypeMap {
  operation?: string[];
  purchase?: string[];
  monthly_settlement?: string[];
}

interface ProcessConfigShape {
  processTypeMap?: ProcessTypeMap | null | undefined;
}

const KNOWN_PROCESS_KINDS: Array<Exclude<ProcessKind, 'other'>> = ['operation', 'purchase', 'monthly_settlement'];
const PROCESS_CODE_PATTERN = /^PROC-[A-F0-9-]+$/i;

const REQUIRED_PROCESS_CODES: Required<ProcessTypeMap> = {
  operation: [
    OLD_OPERATION_FORM_CODE,
    NEW_ECOMMERCE_OPERATION_FORM_CODE,
    YW_INTELLIGENT_OPERATION_FORM_CODE,
    LINGXIANG_XINGMING_OPERATION_FORM_CODE,
    LEMOS_OPERATION_FORM_CODE,
    MOLD_PRINT_OPERATION_FORM_CODE,
    YUEWEI_MX_OPERATION_FORM_CODE,
  ],
  purchase: [
    OLD_PURCHASE_FORM_CODE,
    NEW_ECOMMERCE_PURCHASE_FORM_CODE,
    YW_INTELLIGENT_PURCHASE_FORM_CODE,
    LINGXIANG_XINGMING_PURCHASE_FORM_CODE,
    LEMOS_PURCHASE_FORM_CODE,
    MOLD_PRINT_PURCHASE_FORM_CODE,
    YUEWEI_MX_PURCHASE_FORM_CODE,
  ],
  monthly_settlement: [MONTHLY_SETTLEMENT_PAYMENT_FORM_CODE],
};

function normalizeCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function uniqueCodes(codes: string[]): string[] {
  return [...new Set(codes)];
}

export function normalizeProcessTypeMap(value: unknown): Required<ProcessTypeMap> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    operation: uniqueCodes(normalizeCodeList(raw.operation)),
    purchase: uniqueCodes(normalizeCodeList(raw.purchase)),
    monthly_settlement: uniqueCodes(normalizeCodeList(raw.monthly_settlement ?? raw.monthlySettlement)),
  };
}

export function validateProcessTypeMap(value: unknown): Required<ProcessTypeMap> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const errors: string[] = [];

  if (!raw) {
    throw new Error('DINGTALK_PROCESS_TYPE_MAP 必须是包含 operation、purchase 和 monthly_settlement 的 JSON 对象');
  }

  const rawCodesByKind = {
    operation: normalizeCodeList(raw.operation),
    purchase: normalizeCodeList(raw.purchase),
    monthly_settlement: normalizeCodeList(raw.monthly_settlement ?? raw.monthlySettlement),
  };

  for (const kind of KNOWN_PROCESS_KINDS) {
    const codes = rawCodesByKind[kind];
    const rawValue = kind === 'monthly_settlement'
      ? raw.monthly_settlement ?? raw.monthlySettlement
      : raw[kind];
    if (!Array.isArray(rawValue)) {
      errors.push(`${kind} 必须是流程码数组`);
      continue;
    }
    if (codes.length !== uniqueCodes(codes).length) {
      errors.push(`${kind} 包含重复流程码`);
    }
    for (const code of codes) {
      if (!PROCESS_CODE_PATTERN.test(code)) {
        errors.push(`${kind} 包含非法流程码 ${code}`);
      }
    }
  }

  const normalized = normalizeProcessTypeMap(raw);
  const kindsByCode = new Map<string, Array<Exclude<ProcessKind, 'other'>>>();
  for (const kind of KNOWN_PROCESS_KINDS) {
    for (const code of normalized[kind]) {
      const kinds = kindsByCode.get(code) || [];
      kinds.push(kind);
      kindsByCode.set(code, kinds);
    }
  }
  for (const [code, kinds] of kindsByCode) {
    if (kinds.length > 1) {
      errors.push(`流程码不能同时属于多个分类: ${code} (${kinds.join(', ')})`);
    }
  }

  for (const kind of KNOWN_PROCESS_KINDS) {
    for (const code of REQUIRED_PROCESS_CODES[kind]) {
      if (normalized[kind].includes(code)) continue;
      const otherKind = KNOWN_PROCESS_KINDS.find((candidate) => candidate !== kind && normalized[candidate].includes(code));
      if (otherKind) {
        errors.push(`${code} 必须属于 ${kind}，不能归入 ${otherKind}`);
      } else {
        errors.push(`缺少 ${kind} 流程码 ${code}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`DINGTALK_PROCESS_TYPE_MAP 配置无效: ${errors.join('；')}`);
  }

  return normalized;
}

export function getConfiguredProcessCodes(config: ProcessConfigShape): string[] {
  const processTypeMap = validateProcessTypeMap(config.processTypeMap);
  return [
    ...processTypeMap.operation,
    ...processTypeMap.purchase,
    ...processTypeMap.monthly_settlement,
  ];
}

export function getProcessKind(processCode: string | null | undefined, config: ProcessConfigShape): ProcessKind {
  const value = String(processCode || '').trim();
  if (!value) {
    return 'other';
  }

  const processTypeMap = normalizeProcessTypeMap(config.processTypeMap);
  if (processTypeMap.operation.includes(value)) {
    return 'operation';
  }
  if (processTypeMap.purchase.includes(value)) {
    return 'purchase';
  }
  if (processTypeMap.monthly_settlement.includes(value)) {
    return 'monthly_settlement';
  }
  return 'other';
}

export function getProcessTypeLabelByKind(kind: ProcessKind): string {
  if (kind === 'operation') return '运营支出';
  if (kind === 'purchase') return '采购支出';
  if (kind === 'monthly_settlement') return '月结付款';
  return '其他';
}

export function getProcessTypeLabel(processCode: string | null | undefined, config: ProcessConfigShape): string {
  return getProcessTypeLabelByKind(getProcessKind(processCode, config));
}
