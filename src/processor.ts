import database from './database.ts';
import logger from './logger.ts';
import { convertAmountToCny } from './fxToCny.ts';
import { resolveFixedApplicantDepartment, resolveOperationFormName, resolvePurchaseFormName } from './form-source.ts';
import { collectOperationDeptSplits } from './operation-dept-splits.ts';
import approvalSource from './oa-source.ts';
import { normalizePurchaseMultiSelect, parsePurchaseDetails } from './purchase-details.ts';
import { normalizeNumber as normalizeNumberShared } from './utils.ts';
import type { PurchaseItemData, PurchaseProcessorData } from './database/types.ts';

export interface FormComponentValue {
  name?: string;
  value?: unknown;
  componentType?: string;
  id?: string;
  extendValue?: unknown;
  extValue?: unknown;
  details?: FormComponentValue[][];
}

export interface Task {
  taskId?: string;
  userId?: string;
  activityId?: string;
  activityName?: string;
  name?: string;
  status?: string;
  result?: string;
  finishTime?: string | number;
  createTime?: string | number;
  startTime?: string | number;
  userName?: string;
}

export interface ApprovalInstance {
  businessId: string;
  processInstanceId?: string | number;
  title?: string;
  processCode?: string;
  processType?: string;
  status?: string;
  originatorUserId?: string;
  originatorDeptId?: string;
  originatorDeptName?: string;
  bizAction?: string;
  createTime?: string;
  endTime?: string;
  finishTime?: string;
  approvalNo?: string;
  approval_no?: string;
  originatorUserName?: string;
  originator_user_name?: string;
  updateTime?: string;
  modifyTime?: string;
  tasks?: Task[];
  formComponentValues?: FormComponentValue[];
}

export interface ApplicantDepartmentIdentity {
  department: string | null;
  departmentId: string | null;
  departmentSource: 'form_id' | 'originator_id' | 'name_only';
}

function extractDepartmentId(extendedValue: unknown): string | null {
  let normalizedValue = extendedValue;
  if (typeof extendedValue === 'string') {
    try {
      normalizedValue = JSON.parse(extendedValue);
    } catch {
      normalizedValue = extendedValue;
    }
  }

  const candidates = Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const id = record.id ?? record.itemId ?? record.deptId ?? record.dept_id;
    const normalized = String(id || '').trim();
    if (normalized) return normalized;
  }
  return null;
}

export function parseApplicantDepartmentIdentity(
  formComponentValues?: FormComponentValue[],
  instance?: Pick<ApprovalInstance, 'originatorDeptId' | 'originatorDeptName'>
): ApplicantDepartmentIdentity {
  const departmentField = Array.isArray(formComponentValues)
    ? formComponentValues.find((item) => String(item?.componentType || '').toLowerCase() === 'departmentfield')
    : null;
  const formDepartment = String(departmentField?.value || '').trim() || null;
  const originatorDepartment = String(instance?.originatorDeptName || '').trim() || null;
  const formDepartmentId = extractDepartmentId(departmentField?.extendValue ?? departmentField?.extValue);
  const originatorDepartmentId = String(instance?.originatorDeptId || '').trim() || null;

  if (formDepartmentId) {
    return {
      department: formDepartment || originatorDepartment,
      departmentId: formDepartmentId,
      departmentSource: 'form_id',
    };
  }

  if (originatorDepartmentId) {
    return {
      department: formDepartment || originatorDepartment,
      departmentId: originatorDepartmentId,
      departmentSource: 'originator_id',
    };
  }

  return {
    department: formDepartment || originatorDepartment,
    departmentId: null,
    departmentSource: 'name_only',
  };
}

interface ParsedFormData {
  department: unknown;
  applyType: unknown;
  expenseType: unknown;
  region: unknown;
  operationExpenseType: unknown;
  description: unknown;
  beneficiary: unknown;
  amount: unknown;
  paymentTerms: unknown;
  currency: unknown;
  paymentDate: unknown;
  applyDate: unknown;
  productionType: unknown;
  monthlyBudget: unknown;
  monthlyBudgetUsed: unknown;
}

interface ApprovalMeta {
  approvalCompletedAt: string | null;
  approvalStatus: string | null;
  currentNode: string | null;
  currentOwner: string | null;
  historicalApprovers: string | null;
  approvalNo: string | null;
  creatorName: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  creatorDepartment: string | null;
}

interface Attachment {
  attachmentType: string;
  fileName: string;
  fileUrl: string;
  rawData: Record<string, unknown> | unknown;
}

interface ProcessResult {
  skipped?: boolean;
  reason?: string;
  success?: boolean;
  businessId?: string;
  failed?: boolean;
  error?: string;
}

interface BatchProcessResult {
  success: number;
  skipped: number;
  failed: number;
  details: ProcessResult[];
}

