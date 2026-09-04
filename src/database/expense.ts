import { eq, and, sql } from 'drizzle-orm';
import { db } from './pool.ts';
import {
  approvalExpenseAttachments,
  approvalExpenseDeptSplit,
  approvalExpenseOperation,
  approvalExpensePurchase,
  approvalExpensePurchaseItems,
  approvalExpensePurchasePayments,
  approvalExpensePaymentEvents,
  approvalExpensePurchaseProcessors
} from './schema/index.ts';
import {
  OperationExpenseData,
  PurchaseExpenseData,
  PurchaseItemData,
  PurchaseProcessorData,
  PurchasePaymentData,
  PaymentEventData,
  AttachmentData,
  ExpenseInstanceRow,
  DeptSplitRow,
} from './types.ts';
import {
  completedApprovalResult,
  completedApprovedApprovalStateSql,
  completedApprovedExpenseSql,
} from '../completed-expense-policy.ts';

interface ExpenseInstanceQueryRow extends Record<string, unknown>, ExpenseInstanceRow {}
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getPendingExpenseInstances(limit = 500): Promise<ExpenseInstanceRow[]> {
  const completedAndAgreed = completedApprovedApprovalStateSql('e');
  const result = await db.execute<ExpenseInstanceQueryRow>(sql`
    SELECT *
    FROM (
      SELECT
        'operation' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at,
        approval_status,
        approval_completed_at
      FROM approval_expense_operation
      WHERE business_id IS NOT NULL
      UNION ALL
      SELECT
        'purchase' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at,
        approval_status,
        approval_completed_at
      FROM approval_expense_purchase
      WHERE business_id IS NOT NULL
    ) AS e
    WHERE NOT (${sql.raw(completedAndAgreed)})
    ORDER BY updated_at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function getStaleExpenseAgreed(limit = 80): Promise<ExpenseInstanceRow[]> {
  if (!limit || limit <= 0) {
    return [];
  }
  const completedAndAgreed = completedApprovedExpenseSql('e');
  const result = await db.execute<ExpenseInstanceQueryRow>(sql`
    SELECT *
    FROM (
      SELECT
        'operation' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at,
        approval_status,
        approval_completed_at
      FROM approval_expense_operation
      WHERE business_id IS NOT NULL
      UNION ALL
      SELECT
        'purchase' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at,
        approval_status,
        approval_completed_at
      FROM approval_expense_purchase
      WHERE business_id IS NOT NULL
    ) AS e
    WHERE ${sql.raw(completedAndAgreed)}
    ORDER BY updated_at ASC NULLS FIRST
    LIMIT ${limit}
  `);
  return result.rows;
}

function decimalValue(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

export async function upsertOperationExpense(data: OperationExpenseData): Promise<number | undefined> {
  if (!data.businessId) throw new Error('businessId is required for upsertOperationExpense');
  const [row] = await db.insert(approvalExpenseOperation).values({
    processInstanceId: data.processInstanceId?.substring(0, 128) || null,
    businessId: data.businessId,
    requestDate: data.requestDate || null,
    applicantDepartment: data.applicantDepartment?.substring(0, 500) || null,
    applicantDepartmentId: data.applicantDepartmentId?.substring(0, 64) || null,
    applicantDepartmentSource: data.applicantDepartmentSource?.substring(0, 32) || null,
    applicantDepartmentPathIds: data.applicantDepartmentPathIds || null,
    applicantDepartmentPathNames: data.applicantDepartmentPathNames || null,
    productionType: data.productionType?.substring(0, 64) || null,
    monthlyBudgetAmount: decimalValue(data.monthlyBudgetAmount),
    monthlyBudgetUsedAmount: decimalValue(data.monthlyBudgetUsedAmount),
    monthlyBudgetRemainingAmount: decimalValue(data.monthlyBudgetRemainingAmount),
    applicationType: data.applicationType?.substring(0, 128) || null,
    expenseType: data.expenseType?.substring(0, 128) || null,
    executionRegion: data.executionRegion?.substring(0, 128) || null,
    businessEntity: data.businessEntity?.substring(0, 64) || null,
    formName: data.formName?.substring(0, 128) || null,
    platform: data.platform?.substring(0, 128) || null,
    platformName: data.platformName?.substring(0, 255) || null,
    storeName: data.storeName?.substring(0, 255) || null,
    operationExpense: data.operationExpense?.substring(0, 128) || null,
    employeeBenefitsExpense: data.employeeBenefitsExpense?.substring(0, 128) || null,
    bonusExpense: data.bonusExpense?.substring(0, 128) || null,
    salaryExpense: data.salaryExpense?.substring(0, 128) || null,
    administrativeExpense: data.administrativeExpense?.substring(0, 128) || null,
    vehicleUsageExpense: data.vehicleUsageExpense?.substring(0, 128) || null,
    taxExpense: data.taxExpense?.substring(0, 128) || null,
    financeRelatedExpense: data.financeRelatedExpense?.substring(0, 128) || null,
    salesExpense: data.salesExpense?.substring(0, 128) || null,
    salesChannelCommissionExpense: data.salesChannelCommissionExpense?.substring(0, 128) || null,
    salesTeamCustomerServiceExpense: data.salesTeamCustomerServiceExpense?.substring(0, 128) || null,
    otherSalesRelatedExpense: data.otherSalesRelatedExpense?.substring(0, 128) || null,
    marketingAdvertisingExpense: data.marketingAdvertisingExpense?.substring(0, 128) || null,
    matterDescription: data.matterDescription?.substring(0, 5000) || null,
    paymentDetailReason: data.paymentDetailReason?.substring(0, 5000) || null,
    beneficiary: data.beneficiary?.substring(0, 500) || null,
    amount: decimalValue(data.amount),
    baseCurrencyAmount: decimalValue(data.baseCurrencyAmount),
    paymentTerms: data.paymentTerms?.substring(0, 255) || null,
    currency: data.currency?.substring(0, 32) || null,
    paymentDate: data.paymentDate || null,
    keyVoucher: data.keyVoucher?.substring(0, 2000) || null,
    approvalCompletedAt: data.approvalCompletedAt || null,
    approvalStatus: data.approvalStatus?.substring(0, 64) || null,
    currentNode: data.currentNode?.substring(0, 255) || null,
    currentOwner: data.currentOwner?.substring(0, 500) || null,
    historicalApprovers: data.historicalApprovers?.substring(0, 5000) || null,
    approvalNo: data.approvalNo?.substring(0, 128) || null,
    creatorName: data.creatorName?.substring(0, 255) || null,
    sourceCreatedAt: data.sourceCreatedAt || null,
    sourceUpdatedAt: data.sourceUpdatedAt || null,
    creatorDepartment: data.creatorDepartment?.substring(0, 500) || null,
    salaryByDepartment: data.salaryByDepartment ?? null,
    bonusByDepartment: data.bonusByDepartment ?? null,
    socialInsuranceByDepartment: data.socialInsuranceByDepartment ?? null,
    officeSpaceByDepartment: data.officeSpaceByDepartment ?? null,
    individualIncomeTaxByDepartment: data.individualIncomeTaxByDepartment ?? null,
    itOperationByDepartment: data.itOperationByDepartment ?? null,
    rawData: data.rawData || {}
  }).onConflictDoUpdate({
    target: approvalExpenseOperation.businessId,
    targetWhere: sql`${approvalExpenseOperation.businessId} IS NOT NULL`,
    set: {
      processInstanceId: sql`COALESCE(EXCLUDED.process_instance_id, ${approvalExpenseOperation.processInstanceId})`,
      requestDate: sql`EXCLUDED.request_date`,
      applicantDepartment: sql`EXCLUDED.applicant_department`,
      applicantDepartmentId: sql`EXCLUDED.applicant_department_id`,
      applicantDepartmentSource: sql`EXCLUDED.applicant_department_source`,
      applicantDepartmentPathIds: sql`EXCLUDED.applicant_department_path_ids`,
      applicantDepartmentPathNames: sql`EXCLUDED.applicant_department_path_names`,
      productionType: sql`EXCLUDED.production_type`,
      monthlyBudgetAmount: sql`EXCLUDED.monthly_budget_amount`,
      monthlyBudgetUsedAmount: sql`EXCLUDED.monthly_budget_used_amount`,
      monthlyBudgetRemainingAmount: sql`EXCLUDED.monthly_budget_remaining_amount`,
      applicationType: sql`EXCLUDED.application_type`,
      expenseType: sql`EXCLUDED.expense_type`,
      executionRegion: sql`EXCLUDED.execution_region`,
      businessEntity: sql`EXCLUDED.business_entity`,
      formName: sql`EXCLUDED.form_name`,
      platform: sql`EXCLUDED.platform`,
      platformName: sql`EXCLUDED.platform_name`,
      storeName: sql`EXCLUDED.store_name`,
      operationExpense: sql`EXCLUDED.operation_expense`,
      employeeBenefitsExpense: sql`EXCLUDED.employee_benefits_expense`,
      bonusExpense: sql`EXCLUDED.bonus_expense`,
      salaryExpense: sql`EXCLUDED.salary_expense`,
      administrativeExpense: sql`EXCLUDED.administrative_expense`,
      vehicleUsageExpense: sql`EXCLUDED.vehicle_usage_expense`,
      taxExpense: sql`EXCLUDED.tax_expense`,
      financeRelatedExpense: sql`EXCLUDED.finance_related_expense`,
      salesExpense: sql`EXCLUDED.sales_expense`,
      salesChannelCommissionExpense: sql`EXCLUDED.sales_channel_commission_expense`,
      salesTeamCustomerServiceExpense: sql`EXCLUDED.sales_team_customer_service_expense`,
      otherSalesRelatedExpense: sql`EXCLUDED.other_sales_related_expense`,
      marketingAdvertisingExpense: sql`EXCLUDED.marketing_advertising_expense`,
      matterDescription: sql`EXCLUDED.matter_description`,
      paymentDetailReason: sql`EXCLUDED.payment_detail_reason`,
      beneficiary: sql`EXCLUDED.beneficiary`,
      amount: sql`EXCLUDED.amount`,
      baseCurrencyAmount: sql`EXCLUDED.base_currency_amount`,
      paymentTerms: sql`EXCLUDED.payment_terms`,
      currency: sql`EXCLUDED.currency`,
      paymentDate: sql`EXCLUDED.payment_date`,
      keyVoucher: sql`EXCLUDED.key_voucher`,
      approvalCompletedAt: sql`EXCLUDED.approval_completed_at`,
      approvalStatus: sql`EXCLUDED.approval_status`,
      currentNode: sql`EXCLUDED.current_node`,
      currentOwner: sql`EXCLUDED.current_owner`,
      historicalApprovers: sql`EXCLUDED.historical_approvers`,
      approvalNo: sql`EXCLUDED.approval_no`,
      creatorName: sql`EXCLUDED.creator_name`,
      sourceCreatedAt: sql`EXCLUDED.source_created_at`,
      sourceUpdatedAt: sql`EXCLUDED.source_updated_at`,
      creatorDepartment: sql`EXCLUDED.creator_department`,
      salaryByDepartment: sql`EXCLUDED.salary_by_department`,
      bonusByDepartment: sql`EXCLUDED.bonus_by_department`,
      socialInsuranceByDepartment: sql`EXCLUDED.social_insurance_by_department`,
      officeSpaceByDepartment: sql`EXCLUDED.office_space_by_department`,
      individualIncomeTaxByDepartment: sql`EXCLUDED.individual_income_tax_by_department`,
      // IT 运维明细已停止解析；重同步旧单时保留历史 JSONB，不覆盖为 NULL。
      itOperationByDepartment: sql`COALESCE(EXCLUDED.it_operation_by_department, ${approvalExpenseOperation.itOperationByDepartment})`,
      rawData: sql`EXCLUDED.raw_data`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }
  }).returning({ id: approvalExpenseOperation.id });
  return row?.id;
}

export async function upsertPurchaseExpense(data: PurchaseExpenseData): Promise<number | undefined> {
  if (!data.businessId) throw new Error('businessId is required for upsertPurchaseExpense');
  const [row] = await db.insert(approvalExpensePurchase).values({
    processInstanceId: data.processInstanceId?.substring(0, 128) || null,
    businessId: data.businessId,
    requestDate: data.requestDate || null,
    applicantDepartment: data.applicantDepartment?.substring(0, 500) || null,
    applicantDepartmentId: data.applicantDepartmentId?.substring(0, 64) || null,
    applicantDepartmentSource: data.applicantDepartmentSource?.substring(0, 32) || null,
    applicantDepartmentPathIds: data.applicantDepartmentPathIds || null,
    applicantDepartmentPathNames: data.applicantDepartmentPathNames || null,
    productionType: data.productionType?.substring(0, 64) || null,
    monthlyBudgetAmount: decimalValue(data.monthlyBudgetAmount),
    monthlyBudgetUsedAmount: decimalValue(data.monthlyBudgetUsedAmount),
    monthlyBudgetRemainingAmount: decimalValue(data.monthlyBudgetRemainingAmount),
    businessEntity: data.businessEntity?.substring(0, 64) || null,
    serviceEntity: data.serviceEntity?.substring(0, 64) || null,
    formName: data.formName?.substring(0, 128) || null,
    purchaseExpense: data.purchaseExpense?.substring(0, 128) || null,
    orderName: data.orderName?.substring(0, 255) || null,
    projectName: data.projectName?.substring(0, 255) || null,
    productName: data.productName?.substring(0, 255) || null,
    ywOemImlPhoneCase: data.ywOemImlPhoneCase?.substring(0, 128) || null,
    ywOemPhoneCase: data.ywOemPhoneCase?.substring(0, 128) || null,
    ywOemTabletCase: data.ywOemTabletCase?.substring(0, 128) || null,
    ywOemSupport: data.ywOemSupport?.substring(0, 128) || null,
    ywMoldesOdm: data.ywMoldesOdm?.substring(0, 128) || null,
    consultingServices: data.consultingServices?.substring(0, 128) || null,
    tiktokOnlineStore: data.tiktokOnlineStore?.substring(0, 128) || null,
    executionRegion: data.executionRegion?.substring(0, 128) || null,
    orderPurchase: data.orderPurchase?.substring(0, 128) || null,
    expenseClassification: data.expenseClassification?.substring(0, 255) || null,
    investmentPurchase: data.investmentPurchase?.substring(0, 128) || null,
    servicePurchase: data.servicePurchase?.substring(0, 128) || null,
    mroClassification: data.mroClassification?.substring(0, 128) || null,
    productiveMro: data.productiveMro?.substring(0, 128) || null,
    nonProductiveMro: data.nonProductiveMro?.substring(0, 128) || null,
    pdsClassification: data.pdsClassification?.substring(0, 128) || null,
    pieceworkOutsourcing: data.pieceworkOutsourcing?.substring(0, 128) || null,
    logisticsTransportService: data.logisticsTransportService?.substring(0, 128) || null,
    customsClearanceService: data.customsClearanceService?.substring(0, 128) || null,
    detailSummaryAmount: decimalValue(data.detailSummaryAmount),
    baseCurrencyAmount: decimalValue(data.baseCurrencyAmount),
    keyVoucher: data.keyVoucher?.substring(0, 2000) || null,
    approvalCompletedAt: data.approvalCompletedAt || null,
    approvalStatus: data.approvalStatus?.substring(0, 64) || null,
    currentNode: data.currentNode?.substring(0, 255) || null,
    currentOwner: data.currentOwner?.substring(0, 500) || null,
    historicalApprovers: data.historicalApprovers?.substring(0, 5000) || null,
    approvalNo: data.approvalNo?.substring(0, 128) || null,
    creatorName: data.creatorName?.substring(0, 255) || null,
    sourceCreatedAt: data.sourceCreatedAt || null,
    sourceUpdatedAt: data.sourceUpdatedAt || null,
    creatorDepartment: data.creatorDepartment?.substring(0, 500) || null,
    rawData: data.rawData || {}
  }).onConflictDoUpdate({
    target: approvalExpensePurchase.businessId,
    targetWhere: sql`${approvalExpensePurchase.businessId} IS NOT NULL`,
    set: {
      processInstanceId: sql`COALESCE(EXCLUDED.process_instance_id, ${approvalExpensePurchase.processInstanceId})`,
      requestDate: sql`EXCLUDED.request_date`,
      applicantDepartment: sql`EXCLUDED.applicant_department`,
      applicantDepartmentId: sql`EXCLUDED.applicant_department_id`,
      applicantDepartmentSource: sql`EXCLUDED.applicant_department_source`,
      applicantDepartmentPathIds: sql`EXCLUDED.applicant_department_path_ids`,
      applicantDepartmentPathNames: sql`EXCLUDED.applicant_department_path_names`,
      productionType: sql`EXCLUDED.production_type`,
      monthlyBudgetAmount: sql`EXCLUDED.monthly_budget_amount`,
      monthlyBudgetUsedAmount: sql`EXCLUDED.monthly_budget_used_amount`,
      monthlyBudgetRemainingAmount: sql`EXCLUDED.monthly_budget_remaining_amount`,
      businessEntity: sql`EXCLUDED.business_entity`,
      serviceEntity: sql`EXCLUDED.service_entity`,
      formName: sql`EXCLUDED.form_name`,
      purchaseExpense: sql`EXCLUDED.purchase_expense`,
      orderName: sql`EXCLUDED.order_name`,
      projectName: sql`EXCLUDED.project_name`,
      productName: sql`EXCLUDED.product_name`,
      ywOemImlPhoneCase: sql`EXCLUDED.yw_oem_iml_phone_case`,
      ywOemPhoneCase: sql`EXCLUDED.yw_oem_phone_case`,
      ywOemTabletCase: sql`EXCLUDED.yw_oem_tablet_case`,
      ywOemSupport: sql`EXCLUDED.yw_oem_support`,
      ywMoldesOdm: sql`EXCLUDED.yw_moldes_odm`,
      consultingServices: sql`EXCLUDED.consulting_services`,
      tiktokOnlineStore: sql`EXCLUDED.tiktok_online_store`,
      executionRegion: sql`EXCLUDED.execution_region`,
      orderPurchase: sql`EXCLUDED.order_purchase`,
      expenseClassification: sql`EXCLUDED.expense_classification`,
      investmentPurchase: sql`EXCLUDED.investment_purchase`,
      servicePurchase: sql`EXCLUDED.service_purchase`,
      mroClassification: sql`EXCLUDED.mro_classification`,
      productiveMro: sql`EXCLUDED.productive_mro`,
      nonProductiveMro: sql`EXCLUDED.non_productive_mro`,
      pdsClassification: sql`EXCLUDED.pds_classification`,
      pieceworkOutsourcing: sql`EXCLUDED.piecework_outsourcing`,
      logisticsTransportService: sql`EXCLUDED.logistics_transport_service`,
      customsClearanceService: sql`EXCLUDED.customs_clearance_service`,
      detailSummaryAmount: sql`EXCLUDED.detail_summary_amount`,
      baseCurrencyAmount: sql`EXCLUDED.base_currency_amount`,
      keyVoucher: sql`EXCLUDED.key_voucher`,
      approvalCompletedAt: sql`EXCLUDED.approval_completed_at`,
      approvalStatus: sql`EXCLUDED.approval_status`,
      currentNode: sql`EXCLUDED.current_node`,
      currentOwner: sql`EXCLUDED.current_owner`,
      historicalApprovers: sql`EXCLUDED.historical_approvers`,
      approvalNo: sql`EXCLUDED.approval_no`,
      creatorName: sql`EXCLUDED.creator_name`,
      sourceCreatedAt: sql`EXCLUDED.source_created_at`,
      sourceUpdatedAt: sql`EXCLUDED.source_updated_at`,
      creatorDepartment: sql`EXCLUDED.creator_department`,
      rawData: sql`EXCLUDED.raw_data`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }
  }).returning({ id: approvalExpensePurchase.id });
  return row?.id;
}

async function replacePurchaseItemsWithExecutor(executor: DatabaseTransaction, purchaseId: number, items: PurchaseItemData[]): Promise<void> {
  await executor.delete(approvalExpensePurchaseItems).where(eq(approvalExpensePurchaseItems.purchaseId, purchaseId));
  for (const item of items) {
    await executor.insert(approvalExpensePurchaseItems).values({
      purchaseId,
      rowNo: item.rowNo || 1,
      itemName: item.itemName?.substring(0, 500) || null,
      imageUrl: item.imageUrl || null,
      itemCode: item.itemCode?.substring(0, 128) || null,
      itemSpecification: item.itemSpecification || null,
      quantity: decimalValue(item.quantity),
      inventory: decimalValue(item.inventory),
      unit: item.unit?.substring(0, 64) || null,
      unitPrice: decimalValue(item.unitPrice),
      totalAmount: decimalValue(item.totalAmount),
      rawData: item.rawData || {}
    });
  }
}

async function replacePurchaseProcessorsWithExecutor(executor: DatabaseTransaction, purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
  await executor.delete(approvalExpensePurchaseProcessors).where(eq(approvalExpensePurchaseProcessors.purchaseId, purchaseId));
  for (const p of processors) {
    await executor.insert(approvalExpensePurchaseProcessors).values({
      purchaseId,
      rowNo: p.rowNo || 1,
      processorName: p.processorName?.substring(0, 500) || null,
      processorPhone: p.processorPhone?.substring(0, 64) || null,
      odt: p.odt?.substring(0, 128) || null,
      salesOrderNo: p.salesOrderNo?.substring(0, 128) || null,
      processingMaterial: p.processingMaterial || null,
      quantity: decimalValue(p.quantity),
      unitPrice: decimalValue(p.unitPrice),
      totalAmount: decimalValue(p.totalAmount),
      specificationRequirementDescription: p.specificationRequirementDescription || null,
      deliveryDate: p.deliveryDate || null,
      rawData: p.rawData || {}
    });
  }
}

export async function replacePurchaseItems(purchaseId: number, items: PurchaseItemData[]): Promise<void> {
  await db.transaction(async (tx) => replacePurchaseItemsWithExecutor(tx, purchaseId, items));
}

export async function replacePurchaseProcessors(purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
  await db.transaction(async (tx) => replacePurchaseProcessorsWithExecutor(tx, purchaseId, processors));
}

export async function replacePurchaseDetails(
  purchaseId: number,
  details: { items: PurchaseItemData[]; processors: PurchaseProcessorData[] }
): Promise<void> {
  await db.transaction(async (tx) => {
    await replacePurchaseItemsWithExecutor(tx, purchaseId, details.items);
    await replacePurchaseProcessorsWithExecutor(tx, purchaseId, details.processors);
  });
}

export async function replacePurchasePayments(purchaseId: number, payments: PurchasePaymentData[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(approvalExpensePurchasePayments).where(eq(approvalExpensePurchasePayments.purchaseId, purchaseId));
    for (const p of payments) {
      await tx.insert(approvalExpensePurchasePayments).values({
        purchaseId,
        rowNo: p.rowNo || 1,
        beneficiary: p.beneficiary?.substring(0, 500) || null,
        amount: decimalValue(p.amount),
        paymentTerms: p.paymentTerms?.substring(0, 255) || null,
        currency: p.currency?.substring(0, 32) || null,
        paymentDate: p.paymentDate || null,
        rawData: p.rawData || {}
      });
    }
  });
}

/**
 * Insert immutable actual-payment facts. The source identity makes repeated
 * approval refreshes idempotent without conflating them with payment plans.
 */
export async function insertPaymentEvents(events: PaymentEventData[]): Promise<number> {
  if (events.length === 0) return 0;

  return db.transaction(async (tx) => {
    let inserted = 0;
    for (const event of events) {
      const amount = decimalValue(event.amount);
      if (amount == null || Number(amount) <= 0) continue;

      const rows = await tx.insert(approvalExpensePaymentEvents).values({
        businessId: event.businessId.substring(0, 64),
        processInstanceId: event.processInstanceId?.substring(0, 128) || null,
        expenseKind: event.expenseKind,
        paidAt: event.paidAt,
        amount,
        baseCurrencyAmount: decimalValue(event.baseCurrencyAmount),
        currency: event.currency?.substring(0, 32) || null,
        sourceType: event.sourceType,
        ruleVersion: event.ruleVersion.substring(0, 64),
        sourceUserId: event.sourceUserId?.substring(0, 128) || null,
        sourceHash: event.sourceHash,
        evidenceText: event.evidenceText.substring(0, 10000),
        rawData: event.rawData || {},
        status: 'confirmed',
      }).onConflictDoNothing({
        target: [
          approvalExpensePaymentEvents.businessId,
          approvalExpensePaymentEvents.paidAt,
          approvalExpensePaymentEvents.sourceHash,
        ],
      }).returning({ id: approvalExpensePaymentEvents.id });
      inserted += rows.length;
    }
    return inserted;
  });
}

export async function replaceAttachments(parentType: string, parentId: number, attachments: AttachmentData[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(approvalExpenseAttachments).where(and(
      eq(approvalExpenseAttachments.parentType, parentType),
      eq(approvalExpenseAttachments.parentId, parentId)
    ));
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      await tx.insert(approvalExpenseAttachments).values({
        parentType,
        parentId,
        rowNo: a.rowNo || i + 1,
        attachmentType: a.attachmentType?.substring(0, 64) || null,
        fileName: a.fileName?.substring(0, 500) || null,
        fileUrl: a.fileUrl || null,
        rawData: a.rawData || {}
      });
    }
  });
}

// ==================== Department Split (CQRS read model) ====================

interface DeptSplitStatusSource {
  approvalStatus?: unknown;
  rawData?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedStatus(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function shouldKeepDeptSplits(source: DeptSplitStatusSource): boolean {
  const rawData = asRecord(source.rawData);
  const approvalStatus = normalizedStatus(source.approvalStatus || rawData.status);
  const bizAction = normalizedStatus(rawData.bizAction || rawData.biz_action);
  const finalResult = normalizedStatus(completedApprovalResult(rawData));
  const terminalStatuses = new Set(['TERMINATED', 'CANCELED', 'CANCELLED']);
  const terminalActions = new Set(['REVOKE', 'DELETE', 'TERMINATE', 'CANCEL', 'CANCELED', 'CANCELLED']);

  if (terminalStatuses.has(approvalStatus) || terminalActions.has(bizAction)) {
    return false;
  }
  if (finalResult === 'REFUSE' || finalResult === 'REJECT') {
    return false;
  }

  // Historical task outcomes do not determine the final approval outcome.
  return true;
}

function aggregateDeptSplits(splits: DeptSplitRow[]): DeptSplitRow[] {
  const grouped = new Map<string, DeptSplitRow>();
  for (const split of splits) {
    const departmentId = String(split.departmentId || '').trim();
    const identity = departmentId ? `id:${departmentId}` : `name:${split.department}`;
    const key = `${split.splitType}\u0000${identity}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += Number(split.amount) || 0;
      if (!existing.note && split.note) existing.note = split.note;
    } else {
      grouped.set(key, { ...split, amount: Number(split.amount) || 0 });
    }
  }
  return [...grouped.values()];
}

