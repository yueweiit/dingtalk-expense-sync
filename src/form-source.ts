export const OLD_OPERATION_FORM_CODE = 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA';
export const NEW_ECOMMERCE_OPERATION_FORM_CODE = 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD';
export const OLD_PURCHASE_FORM_CODE = 'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B';
export const NEW_ECOMMERCE_PURCHASE_FORM_CODE = 'PROC-6E11B527-2F82-439C-817D-C868DE086C97';
export const YW_INTELLIGENT_OPERATION_FORM_CODE = 'PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8';
export const YW_INTELLIGENT_PURCHASE_FORM_CODE = 'PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF';

const YW_INTELLIGENT_DEPARTMENT = '悦为智能 YW Tech_Ai';

export function getStandaloneOperationProcessCodes(kind: 'legacy' | 'ecommerce'): string[] {
  if (kind === 'legacy') return [OLD_OPERATION_FORM_CODE];
  return [NEW_ECOMMERCE_OPERATION_FORM_CODE];
}

export function resolveOperationFormName(processCode: string | null | undefined): string | null {
  const value = String(processCode || '').trim();
  if (!value) return null;
  if (value === OLD_OPERATION_FORM_CODE) return '运营支出';
  if (value === NEW_ECOMMERCE_OPERATION_FORM_CODE) return '电商运营支出';
  if (value === YW_INTELLIGENT_OPERATION_FORM_CODE) return '悦为智能运营支出';
  return null;
}

export function resolvePurchaseFormName(processCode: string | null | undefined): string | null {
  const value = String(processCode || '').trim();
  if (!value) return null;
  if (value === OLD_PURCHASE_FORM_CODE) return '采购支出';
  if (value === NEW_ECOMMERCE_PURCHASE_FORM_CODE) return '电商采购支出';
  if (value === YW_INTELLIGENT_PURCHASE_FORM_CODE) return '悦为智能采购支出';
  return null;
}

export function resolveFixedApplicantDepartment(processCode: string | null | undefined): string | null {
  const value = String(processCode || '').trim();
  if (value === YW_INTELLIGENT_OPERATION_FORM_CODE || value === YW_INTELLIGENT_PURCHASE_FORM_CODE) {
    return YW_INTELLIGENT_DEPARTMENT;
  }
  return null;
}