interface DeptSplitTypeConfig {
  label: string;
  labelEs?: string;
  tableFieldId: string;
  moneyFieldId: string;
  textFieldId: string | null;
  dbColumn: string;
}

type DepartmentSnapshotLookup = Pick<typeof approvalSource, 'getDepartmentSnapshots'>;

const DEPT_SPLIT_TYPES: DeptSplitTypeConfig[] = [
  {
    label: '工资中国',
    labelEs: 'Salario en China',
    tableFieldId: 'TableField_13B0RI3JBQXS0',
    moneyFieldId: 'MoneyField_T2TFVV7BXN40',
    textFieldId: 'TextField_SZ57CIDK9J40',
    dbColumn: 'salaryByDepartment',
  },
  {
    label: '社保公积金',
    tableFieldId: 'TableField_G2ELEALN0S80',
    moneyFieldId: 'MoneyField_X5KBWAODJ1S0',
    textFieldId: null,
    dbColumn: 'socialInsuranceByDepartment',
  },
  {
    label: '办公场地总费用',
    tableFieldId: 'TableField_9KUR3Y1BQYW0',
    moneyFieldId: 'MoneyField_O4L4S81Y0MO0',
    textFieldId: null,
    dbColumn: 'officeSpaceByDepartment',
  },
];

export class ApprovalProcessor {
  constructor(private readonly departmentSnapshotLookup: DepartmentSnapshotLookup = approvalSource) {}

  // 从表单值中提取字段（第一个匹配）
  extractFormValue(formComponentValues: FormComponentValue[] | undefined | null, fieldName: string): unknown {
    if (!formComponentValues || !Array.isArray(formComponentValues)) {
      return null;
    }
    const field = formComponentValues.find((item) => item.name && item.name.includes(fieldName));
    return field ? field.value : null;
  }

  extractFormValueExact(formComponentValues: FormComponentValue[] | undefined | null, fieldName: string): unknown {
    if (!formComponentValues || !Array.isArray(formComponentValues)) {
      return null;
    }
    const field = formComponentValues.find((item) => String(item?.name || '').trim() === fieldName);
    return field ? field.value : null;
  }

  /**
   * 采购等模板里常有多组同名控件（如明细里重复的「金额importe」「币种Moneda」），
   * 只取第一个会命中空行，导致 amount/currency 入库为 NULL。从后往前取最后一个非空值。
   */
  extractFormValueLastNonEmpty(formComponentValues: FormComponentValue[] | undefined | null, fieldName: string): unknown {
    if (!formComponentValues || !Array.isArray(formComponentValues)) {
      return null;
    }
    for (let i = formComponentValues.length - 1; i >= 0; i--) {
      const item = formComponentValues[i];
      if (!item || !item.name || !item.name.includes(fieldName)) {
        continue;
      }
      const v = item.value;
      if (v == null) {
        continue;
      }
      const s = String(v).trim();
      if (s) {
        return v;
      }
    }
    return null;
  }