/**
 * 唯一写入函数（single writer）。
 * 所有写入路径（processor / rebuild / backfill）都通过这一个函数。
 * delete + insert 覆盖模型，与 JSONB 列行为一致。
 */
export async function replaceDeptSplitsForBusiness(
  businessId: string,
  splits: DeptSplitRow[],
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  preserveManualSplits = true,
): Promise<void> {
  const executor = tx || db;
  const normalizedSplits = aggregateDeptSplits(splits);
  // Manual company allocations are kept outside the DingTalk JSONB payload.
  const manualSplits = preserveManualSplits ? await executor.select({
    splitType: approvalExpenseDeptSplit.splitType,
    department: approvalExpenseDeptSplit.department,
    departmentId: approvalExpenseDeptSplit.departmentId,
    departmentSource: approvalExpenseDeptSplit.departmentSource,
    departmentPathIds: approvalExpenseDeptSplit.departmentPathIds,
    departmentPathNames: approvalExpenseDeptSplit.departmentPathNames,
    amount: approvalExpenseDeptSplit.amount,
    note: approvalExpenseDeptSplit.note,
  }).from(approvalExpenseDeptSplit)
    .where(and(
      eq(approvalExpenseDeptSplit.businessId, businessId),
      eq(approvalExpenseDeptSplit.splitType, 'manual_company_allocation'),
    )) : [];
  const normalizedManualSplits: DeptSplitRow[] = manualSplits.map((split) => ({
    splitType: 'manual_company_allocation',
    department: split.department,
    departmentId: split.departmentId,
    departmentSource: split.departmentSource === 'id' || split.departmentSource === 'name_only'
      ? split.departmentSource
      : undefined,
    departmentPathIds: Array.isArray(split.departmentPathIds)
      ? split.departmentPathIds.map((value) => String(value))
      : null,
    departmentPathNames: Array.isArray(split.departmentPathNames)
      ? split.departmentPathNames.map((value) => String(value))
      : null,
    amount: Number(split.amount) || 0,
    note: split.note || undefined,
  }));
  // 新规则不再解析 IT 运维明细，但旧记录的拆分结果仍是历史事实。
  // 重同步时保留已有 IT 行，避免 delete + insert 覆盖模型误删历史金额。
  const legacyItSplits = preserveManualSplits ? await executor.select({
    splitType: approvalExpenseDeptSplit.splitType,
    department: approvalExpenseDeptSplit.department,
    departmentId: approvalExpenseDeptSplit.departmentId,
    departmentSource: approvalExpenseDeptSplit.departmentSource,
    departmentPathIds: approvalExpenseDeptSplit.departmentPathIds,
    departmentPathNames: approvalExpenseDeptSplit.departmentPathNames,
    amount: approvalExpenseDeptSplit.amount,
    note: approvalExpenseDeptSplit.note,
  }).from(approvalExpenseDeptSplit)
    .where(and(
      eq(approvalExpenseDeptSplit.businessId, businessId),
      eq(approvalExpenseDeptSplit.splitType, 'it_operation'),
    )) : [];
  const normalizedLegacyItSplits: DeptSplitRow[] = legacyItSplits.map((split) => ({
    splitType: 'it_operation',
    department: split.department,
    departmentId: split.departmentId,
    departmentSource: split.departmentSource === 'id' || split.departmentSource === 'name_only'
      ? split.departmentSource
      : undefined,
    departmentPathIds: Array.isArray(split.departmentPathIds)
      ? split.departmentPathIds.map((value) => String(value))
      : null,
    departmentPathNames: Array.isArray(split.departmentPathNames)
      ? split.departmentPathNames.map((value) => String(value))
      : null,
    amount: Number(split.amount) || 0,
    note: split.note || undefined,
  }));
  const hasIncomingLegacyItSplits = normalizedSplits.some((split) => split.splitType === 'it_operation');
  const splitsWithLegacyIt = hasIncomingLegacyItSplits
    ? normalizedSplits
    : [...normalizedSplits, ...normalizedLegacyItSplits];
  const allSplits = aggregateDeptSplits([...splitsWithLegacyIt, ...normalizedManualSplits]);
  await executor.delete(approvalExpenseDeptSplit)
    .where(eq(approvalExpenseDeptSplit.businessId, businessId));
  if (allSplits.length > 0) {
    await executor.insert(approvalExpenseDeptSplit).values(
      allSplits.map(s => ({
        businessId,
        splitType: s.splitType,
        department: s.department,
        departmentId: s.departmentId || null,
        departmentSource: s.departmentSource || (s.departmentId ? 'id' : 'name_only'),
        departmentPathIds: s.departmentPathIds ?? null,
        departmentPathNames: s.departmentPathNames ?? null,
        amount: decimalValue(s.amount) ?? '0',
        note: s.note || null,
      }))
    );
  }
}

