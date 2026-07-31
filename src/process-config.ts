import {
  NEW_ECOMMERCE_OPERATION_FORM_CODE,
  NEW_ECOMMERCE_PURCHASE_FORM_CODE,
  LINGXIANG_GUANGZHOU_OPERATION_FORM_CODE,
  LINGXIANG_GUANGZHOU_PURCHASE_FORM_CODE,
  LEMOS_OPERATION_FORM_CODE,
  LEMOS_PURCHASE_FORM_CODE,
  MOLD_PRINT_OPERATION_FORM_CODE,
  MOLD_PRINT_PURCHASE_FORM_CODE,
  OLD_OPERATION_FORM_CODE,
  OLD_PURCHASE_FORM_CODE,
  XINGMING_DONGGUAN_OPERATION_FORM_CODE,
  XINGMING_DONGGUAN_PURCHASE_FORM_CODE,
  YW_INTELLIGENT_OPERATION_FORM_CODE,
  YW_INTELLIGENT_PURCHASE_FORM_CODE,
  YUEWEI_MX_OPERATION_FORM_CODE,
  YUEWEI_MX_PURCHASE_FORM_CODE,
} from './form-source.ts';

export type ProcessKind = 'operation' | 'purchase' | 'other';

export interface ProcessTypeMap {
  operation?: string[];
  purchase?: string[];
}

interface ProcessConfigShape {
  processTypeMap?: ProcessTypeMap | null | undefined;
}

const KNOWN_PROCESS_KINDS: Array<Exclude<ProcessKind, 'other'>> = ['operation', 'purchase'];
const PROCESS_CODE_PATTERN = /^PROC-[A-F0-9-]+$/i;

const REQUIRED_PROCESS_CODES: Required<ProcessTypeMap> = {
  operation: [
    OLD_OPERATION_FORM_CODE,
    NEW_ECOMMERCE_OPERATION_FORM_CODE,
    YW_INTELLIGENT_OPERATION_FORM_CODE,
    XINGMING_DONGGUAN_OPERATION_FORM_CODE,
    LINGXIANG_GUANGZHOU_OPERATION_FORM_CODE,
    LEMOS_OPERATION_FORM_CODE,
    MOLD_PRINT_OPERATION_FORM_CODE,
    YUEWEI_MX_OPERATION_FORM_CODE,
  ],
  purchase: [
    OLD_PURCHASE_FORM_CODE,
    NEW_ECOMMERCE_PURCHASE_FORM_CODE,
    YW_INTELLIGENT_PURCHASE_FORM_CODE,
    XINGMING_DONGGUAN_PURCHASE_FORM_CODE,
    LINGXIANG_GUANGZHOU_PURCHASE_FORM_CODE,
    LEMOS_PURCHASE_FORM_CODE,
    MOLD_PRINT_PURCHASE_FORM_CODE,
    YUEWEI_MX_PURCHASE_FORM_CODE,
  ],
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
  };
}

export function validateProcessTypeMap(value: unknown): Required<ProcessTypeMap> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const errors: string[] = [];

  if (!raw) {
    throw new Error('DINGTALK_PROCESS_TYPE_MAP 必须是包含 operation 和 purchase 的 JSON 对象');
  }

  const rawCodesByKind = {
    operation: normalizeCodeList(raw.operation),
    purchase: normalizeCodeList(raw.purchase),
  };

  for (const kind of KNOWN_PROCESS_KINDS) {
    const codes = rawCodesByKind[kind];
    if (!Array.isArray(raw[kind])) {
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
  const duplicatedAcrossKinds = normalized.operation.filter((code) => normalized.purchase.includes(code));
  if (duplicatedAcrossKinds.length > 0) {
    errors.push(`流程码不能同时属于 operation 和 purchase: ${duplicatedAcrossKinds.join(', ')}`);
  }

  for (const kind of KNOWN_PROCESS_KINDS) {
    const otherKind = kind === 'operation' ? 'purchase' : 'operation';
    for (const code of REQUIRED_PROCESS_CODES[kind]) {
      if (normalized[kind].includes(code)) continue;
      if (normalized[otherKind].includes(code)) {
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
  return 'other';
}

export function getProcessTypeLabelByKind(kind: ProcessKind): string {
  if (kind === 'operation') return '运营支出';
  if (kind === 'purchase') return '采购支出';
  return '其他';
}

export function getProcessTypeLabel(processCode: string | null | undefined, config: ProcessConfigShape): string {
  return getProcessTypeLabelByKind(getProcessKind(processCode, config));
}