  /**
   * 提取TableField表格数据
   * @param fc 表单组件值数组
   * @param tableFieldId TableField的ID
   * @returns 解析后的表格数据数组，或null
   */
  extractTableFieldData(
    fc: FormComponentValue[] | undefined | null,
    tableFieldId: string,
    moneyFieldId: string = 'MoneyField_T2TFVV7BXN40',
    textFieldId: string | null = 'TextField_SZ57CIDK9J40',
    tableFieldName: string | null = null
  ): Array<{
    department: string;
    departmentId: string | null;
    departmentSource: 'id' | 'name_only';
    amount: number;
    note: string;
  }> | null {
    if (!fc || !Array.isArray(fc)) {
      return null;
    }

    // 查找TableField
    const tableField = fc.find(
      (item) => item.componentType === 'TableField' && (
        item.id === tableFieldId ||
        (tableFieldName && String(item.name || '').includes(tableFieldName))
      )
    );

    if (!tableField) {
      return null;
    }

    // 解析每一行数据
    const rows: Array<{
      department: string;
      departmentId: string | null;
      departmentSource: 'id' | 'name_only';
      amount: number;
      note: string;
    }> = [];

    // 优先使用 details 字段（新版钉钉 API 格式）
    if (tableField.details && Array.isArray(tableField.details)) {
      for (const row of tableField.details) {
        if (!Array.isArray(row)) continue;

        let department = '';
        let departmentId: string | null = null;
        let amount = 0;
        let note = '';

        for (const cell of row) {
          const cellId = String(cell.id || '');
          if (cellId.startsWith('DepartmentField_')) {
            department = String(cell.value || '').trim();
            departmentId = extractDepartmentId(cell.extendValue ?? cell.extValue);
          } else if (cellId === moneyFieldId || (!moneyFieldId && cellId.startsWith('MoneyField_'))) {
            amount = this.normalizeNumber(cell.value) || 0;
          } else if ((textFieldId && cellId === textFieldId) || (!textFieldId && cellId.startsWith('TextField_'))) {
            note = String(cell.value || '').trim();
          }
        }

        // 只添加有部门和金额的有效行
        if (department && amount > 0) {
          rows.push({
            department,
            departmentId,
            departmentSource: departmentId ? 'id' : 'name_only',
            amount,
            note,
          });
        }
      }
    }
    // 如果 details 不存在，尝试解析 value 字段（旧版钉钉 API 格式）
    else if (tableField.value && typeof tableField.value === 'string') {
      try {
        const parsed = JSON.parse(tableField.value);
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            if (!row || !Array.isArray(row.rowValue)) continue;

            let department = '';
            let departmentId: string | null = null;
            let amount = 0;
            let note = '';

            for (const cell of row.rowValue) {
              const cellKey = String(cell.key || '');
              if (cellKey.startsWith('DepartmentField_')) {
                department = String(cell.value || '').trim();
                departmentId = extractDepartmentId(cell.extendValue ?? cell.extValue);
              } else if (cellKey === moneyFieldId || (!moneyFieldId && cellKey.startsWith('MoneyField_'))) {
                amount = this.normalizeNumber(cell.value) || 0;
              } else if ((textFieldId && cellKey === textFieldId) || (!textFieldId && cellKey.startsWith('TextField_'))) {
                note = String(cell.value || '').trim();
              }
            }

            // 只添加有部门和金额的有效行
            if (department && amount > 0) {
              rows.push({
                department,
                departmentId,
                departmentSource: departmentId ? 'id' : 'name_only',
                amount,
                note,
              });
            }
          }
        }
      } catch (e) {
        // JSON 解析失败，返回 null
        logger.warn(`Failed to parse TableField value: ${e}`);
        return null;
      }
    }

    return rows.length > 0 ? rows : null;
  }

  async enrichOperationDepartmentPaths(data: Record<string, unknown>): Promise<void> {
    const splitFields = [
      'salaryByDepartment',
      'socialInsuranceByDepartment',
      'officeSpaceByDepartment',
      'individualIncomeTaxByDepartment',
    ];
    const rows = splitFields.flatMap((field) => {
      const value = data[field];
      return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : [];
    });
    const applicantDepartmentId = String(data.applicantDepartmentId || '').trim();
    const departmentIds = [...new Set([
      ...rows.map((row) => String(row.departmentId || '').trim()),
      applicantDepartmentId,
    ]
      .filter(Boolean))];
    if (!departmentIds.length) return;

    try {
      const snapshots = await this.departmentSnapshotLookup.getDepartmentSnapshots(departmentIds);
      for (const row of rows) {
        const departmentId = String(row.departmentId || '').trim();
        const snapshot = snapshots.get(departmentId);
        if (!snapshot) continue;
        row.departmentPathIds = snapshot.departmentPathIds;
        row.departmentPathNames = snapshot.departmentPathNames;
      }
      if (applicantDepartmentId) {
        const snapshot = snapshots.get(applicantDepartmentId);
        if (snapshot) {
          data.applicantDepartmentPathIds = snapshot.departmentPathIds;
          data.applicantDepartmentPathNames = snapshot.departmentPathNames;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Department path lookup failed; syncing without path snapshots: ${message}`);
    }
  }

  normalizeNumber(value: unknown): number | null {
    return normalizeNumberShared(value);
  }

  // 解析表单数据
  parseFormData(formComponentValues?: FormComponentValue[]): ParsedFormData {
    const amountFromDetail = this.extractFormValueLastNonEmpty(formComponentValues, '金额importe');
    const currencyFromDetail = this.extractFormValueLastNonEmpty(formComponentValues, '币种Moneda');
    const amountFromSummary = this.extractFormValue(formComponentValues, '明细汇总金额');
    const departmentField = Array.isArray(formComponentValues)
      ? formComponentValues.find((item) => String(item?.componentType || '').toLowerCase() === 'departmentfield')
      : null;
    const departmentFromComponent =
      departmentField?.value != null && String(departmentField.value).trim() !== '' ? departmentField.value : null;
    return {
      department: departmentFromComponent ?? this.extractFormValue(formComponentValues, '部门Departamento'),
      applyType: this.extractFormValue(formComponentValues, '申请类型Tipo de trámite'),
      expenseType: this.extractFormValue(formComponentValues, '支出类型'),
      region: this.extractFormValue(formComponentValues, '执行地区Región de ejecución'),
      operationExpenseType: this.extractFormValue(formComponentValues, '管理支出Gastos de operación'),
      description: this.extractFormValue(formComponentValues, '事项说明Explicación de asuntos'),
      beneficiary: this.extractFormValue(formComponentValues, '收款人beneficiario'),
      amount: amountFromDetail ?? amountFromSummary,
      paymentTerms: this.extractFormValue(formComponentValues, '付款条件Términos de pago'),
      currency: currencyFromDetail,
      paymentDate: this.extractFormValue(formComponentValues, '付款日期Fecha de pago'),
      applyDate: this.extractFormValue(formComponentValues, '申请日期'),
      productionType: this.extractFormValue(formComponentValues, '生产/非生产'),
      monthlyBudget: this.extractFormValue(formComponentValues, '本月预算金额'),
      monthlyBudgetUsed: this.extractFormValue(formComponentValues, '本月预算已用金额')
    };
  }

  // 从 tasks 中提取审批元数据
  parseApprovalMeta(instance: ApprovalInstance): ApprovalMeta {
    const tasks = Array.isArray(instance.tasks) ? instance.tasks : [];
    const userTasks = tasks.filter((t) => t && t.userId && t.userId !== 'bpms_system');
    const running = tasks.filter((t) => String(t?.status || '').toUpperCase() === 'RUNNING');

    const taskTime = (t: Task): number => {
      const v = t.finishTime || t.createTime || t.startTime;
      if (v == null) return 0;
      const n = typeof v === 'number' ? v : Date.parse(String(v));
      return Number.isFinite(n) ? n : 0;
    };

    const historical = userTasks
      .sort((a, b) => taskTime(a) - taskTime(b))
      .map((t) => (t.userName || t.userId || '').trim())
      .filter(Boolean);

    const currentNode = running.map((t) => (t.activityName || t.name || '').trim()).filter(Boolean).join(', ') || null;
    const currentOwner = running.map((t) => (t.userName || t.userId || '').trim()).filter(Boolean).join(', ') || null;

    return {
      approvalCompletedAt: instance.status === 'COMPLETED' ? (instance.endTime || instance.finishTime || null) : null,
      approvalStatus: instance.status || null,
      currentNode,
      currentOwner,
      historicalApprovers: historical.join(', ') || null,
      approvalNo: instance.approvalNo || instance.approval_no || instance.businessId || null,
      creatorName: instance.originatorUserName || instance.originator_user_name || instance.originatorUserId || null,
      sourceCreatedAt: instance.createTime || null,
      sourceUpdatedAt: instance.updateTime || instance.modifyTime || null,
      creatorDepartment: instance.originatorDeptName || null
    };
  }

  // 从表单中提取附件/凭证
  extractAttachments(formComponentValues?: FormComponentValue[]): Attachment[] {
    if (!formComponentValues || !Array.isArray(formComponentValues)) {
      return [];
    }
    const attachments: Attachment[] = [];
    for (const item of formComponentValues) {
      const name = item?.name || '';
      if (!name.includes('关键凭证') && !name.includes('Comprobante') && !name.includes('附件') && !name.includes('Adjunto')) {
        continue;
      }
      let value = item.value;
      if (!value) continue;

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            value = JSON.parse(trimmed);
          } catch {}
        }
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && (trimmed.startsWith('http') || trimmed.startsWith('/'))) {
          attachments.push({
            attachmentType: '关键凭证',
            fileName: trimmed.split('/').pop() || trimmed,
            fileUrl: trimmed,
            rawData: item
          });
        }
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === 'string' && v.trim()) {
            attachments.push({
              attachmentType: '关键凭证',
              fileName: v.trim().split('/').pop() || v.trim(),
              fileUrl: v.trim(),
              rawData: v
            });
          } else if (v && typeof v === 'object') {
            const url = (v as Record<string, unknown>).url || (v as Record<string, unknown>).fileUrl || (v as Record<string, unknown>).downloadUrl || '';
            const file = v as Record<string, unknown>;
            const fileName = file.fileName || file.name || (url ? String(url).split('/').pop() : '') || '';
            if (url || fileName || file.fileId) {
              attachments.push({
                attachmentType: String(file.type || file.fileType || '关键凭证'),
                fileName: String(fileName),
                fileUrl: String(url),
                rawData: v
              });
            }
          }
        }
      } else if (typeof value === 'object') {
        const url = (value as Record<string, unknown>).url || (value as Record<string, unknown>).fileUrl || (value as Record<string, unknown>).downloadUrl || '';
        const file = value as Record<string, unknown>;
        const fileName = file.fileName || file.name || (url ? String(url).split('/').pop() : '') || '';
        if (url || fileName || file.fileId) {
          attachments.push({
            attachmentType: String(file.type || file.fileType || '关键凭证'),
            fileName: String(fileName),
            fileUrl: String(url),
            rawData: value
          });
        }
      }
    }
    return attachments;
  }

  // 解析运营支出全部字段（写入 approval_expense_operation）
  parseOperationExpenseData(
    formComponentValues?: FormComponentValue[],
    instance?: Pick<ApprovalInstance, 'originatorDeptId' | 'originatorDeptName'>
  ): Record<string, unknown> {
    const fc = formComponentValues;
    const applicantDepartmentIdentity = parseApplicantDepartmentIdentity(fc, instance);
    const department = applicantDepartmentIdentity.department ||
      this.extractFormValue(fc, '申请部门Departamento Solicitante') || this.extractFormValue(fc, '部门Departamento');

    const operationExpense = this.extractFormValue(fc, '管理支出Gastos de operación') || this.extractFormValue(fc, '管理支出');
    const opExpenseStr = String(operationExpense || '');
    const deptSplitResults: Record<string, Array<{
      department: string;
      departmentId: string | null;
      departmentSource: 'id' | 'name_only';
      amount: number;
      note: string;
    }> | null> = {};
    for (const cfg of DEPT_SPLIT_TYPES) {
      const matches = opExpenseStr.includes(cfg.label) || (cfg.labelEs ? opExpenseStr.includes(cfg.labelEs) : false);
      if (matches && cfg.tableFieldId) {
        deptSplitResults[cfg.dbColumn] = this.extractTableFieldData(
          fc, cfg.tableFieldId, cfg.moneyFieldId, cfg.textFieldId
        );
      }
    }

    const taxExpense = this.extractFormValue(fc, '税费Impuestos') || this.extractFormValue(fc, '税费');
    const isIndividualIncomeTax = /个税|个人所得税|impuesto.*renta|income.*tax/i.test(String(taxExpense || ''));
    const individualIncomeTaxByDepartment = isIndividualIncomeTax
      ? this.extractTableFieldData(fc, '', '', null, '薪酬税费总支出')
      : null;

    const monthlyBudgetRemainingAmount = this.normalizeNumber(
      this.extractFormValueExact(fc, '本月预算剩余金额')
      || this.extractFormValueExact(fc, '本月预算剩余金额Saldo restante del presupuesto mensual')
    );
    const paymentDetailReason = this.extractFormValueExact(fc, '付款详细事由');

    return {
      requestDate: this.extractFormValue(fc, '申请日期Fecha de solicitud') || this.extractFormValue(fc, '申请日期'),
      applicantDepartment: department,
      applicantDepartmentId: applicantDepartmentIdentity.departmentId,
      applicantDepartmentSource: applicantDepartmentIdentity.departmentSource,
      productionType: this.extractFormValue(fc, '生产/非生产Producción') || this.extractFormValue(fc, '生产/非生产'),
      monthlyBudgetAmount: this.normalizeNumber(this.extractFormValue(fc, '本月预算金额Importe presupuestado')),
      monthlyBudgetUsedAmount: this.normalizeNumber(this.extractFormValue(fc, '本月预算已用金额Importe utilizado')),
      applicationType: this.extractFormValue(fc, '申请类型Tipo de trámite') || this.extractFormValue(fc, '申请类型'),
      expenseType: this.extractFormValue(fc, '支出类型'),
      executionRegion: this.extractFormValue(fc, '执行地区Región de ejecución') || this.extractFormValue(fc, '执行地区'),
      operationExpense: this.extractFormValue(fc, '管理支出Gastos de operación') || this.extractFormValue(fc, '管理支出'),
      employeeBenefitsExpense: this.extractFormValue(fc, '职工福利费Gastos de beneficios') || this.extractFormValue(fc, '职工福利费'),
      bonusExpense: this.extractFormValue(fc, '奖金Bonificaciones') || this.extractFormValue(fc, '奖金'),
      salaryExpense: this.extractFormValue(fc, '工资salario') || this.extractFormValue(fc, '工资'),
      administrativeExpense: this.extractFormValue(fc, '管理费用Gastos administrativos') || this.extractFormValue(fc, '管理费用'),
      vehicleUsageExpense: this.extractFormValue(fc, '车辆使用费gastos de uso') || this.extractFormValue(fc, '车辆使用费'),
      taxExpense,
      financeRelatedExpense: this.extractFormValue(fc, '财务相关费用Gastos relacionados con finanzas') || this.extractFormValue(fc, '财务相关费用'),
      salesExpense: this.extractFormValue(fc, '销售费用Gastos de venta') || this.extractFormValue(fc, '销售费用'),
      salesChannelCommissionExpense: this.extractFormValue(fc, '销售渠道管理与佣金费用Gastos de gestión de canales') || this.extractFormValue(fc, '销售渠道管理'),
      salesTeamCustomerServiceExpense: this.extractFormValue(fc, '销售团队与客户服务费用Gastos del equipo de ventas') || this.extractFormValue(fc, '销售团队'),
      otherSalesRelatedExpense: this.extractFormValue(fc, '其他销售相关费用Otros gastos relacionados') || this.extractFormValue(fc, '其他销售'),
      marketingAdvertisingExpense: this.extractFormValue(fc, '市场推广与广告费用Gastos de marketing') || this.extractFormValue(fc, '市场推广'),
      matterDescription: this.extractFormValue(fc, '事项说明Explicación de asuntos') || this.extractFormValue(fc, '事项说明'),
      beneficiary: this.extractFormValue(fc, '收款人beneficiario') || this.extractFormValue(fc, '收款人'),
      amount: this.normalizeNumber(this.extractFormValueLastNonEmpty(fc, '金额importe') || this.extractFormValue(fc, '明细汇总金额')),
      paymentTerms: this.extractFormValue(fc, '付款条件Términos de pago') || this.extractFormValue(fc, '付款条件'),
      currency: this.extractFormValueLastNonEmpty(fc, '币种Moneda') || this.extractFormValue(fc, '币种'),
      paymentDate: this.extractFormValue(fc, '付款日期Fecha de pago') || this.extractFormValue(fc, '付款日期'),
      keyVoucher: this.extractFormValue(fc, '关键凭证Comprobante') || this.extractFormValue(fc, '关键凭证'),
      platform: null,
      platformName: null,
      storeName: null,
      monthlyBudgetRemainingAmount,
      paymentDetailReason,
      salaryByDepartment: deptSplitResults.salaryByDepartment ?? null,
      socialInsuranceByDepartment: deptSplitResults.socialInsuranceByDepartment ?? null,
      officeSpaceByDepartment: deptSplitResults.officeSpaceByDepartment ?? null,
      individualIncomeTaxByDepartment,
    };
  }

  // 解析采购支出全部字段（写入 approval_expense_purchase）
  parsePurchaseExpenseData(
    formComponentValues?: FormComponentValue[],
    instance?: Pick<ApprovalInstance, 'originatorDeptId' | 'originatorDeptName'>
  ): Record<string, unknown> {
    const fc = formComponentValues;
    const purchaseDetails = parsePurchaseDetails(fc);
    const applicantDepartmentIdentity = parseApplicantDepartmentIdentity(fc, instance);
    const department = applicantDepartmentIdentity.department ||
      this.extractFormValue(fc, '申请部门Departamento Solicitante') || this.extractFormValue(fc, '部门Departamento');
    const monthlyBudgetRemainingAmount = this.normalizeNumber(
      this.extractFormValueExact(fc, '本月预算剩余金额')
      || this.extractFormValueExact(fc, '本月预算剩余金额Saldo restante del presupuesto mensual')
      || this.extractFormValueExact(fc, '本月预算剩余金额Importe restante del presupuesto mensual')
    );

    return {
      requestDate: this.extractFormValue(fc, '申请日期Fecha de solicitud') || this.extractFormValue(fc, '申请日期'),
      applicantDepartment: department,
      applicantDepartmentId: applicantDepartmentIdentity.departmentId,
      applicantDepartmentSource: applicantDepartmentIdentity.departmentSource,
      productionType: this.extractFormValue(fc, '生产/非生产Producción') || this.extractFormValue(fc, '生产/非生产'),
      monthlyBudgetAmount: this.normalizeNumber(this.extractFormValue(fc, '本月预算金额Importe presupuestado')),
      monthlyBudgetUsedAmount: this.normalizeNumber(this.extractFormValue(fc, '本月预算已用金额Importe utilizado')),
      monthlyBudgetRemainingAmount,
      purchaseExpense: this.extractFormValue(fc, '采购支出Gastos de Compra') || this.extractFormValue(fc, '采购支出'),
      orderName: this.extractFormValue(fc, '订单Pedido') || this.extractFormValue(fc, '订单'),
      projectName: this.extractFormValue(fc, '项目Proyecto') || this.extractFormValue(fc, '项目'),
      productName: this.extractFormValue(fc, '产品Producto') || this.extractFormValue(fc, '产品'),
      ywOemImlPhoneCase: this.extractFormValue(fc, 'YW OEM IML'),
      ywOemPhoneCase: this.extractFormValue(fc, 'YW OEM Phone Case'),
      ywOemTabletCase: this.extractFormValue(fc, 'YW OEM Tablet Case'),
      ywOemSupport: this.extractFormValue(fc, 'YW OEM Soporte') || this.extractFormValue(fc, '支架类'),
      ywMoldesOdm: this.extractFormValue(fc, 'YW MOLDES ODM') || this.extractFormValue(fc, '模具ODM'),
      consultingServices: this.extractFormValue(fc, '咨询服务Servicios De Consultoría') || this.extractFormValue(fc, '咨询服务'),
      tiktokOnlineStore: this.extractFormValue(fc, 'Tiktok线上店铺'),
      executionRegion: this.extractFormValue(fc, '执行地区Región de ejecución') || this.extractFormValue(fc, '执行地区'),
      orderPurchase: this.extractFormValue(fc, '订单采购Compras por pedido') || this.extractFormValue(fc, '订单采购'),
      expenseClassification: this.extractFormValue(fc, '费用分类Clasificación de gastos') || this.extractFormValue(fc, '费用分类'),
      investmentPurchase: this.extractFormValue(fc, '投资采购Compra de inversión') || this.extractFormValue(fc, '投资采购'),
      servicePurchase: this.extractFormValue(fc, '服务类采购Adquisiciones de servicios') || this.extractFormValue(fc, '服务类采购'),
      mroClassification: this.extractFormValue(fc, 'MRO分类Clasificación MRO') || this.extractFormValue(fc, 'MRO分类'),
      productiveMro: this.extractFormValue(fc, '生产性Productivo MRO') || this.extractFormValue(fc, '生产性'),
      nonProductiveMro: this.extractFormValue(fc, '非生产性No productivo MRO') || this.extractFormValue(fc, '非生产性'),
      pdsClassification: this.extractFormValue(fc, 'PDS分类Clasificación PDS') || this.extractFormValue(fc, 'PDS分类'),
      pieceworkOutsourcing: this.extractFormValue(fc, '计件外包Outsourcing por pieza') || this.extractFormValue(fc, '计件外包'),
      logisticsTransportService: this.extractFormValue(fc, '物流及运输服务Servicios de logística') || this.extractFormValue(fc, '物流'),
      customsClearanceService: normalizePurchaseMultiSelect(this.extractFormValue(fc, '清关服务Servicios de despacho aduanero') || this.extractFormValue(fc, '清关')),
      detailSummaryAmount: this.normalizeNumber(this.extractFormValue(fc, '明细汇总金额Monto total detallado') || this.extractFormValue(fc, '明细汇总金额')),
      keyVoucher: this.extractFormValue(fc, '关键凭证Comprobante') || this.extractFormValue(fc, '关键凭证'),
      items: purchaseDetails.items,
      processors: purchaseDetails.processors,
    };
  }

  // 整单最终结果：只要任意人工节点拒绝即记为 REFUSE，便于数据库直接识别"被拒绝单"
  deriveFlowResult(tasks?: Task[]): string {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return 'NONE';
    }
    const userTasks = tasks.filter((task) => task && task.userId && task.userId !== 'bpms_system');
    if (!userTasks.length) {
      return 'NONE';
    }
    const hasRefuse = userTasks.some((task) => {
      const r = String(task.result || '').toUpperCase();
      return r === 'REFUSE' || r === 'REJECT';
    });
    if (hasRefuse) {
      return 'REFUSE';
    }
    const hasAgree = userTasks.some((task) => String(task.result || '').toUpperCase() === 'AGREE');
    return hasAgree ? 'AGREE' : 'NONE';
  }

  /**
   * @param instance 钉钉详情
   * @param options 保留兼容旧脚本参数；新表 upsert 始终覆盖刷新
   */
  async processInstance(instance: ApprovalInstance, options: { force?: boolean } = {}): Promise<ProcessResult> {
    const businessId = instance.businessId;

    if (!businessId) {
      logger.warn('实例缺少businessId，跳过');
      return { skipped: true, reason: '缺少businessId' };
    }

    // 解析表单数据
    const formData = this.parseFormData(instance.formComponentValues);

    // 构造入库数据（processInstanceId 用于再次调用钉钉详情接口，与 businessId 不同）
    const data: Record<string, unknown> = {
      businessId,
      processInstanceId:
        instance.processInstanceId != null ? String(instance.processInstanceId).substring(0, 128) : null,
      title: instance.title,
      processCode: instance.processCode || null,
      processType: instance.processType || null,
      status: instance.status,
      originatorUserId: instance.originatorUserId,
      originatorDeptId: instance.originatorDeptId,
      originatorDeptName: instance.originatorDeptName,
      bizAction: instance.bizAction,
      createTime: instance.createTime,
      flowResult: this.deriveFlowResult(instance.tasks),
      ...formData,
      rawData: instance
    };

    // 转换金额和预算类字段为数字，无法识别时写入null
    data.amount = this.normalizeNumber(data.amount);
    data.monthlyBudget = this.normalizeNumber(data.monthlyBudget);
    data.monthlyBudgetUsed = this.normalizeNumber(data.monthlyBudgetUsed);

    // 同步写入 approval_expense_* 结构化表
    try {
      const meta = this.parseApprovalMeta(instance);
      const attachments = this.extractAttachments(instance.formComponentValues);
      const processType = instance.processType || data.processType || '';
      const fixedApplicantDepartment = resolveFixedApplicantDepartment(instance.processCode);

      if (String(processType).includes('运营') || String(processType).includes('杩愯惀')) {
        const opData = this.parseOperationExpenseData(instance.formComponentValues, instance);
        const opApplicantDepartment =
          (typeof opData.applicantDepartment === 'string' ? opData.applicantDepartment : null) ||
          fixedApplicantDepartment;
        const opAmount = opData.amount ?? data.amount;
        const opCurrency = opData.currency ?? data.currency;
        const opBaseCurrencyAmount = await convertAmountToCny({
          amount: opAmount,
          currencyLabel: opCurrency,
          createTime: String(data.createTime || '')
        });

        await this.enrichOperationDepartmentPaths(opData);
        const deptSplits = collectOperationDeptSplits(opData);

        const fullOpData = {
          ...opData,
          applicantDepartment: opApplicantDepartment,
          processInstanceId: data.processInstanceId as string,
          businessId,
          formName: resolveOperationFormName(instance.processCode),
          amount: opAmount as number,
          baseCurrencyAmount: opBaseCurrencyAmount as number,
          currency: opCurrency as string,
          ...meta,
          creatorDepartment: meta.creatorDepartment,
          rawData: instance as unknown as Record<string, unknown>
        };

        const opId = await database.upsertOperationExpenseWithSplits(fullOpData, deptSplits);
        if (opId) {
          await database.replaceAttachments('operation', opId, attachments);
        }
      } else if (String(processType).includes('采购') || String(processType).includes('閲囪喘')) {
        const pData = this.parsePurchaseExpenseData(instance.formComponentValues, instance);
        await this.enrichOperationDepartmentPaths(pData);
        const purchaseApplicantDepartment =
          (typeof pData.applicantDepartment === 'string' ? pData.applicantDepartment : null) ||
          fixedApplicantDepartment;
        const purchaseAmount = pData.detailSummaryAmount ?? data.amount;
        const purchaseCurrency = pData.currency ?? data.currency;
        const purchaseBaseCurrencyAmount = await convertAmountToCny({
          amount: purchaseAmount,
          currencyLabel: purchaseCurrency,
          createTime: String(data.createTime || '')
        });
        const purchaseId = await database.upsertPurchaseExpense({
          ...pData,
          applicantDepartment: purchaseApplicantDepartment,
          processInstanceId: data.processInstanceId as string,
          businessId,
          formName: resolvePurchaseFormName(instance.processCode),
          baseCurrencyAmount: purchaseBaseCurrencyAmount as number,
          ...meta,
          creatorDepartment: meta.creatorDepartment,
          rawData: instance as unknown as Record<string, unknown>
        });
        if (purchaseId) {
          const purchaseItems = Array.isArray(pData.items) ? pData.items as PurchaseItemData[] : [];
          const purchaseProcessors = Array.isArray(pData.processors) ? pData.processors as PurchaseProcessorData[] : [];
          await database.replaceAttachments('purchase', purchaseId, attachments);
          await database.replacePurchaseDetails(purchaseId, {
            items: purchaseItems,
            processors: purchaseProcessors,
          });
        }
        if (purchaseId) {
          const payments = [];
          if (purchaseAmount != null || purchaseCurrency || data.beneficiary || data.paymentDate || data.paymentTerms) {
            payments.push({
              rowNo: 1,
              beneficiary: data.beneficiary ? String(data.beneficiary) : undefined,
              amount: purchaseAmount as number,
              paymentTerms: data.paymentTerms ? String(data.paymentTerms) : undefined,
              currency: purchaseCurrency ? String(purchaseCurrency) : undefined,
              paymentDate: data.paymentDate ? String(data.paymentDate) : undefined,
              rawData: undefined
            });
          }
          await database.replacePurchasePayments(purchaseId, payments);
        }
      } else {
        return { skipped: true, reason: `unsupported process type: ${processType || 'unknown'}` };
      }
    } catch (expenseErr: unknown) {
      const message = expenseErr instanceof Error ? expenseErr.message : String(expenseErr);
      logger.warn(`实例 ${businessId} expense表写入失败: ${message}`);
      throw expenseErr;
    }

    logger.info(`实例 ${businessId} 处理成功`);
    return { success: true, businessId };
  }

  // 批量处理审批实例
  async processInstances(instances: ApprovalInstance[], options: { force?: boolean } = {}): Promise<BatchProcessResult> {
    const results: BatchProcessResult = {
      success: 0,
      skipped: 0,
      failed: 0,
      details: []
    };

    for (const instance of instances) {
      try {
        const result = await this.processInstance(instance, options);
        if (result.skipped) {
          results.skipped++;
        } else {
          results.success++;
        }
        results.details.push(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`处理实例 ${instance.businessId} 失败: ${message}`);
        results.failed++;
        results.details.push({
          businessId: instance.businessId,
          failed: true,
          error: message
        });
      }
    }

    return results;
  }
}

export default new ApprovalProcessor();