/** 从 JSONB 列解析 split rows（允许负数金额，如退款/冲销） */
function parseSplitsFromJsonb(row: {
  salaryByDepartment: unknown;
  bonusByDepartment: unknown;
  socialInsuranceByDepartment: unknown;
  officeSpaceByDepartment: unknown;
  individualIncomeTaxByDepartment: unknown;
  itOperationByDepartment: unknown;
}): DeptSplitRow[] {
  const splits: DeptSplitRow[] = [];
  const mapping: Array<{ key: keyof typeof row; type: DeptSplitRow['splitType'] }> = [
    { key: 'salaryByDepartment', type: 'salary' },
    { key: 'bonusByDepartment', type: 'bonus' },
    { key: 'socialInsuranceByDepartment', type: 'social_insurance' },
    { key: 'officeSpaceByDepartment', type: 'office_space' },
    { key: 'individualIncomeTaxByDepartment', type: 'individual_income_tax' },
    { key: 'itOperationByDepartment', type: 'it_operation' },
  ];
  for (const m of mapping) {
    const arr = row[m.key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const amount = Number(item?.amount);
        if (item?.department && Number.isFinite(amount) && amount !== 0) {
          splits.push({
            splitType: m.type,
            department: String(item.department),
            departmentId: String(item.departmentId || '').trim() || null,
            departmentSource: String(item.departmentId || '').trim() ? 'id' : 'name_only',
            departmentPathIds: Array.isArray(item.departmentPathIds)
              ? item.departmentPathIds.map((value: unknown) => String(value))
              : null,
            departmentPathNames: Array.isArray(item.departmentPathNames)
              ? item.departmentPathNames.map((value: unknown) => String(value))
              : null,
            amount,
            note: item.note ? String(item.note) : undefined,
          });
        }
      }
    }
  }
  return splits;
}

