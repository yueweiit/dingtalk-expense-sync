export const OLD_OPERATION_FORM_CODE = 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA';
export const NEW_ECOMMERCE_OPERATION_FORM_CODE = 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD';
export const OLD_PURCHASE_FORM_CODE = 'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B';
export const NEW_ECOMMERCE_PURCHASE_FORM_CODE = 'PROC-6E11B527-2F82-439C-817D-C868DE086C97';

export function getStandaloneOperationProcessCodes(kind: 'legacy' | 'ecommerce'): string[] {
  if (kind === 'legacy') return [OLD_OPERATION_FORM_CODE];
  return [NEW_ECOMMERCE_OPERATION_FORM_CODE];
}

export function resolveOperationFormName(processCode: string | null | undefined): string | null {
  const value = String(processCode || '').trim();
  if (!value) return null;
  if (value === OLD_OPERATION_FORM_CODE) return '运营支出';
  if (value === NEW_ECOMMERCE_OPERATION_FORM_CODE) return '电商运营支出';
  return null;
}

export function resolvePurchaseFormName(processCode: string | null | undefined): string | null {
  const value = String(processCode || '').trim();
  if (!value) return null;
  if (value === OLD_PURCHASE_FORM_CODE) return '采购支出';
  if (value === NEW_ECOMMERCE_PURCHASE_FORM_CODE) return '电商采购支出';
  return null;
}
