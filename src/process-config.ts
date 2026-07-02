export type ProcessKind = 'operation' | 'purchase' | 'other';

export interface ProcessTypeMap {
  operation?: string[];
  purchase?: string[];
}

interface ProcessConfigShape {
  processCodes?: string[];
  processTypeMap?: ProcessTypeMap | null | undefined;
}

const KNOWN_PROCESS_KINDS: Array<Exclude<ProcessKind, 'other'>> = ['operation', 'purchase'];

function uniqueCodes(codes: string[]): string[] {
  return [...new Set(codes)];
}

function normalizeCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueCodes(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );
}

export function normalizeProcessTypeMap(value: unknown): Required<ProcessTypeMap> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return {
    operation: normalizeCodeList(raw.operation),
    purchase: normalizeCodeList(raw.purchase),
  };
}

export function buildLegacyProcessTypeMap(processCodes: string[] | undefined): Required<ProcessTypeMap> {
  const normalizedCodes = normalizeCodeList(processCodes);

  return {
    operation: normalizedCodes[0] ? [normalizedCodes[0]] : [],
    purchase: normalizedCodes[1] ? [normalizedCodes[1]] : [],
  };
}

export function resolveProcessTypeMap(config: ProcessConfigShape): Required<ProcessTypeMap> {
  const legacyMap = buildLegacyProcessTypeMap(config.processCodes);
  const explicitMap = normalizeProcessTypeMap(config.processTypeMap);
  const hasExplicitMapping = KNOWN_PROCESS_KINDS.some((kind) => explicitMap[kind].length > 0);

  if (!hasExplicitMapping) {
    return legacyMap;
  }

  return {
    operation: uniqueCodes([...legacyMap.operation, ...explicitMap.operation]),
    purchase: uniqueCodes([...legacyMap.purchase, ...explicitMap.purchase]),
  };
}

export function getConfiguredProcessCodes(config: ProcessConfigShape): string[] {
  const resolvedMap = resolveProcessTypeMap(config);
  const legacyCodes = normalizeCodeList(config.processCodes);

  return uniqueCodes([
    ...resolvedMap.operation,
    ...resolvedMap.purchase,
    ...legacyCodes,
  ]);
}

export function getProcessKind(processCode: string | null | undefined, config: ProcessConfigShape): ProcessKind {
  const value = String(processCode || '').trim();
  if (!value) {
    return 'other';
  }

  const explicitMap = normalizeProcessTypeMap(config.processTypeMap);
  const hasExplicitMapping = KNOWN_PROCESS_KINDS.some((kind) => explicitMap[kind].length > 0);

  if (explicitMap.operation.includes(value)) {
    return 'operation';
  }
  if (explicitMap.purchase.includes(value)) {
    return 'purchase';
  }

  if (hasExplicitMapping) {
    const legacyMap = buildLegacyProcessTypeMap(config.processCodes);
    if (legacyMap.operation.includes(value)) {
      return 'operation';
    }
    if (legacyMap.purchase.includes(value)) {
      return 'purchase';
    }
    return 'other';
  }

  const resolvedMap = resolveProcessTypeMap(config);
  if (resolvedMap.operation.includes(value)) {
    return 'operation';
  }
  if (resolvedMap.purchase.includes(value)) {
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