/**
 * operation + split 同事务写入。
 * processor 写入路径调用此函数。
 */
export async function upsertOperationExpenseWithSplits(
  data: OperationExpenseData,
  splits: DeptSplitRow[]
): Promise<number | undefined> {
  if (!data.businessId) throw new Error('businessId is required for upsertOperationExpenseWithSplits');
  return db.transaction(async (tx) => {
    // 1. upsert operation
    const [row] = await tx.insert(approvalExpenseOperation).values({
      processInstanceId: data.processInstanceId?.substring(0, 128) || null,
      businessId: data.businessId,
      requestDate: data.requestDate || null,
      applicantDepartment: data.applicantDepartment?.substring(0, 500) || null,
      applicantDepartmentId: data.applicantDepartmentId?.substring(0, 64) || null,
      applicantDepartmentSource: data.applicantDepartmentSource?.substring(0, 32) || null,
      applicantDepartmentPathIds: data.applicantDepartmentPathIds || null,
      applicantDepartmentPathNames: data.applicantDepartmentPathNames || null,
      productionType: data.productionType?.substring(0, 64) || null,
      monthlyBudgetAmount: decimalValue(data.monthlyBudgetAmount),
      monthlyBudgetUsedAmount: decimalValue(data.monthlyBudgetUsedAmount),
      monthlyBudgetRemainingAmount: decimalValue(data.monthlyBudgetRemainingAmount),
      applicationType: data.applicationType?.substring(0, 128) || null,
      expenseType: data.expenseType?.substring(0, 128) || null,
      executionRegion: data.executionRegion?.substring(0, 128) || null,
      businessEntity: data.businessEntity?.substring(0, 64) || null,
      serviceEntity: data.serviceEntity?.substring(0, 64) || null,
      formName: data.formName?.substring(0, 128) || null,
      platform: data.platform?.substring(0, 128) || null,
      platformName: data.platformName?.substring(0, 255) || null,
      storeName: data.storeName?.substring(0, 255) || null,
      operationExpense: data.operationExpense?.substring(0, 128) || null,
      employeeBenefitsExpense: data.employeeBenefitsExpense?.substring(0, 128) || null,
      bonusExpense: data.bonusExpense?.substring(0, 128) || null,
      salaryExpense: data.salaryExpense?.substring(0, 128) || null,
      administrativeExpense: data.administrativeExpense?.substring(0, 128) || null,
      vehicleUsageExpense: data.vehicleUsageExpense?.substring(0, 128) || null,
      taxExpense: data.taxExpense?.substring(0, 128) || null,
      financeRelatedExpense: data.financeRelatedExpense?.substring(0, 128) || null,
      salesExpense: data.salesExpense?.substring(0, 128) || null,
      salesChannelCommissionExpense: data.salesChannelCommissionExpense?.substring(0, 128) || null,
      salesTeamCustomerServiceExpense: data.salesTeamCustomerServiceExpense?.substring(0, 128) || null,
      otherSalesRelatedExpense: data.otherSalesRelatedExpense?.substring(0, 128) || null,
      marketingAdvertisingExpense: data.marketingAdvertisingExpense?.substring(0, 128) || null,
      matterDescription: data.matterDescription?.substring(0, 5000) || null,
      paymentDetailReason: data.paymentDetailReason?.substring(0, 5000) || null,
      beneficiary: data.beneficiary?.substring(0, 500) || null,
      amount: decimalValue(data.amount),
      baseCurrencyAmount: decimalValue(data.baseCurrencyAmount),
      paymentTerms: data.paymentTerms?.substring(0, 255) || null,
      currency: data.currency?.substring(0, 32) || null,
      paymentDate: data.paymentDate || null,
      keyVoucher: data.keyVoucher?.substring(0, 2000) || null,
      approvalCompletedAt: data.approvalCompletedAt || null,
      approvalStatus: data.approvalStatus?.substring(0, 64) || null,
      currentNode: data.currentNode?.substring(0, 255) || null,
      currentOwner: data.currentOwner?.substring(0, 500) || null,
      historicalApprovers: data.historicalApprovers?.substring(0, 5000) || null,
      approvalNo: data.approvalNo?.substring(0, 128) || null,
      creatorName: data.creatorName?.substring(0, 255) || null,
      sourceCreatedAt: data.sourceCreatedAt || null,
      sourceUpdatedAt: data.sourceUpdatedAt || null,
      creatorDepartment: data.creatorDepartment?.substring(0, 500) || null,
      salaryByDepartment: data.salaryByDepartment ?? null,
      bonusByDepartment: data.bonusByDepartment ?? null,
      socialInsuranceByDepartment: data.socialInsuranceByDepartment ?? null,
      officeSpaceByDepartment: data.officeSpaceByDepartment ?? null,
      individualIncomeTaxByDepartment: data.individualIncomeTaxByDepartment ?? null,
      itOperationByDepartment: data.itOperationByDepartment ?? null,
      rawData: data.rawData || {}
    }).onConflictDoUpdate({
      target: approvalExpenseOperation.businessId,
      targetWhere: sql`${approvalExpenseOperation.businessId} IS NOT NULL`,
      set: {
        processInstanceId: sql`COALESCE(EXCLUDED.process_instance_id, ${approvalExpenseOperation.processInstanceId})`,
        requestDate: sql`EXCLUDED.request_date`,
        applicantDepartment: sql`EXCLUDED.applicant_department`,
        applicantDepartmentId: sql`EXCLUDED.applicant_department_id`,
        applicantDepartmentSource: sql`EXCLUDED.applicant_department_source`,
        applicantDepartmentPathIds: sql`EXCLUDED.applicant_department_path_ids`,
        applicantDepartmentPathNames: sql`EXCLUDED.applicant_department_path_names`,
        productionType: sql`EXCLUDED.production_type`,
        monthlyBudgetAmount: sql`EXCLUDED.monthly_budget_amount`,
        monthlyBudgetUsedAmount: sql`EXCLUDED.monthly_budget_used_amount`,
        monthlyBudgetRemainingAmount: sql`EXCLUDED.monthly_budget_remaining_amount`,
        applicationType: sql`EXCLUDED.application_type`,
        expenseType: sql`EXCLUDED.expense_type`,
        executionRegion: sql`EXCLUDED.execution_region`,
        businessEntity: sql`EXCLUDED.business_entity`,
        serviceEntity: sql`EXCLUDED.service_entity`,
        formName: sql`EXCLUDED.form_name`,
        platform: sql`EXCLUDED.platform`,
        platformName: sql`EXCLUDED.platform_name`,
        storeName: sql`EXCLUDED.store_name`,
        operationExpense: sql`EXCLUDED.operation_expense`,
        employeeBenefitsExpense: sql`EXCLUDED.employee_benefits_expense`,
        bonusExpense: sql`EXCLUDED.bonus_expense`,
        salaryExpense: sql`EXCLUDED.salary_expense`,
        administrativeExpense: sql`EXCLUDED.administrative_expense`,
        vehicleUsageExpense: sql`EXCLUDED.vehicle_usage_expense`,
        taxExpense: sql`EXCLUDED.tax_expense`,
        financeRelatedExpense: sql`EXCLUDED.finance_related_expense`,
        salesExpense: sql`EXCLUDED.sales_expense`,
        salesChannelCommissionExpense: sql`EXCLUDED.sales_channel_commission_expense`,
        salesTeamCustomerServiceExpense: sql`EXCLUDED.sales_team_customer_service_expense`,
        otherSalesRelatedExpense: sql`EXCLUDED.other_sales_related_expense`,
        marketingAdvertisingExpense: sql`EXCLUDED.marketing_advertising_expense`,
        matterDescription: sql`EXCLUDED.matter_description`,
        paymentDetailReason: sql`EXCLUDED.payment_detail_reason`,
        beneficiary: sql`EXCLUDED.beneficiary`,
        amount: sql`EXCLUDED.amount`,
        baseCurrencyAmount: sql`EXCLUDED.base_currency_amount`,
        paymentTerms: sql`EXCLUDED.payment_terms`,
        currency: sql`EXCLUDED.currency`,
        paymentDate: sql`EXCLUDED.payment_date`,
        keyVoucher: sql`EXCLUDED.key_voucher`,
        approvalCompletedAt: sql`EXCLUDED.approval_completed_at`,
        approvalStatus: sql`EXCLUDED.approval_status`,
        currentNode: sql`EXCLUDED.current_node`,
        currentOwner: sql`EXCLUDED.current_owner`,
        historicalApprovers: sql`EXCLUDED.historical_approvers`,
        approvalNo: sql`EXCLUDED.approval_no`,
        creatorName: sql`EXCLUDED.creator_name`,
        sourceCreatedAt: sql`EXCLUDED.source_created_at`,
        sourceUpdatedAt: sql`EXCLUDED.source_updated_at`,
        creatorDepartment: sql`EXCLUDED.creator_department`,
        salaryByDepartment: sql`EXCLUDED.salary_by_department`,
        bonusByDepartment: sql`EXCLUDED.bonus_by_department`,
        socialInsuranceByDepartment: sql`EXCLUDED.social_insurance_by_department`,
        officeSpaceByDepartment: sql`EXCLUDED.office_space_by_department`,
        individualIncomeTaxByDepartment: sql`EXCLUDED.individual_income_tax_by_department`,
        // IT 运维明细已停止解析；重同步旧单时保留历史 JSONB，不覆盖为 NULL。
        itOperationByDepartment: sql`COALESCE(EXCLUDED.it_operation_by_department, ${approvalExpenseOperation.itOperationByDepartment})`,
        rawData: sql`EXCLUDED.raw_data`,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }
    }).returning({ id: approvalExpenseOperation.id });
    const opId = row?.id;
    if (!opId) return undefined;

    // 2. 同事务写入 split
    const preserveManualSplits = shouldKeepDeptSplits(data);
    const effectiveSplits = preserveManualSplits ? splits : [];
    await replaceDeptSplitsForBusiness(data.businessId, effectiveSplits, tx, preserveManualSplits);
    return opId;
  });
}

/**
 * 从 JSONB 重建单个 businessId 的 split → 幂等，确定性。
 * rebuild 路径调用此函数。
 */
export async function rebuildDeptSplits(businessId: string): Promise<number> {
  const rows = await db.select({
    approvalStatus: approvalExpenseOperation.approvalStatus,
    rawData: approvalExpenseOperation.rawData,
    salaryByDepartment: approvalExpenseOperation.salaryByDepartment,
    bonusByDepartment: approvalExpenseOperation.bonusByDepartment,
    socialInsuranceByDepartment: approvalExpenseOperation.socialInsuranceByDepartment,
    officeSpaceByDepartment: approvalExpenseOperation.officeSpaceByDepartment,
    individualIncomeTaxByDepartment: approvalExpenseOperation.individualIncomeTaxByDepartment,
    itOperationByDepartment: approvalExpenseOperation.itOperationByDepartment,
  }).from(approvalExpenseOperation)
    .where(eq(approvalExpenseOperation.businessId, businessId))
    .limit(1);
  if (!rows.length) return 0;

  const preserveManualSplits = shouldKeepDeptSplits(rows[0]);
  const splits = preserveManualSplits ? parseSplitsFromJsonb(rows[0]) : [];
  await replaceDeptSplitsForBusiness(businessId, splits, undefined, preserveManualSplits);
  return splits.length;
}

/** 全量 rebuild：从所有 operation 的 JSONB 重建 split 表（批量处理，单事务） */
export async function rebuildAllDeptSplits(): Promise<{ total: number; rebuilt: number }> {
  const ops = await db.select({
    businessId: approvalExpenseOperation.businessId,
    approvalStatus: approvalExpenseOperation.approvalStatus,
    rawData: approvalExpenseOperation.rawData,
    salaryByDepartment: approvalExpenseOperation.salaryByDepartment,
    bonusByDepartment: approvalExpenseOperation.bonusByDepartment,
    socialInsuranceByDepartment: approvalExpenseOperation.socialInsuranceByDepartment,
    officeSpaceByDepartment: approvalExpenseOperation.officeSpaceByDepartment,
    individualIncomeTaxByDepartment: approvalExpenseOperation.individualIncomeTaxByDepartment,
    itOperationByDepartment: approvalExpenseOperation.itOperationByDepartment,
  }).from(approvalExpenseOperation)
    .where(sql`(${approvalExpenseOperation.salaryByDepartment} IS NOT NULL
              OR ${approvalExpenseOperation.bonusByDepartment} IS NOT NULL
            OR ${approvalExpenseOperation.socialInsuranceByDepartment} IS NOT NULL
              OR ${approvalExpenseOperation.officeSpaceByDepartment} IS NOT NULL
              OR ${approvalExpenseOperation.individualIncomeTaxByDepartment} IS NOT NULL
              OR ${approvalExpenseOperation.itOperationByDepartment} IS NOT NULL)
            OR EXISTS (
              SELECT 1 FROM ${approvalExpenseDeptSplit} ds
              WHERE ds.business_id = ${approvalExpenseOperation.businessId}
            )`);

  let rebuilt = 0;
  await db.transaction(async (tx) => {
    for (const op of ops) {
      if (!op.businessId) continue;
      const preserveManualSplits = shouldKeepDeptSplits(op);
      const splits = preserveManualSplits ? parseSplitsFromJsonb(op) : [];
      await replaceDeptSplitsForBusiness(op.businessId, splits, tx, preserveManualSplits);
      if (splits.length > 0) rebuilt++;
    }
  });
  return { total: ops.length, rebuilt };
}

/** 增量 backfill：只处理尚无 split 数据的 operation 记录 */
export async function backfillDeptSplits(): Promise<{ total: number; rebuilt: number }> {
  const ops = await db.select({
    businessId: approvalExpenseOperation.businessId,
    approvalStatus: approvalExpenseOperation.approvalStatus,
    rawData: approvalExpenseOperation.rawData,
    salaryByDepartment: approvalExpenseOperation.salaryByDepartment,
    bonusByDepartment: approvalExpenseOperation.bonusByDepartment,
    socialInsuranceByDepartment: approvalExpenseOperation.socialInsuranceByDepartment,
    officeSpaceByDepartment: approvalExpenseOperation.officeSpaceByDepartment,
    individualIncomeTaxByDepartment: approvalExpenseOperation.individualIncomeTaxByDepartment,
    itOperationByDepartment: approvalExpenseOperation.itOperationByDepartment,
  }).from(approvalExpenseOperation)
    .where(sql`(
              (${approvalExpenseOperation.salaryByDepartment} IS NOT NULL
             OR ${approvalExpenseOperation.bonusByDepartment} IS NOT NULL
             OR ${approvalExpenseOperation.socialInsuranceByDepartment} IS NOT NULL
             OR ${approvalExpenseOperation.officeSpaceByDepartment} IS NOT NULL
             OR ${approvalExpenseOperation.individualIncomeTaxByDepartment} IS NOT NULL
             OR ${approvalExpenseOperation.itOperationByDepartment} IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1 FROM ${approvalExpenseDeptSplit} ds
                WHERE ds.business_id = ${approvalExpenseOperation.businessId}
              )
            )
            OR (
              EXISTS (
                SELECT 1 FROM ${approvalExpenseDeptSplit} ds
                WHERE ds.business_id = ${approvalExpenseOperation.businessId}
              )
              AND (
                UPPER(COALESCE(${approvalExpenseOperation.approvalStatus}, ${approvalExpenseOperation.rawData}->>'status', '')) IN ('TERMINATED', 'CANCELED', 'CANCELLED')
                OR UPPER(COALESCE(${approvalExpenseOperation.rawData}->>'bizAction', ${approvalExpenseOperation.rawData}->>'biz_action', '')) IN ('REVOKE', 'DELETE', 'TERMINATE', 'CANCEL', 'CANCELED', 'CANCELLED')
                OR UPPER(COALESCE(
                  NULLIF(${approvalExpenseOperation.rawData}->>'result', ''),
                  NULLIF(${approvalExpenseOperation.rawData}->>'flowResult', ''),
                  ${approvalExpenseOperation.rawData}->>'flow_result',
                  ''
                )) IN ('REFUSE', 'REJECT')
              )
            )`);

  let rebuilt = 0;
  await db.transaction(async (tx) => {
    for (const op of ops) {
      if (!op.businessId) continue;
      const preserveManualSplits = shouldKeepDeptSplits(op);
      const splits = preserveManualSplits ? parseSplitsFromJsonb(op) : [];
      await replaceDeptSplitsForBusiness(op.businessId, splits, tx, preserveManualSplits);
      if (splits.length > 0) rebuilt++;
    }
  });
  return { total: ops.length, rebuilt };
}
