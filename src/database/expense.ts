import { eq, and, sql } from 'drizzle-orm';
import { db } from './pool.ts';
import config from '../config.ts';
import {
  approvalExpenseAttachments,
  approvalExpenseOperation,
  approvalExpensePurchase,
  approvalExpensePurchaseItems,
  approvalExpensePurchasePayments,
  approvalExpensePurchaseProcessors
} from './schema/index.ts';
import {
  OperationExpenseData,
  PurchaseExpenseData,
  PurchaseItemData,
  PurchaseProcessorData,
  PurchasePaymentData,
  AttachmentData,
  ExpenseInstanceRow
} from './types.ts';

interface ExpenseInstanceQueryRow extends Record<string, unknown>, ExpenseInstanceRow {}

export function getCashierActivityIdsForSql(): string[] {
  const map = config.dingtalk?.cashierActivityIdsByProcessCode;
  const ids: string[] = [];
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const value of Object.values(map)) {
      if (Array.isArray(value)) {
        ids.push(...value);
      }
    }
  }
  if (Array.isArray(config.dingtalk?.cashierActivityIds)) {
    ids.push(...config.dingtalk.cashierActivityIds);
  }
  if (ids.length === 0) {
    ids.push('1793_35c3');
  }
  return [...new Set(ids.map((id) => String(id)).filter(Boolean))];
}

export function expenseInstanceUnionSql(whereSql: string): string {
  return `
    SELECT *
    FROM (
      SELECT
        'operation' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_operation
      WHERE business_id IS NOT NULL
      UNION ALL
      SELECT
        'purchase' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_purchase
      WHERE business_id IS NOT NULL
    ) AS e
    WHERE ${whereSql}
  `;
}

export async function getPendingExpenseInstances(limit = 500): Promise<ExpenseInstanceRow[]> {
  const cashierActivityIds = getCashierActivityIdsForSql();
  const result = await db.execute<ExpenseInstanceQueryRow>(sql`
    SELECT *
    FROM (
      SELECT
        'operation' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_operation
      WHERE business_id IS NOT NULL
      UNION ALL
      SELECT
        'purchase' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_purchase
      WHERE business_id IS NOT NULL
    ) AS e
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
      WHERE (${cashierActivityIds}::text[] IS NULL OR t->>'activityId' = ANY(${cashierActivityIds}::text[]))
        AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
        AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
    )
    ORDER BY updated_at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function getStaleExpenseAgreed(limit = 80): Promise<ExpenseInstanceRow[]> {
  if (!limit || limit <= 0) {
    return [];
  }
  const cashierActivityIds = getCashierActivityIdsForSql();
  const result = await db.execute<ExpenseInstanceQueryRow>(sql`
    SELECT *
    FROM (
      SELECT
        'operation' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_operation
      WHERE business_id IS NOT NULL
      UNION ALL
      SELECT
        'purchase' AS expense_type,
        business_id,
        process_instance_id,
        raw_data,
        raw_data->>'processCode' AS process_code,
        updated_at
      FROM approval_expense_purchase
      WHERE business_id IS NOT NULL
    ) AS e
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
      WHERE (${cashierActivityIds}::text[] IS NULL OR t->>'activityId' = ANY(${cashierActivityIds}::text[]))
        AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
        AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
    )
    ORDER BY updated_at ASC NULLS FIRST
    LIMIT ${limit}
  `);
  return result.rows;
}

function decimalValue(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

export async function upsertOperationExpense(data: OperationExpenseData): Promise<number | undefined> {
  const [row] = await db.insert(approvalExpenseOperation).values({
    processInstanceId: data.processInstanceId?.substring(0, 128) || null,
    businessId: data.businessId,
    requestDate: data.requestDate || null,
    applicantDepartment: data.applicantDepartment?.substring(0, 500) || null,
    productionType: data.productionType?.substring(0, 64) || null,
    monthlyBudgetAmount: decimalValue(data.monthlyBudgetAmount),
    monthlyBudgetUsedAmount: decimalValue(data.monthlyBudgetUsedAmount),
    applicationType: data.applicationType?.substring(0, 128) || null,
    expenseType: data.expenseType?.substring(0, 128) || null,
    executionRegion: data.executionRegion?.substring(0, 128) || null,
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
    beneficiary: data.beneficiary?.substring(0, 500) || null,
    amount: decimalValue(data.amount),
    baseCurrencyAmount: decimalValue(data.baseCurrencyAmount),
    paymentTerms: data.paymentTerms?.substring(0, 255) || null,
    currency: data.currency?.substring(0, 32) || null,
    paymentDate: data.paymentDate || null,
    keyVoucher: data.keyVoucher?.substring(0, 128) || null,
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
    socialInsuranceByDepartment: data.socialInsuranceByDepartment ?? null,
    officeSpaceByDepartment: data.officeSpaceByDepartment ?? null,
    rawData: data.rawData || {}
  }).onConflictDoUpdate({
    target: approvalExpenseOperation.businessId,
    targetWhere: sql`${approvalExpenseOperation.businessId} IS NOT NULL`,
    set: {
      processInstanceId: sql`COALESCE(EXCLUDED.process_instance_id, ${approvalExpenseOperation.processInstanceId})`,
      requestDate: sql`EXCLUDED.request_date`,
      applicantDepartment: sql`EXCLUDED.applicant_department`,
      productionType: sql`EXCLUDED.production_type`,
      monthlyBudgetAmount: sql`EXCLUDED.monthly_budget_amount`,
      monthlyBudgetUsedAmount: sql`EXCLUDED.monthly_budget_used_amount`,
      applicationType: sql`EXCLUDED.application_type`,
      expenseType: sql`EXCLUDED.expense_type`,
      executionRegion: sql`EXCLUDED.execution_region`,
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
      socialInsuranceByDepartment: sql`EXCLUDED.social_insurance_by_department`,
      officeSpaceByDepartment: sql`EXCLUDED.office_space_by_department`,
      rawData: sql`EXCLUDED.raw_data`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }
  }).returning({ id: approvalExpenseOperation.id });
  return row?.id;
}

export async function upsertPurchaseExpense(data: PurchaseExpenseData): Promise<number | undefined> {
  const [row] = await db.insert(approvalExpensePurchase).values({
    processInstanceId: data.processInstanceId?.substring(0, 128) || null,
    businessId: data.businessId,
    requestDate: data.requestDate || null,
    applicantDepartment: data.applicantDepartment?.substring(0, 500) || null,
    productionType: data.productionType?.substring(0, 64) || null,
    monthlyBudgetAmount: decimalValue(data.monthlyBudgetAmount),
    monthlyBudgetUsedAmount: decimalValue(data.monthlyBudgetUsedAmount),
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
    keyVoucher: data.keyVoucher?.substring(0, 128) || null,
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
      productionType: sql`EXCLUDED.production_type`,
      monthlyBudgetAmount: sql`EXCLUDED.monthly_budget_amount`,
      monthlyBudgetUsedAmount: sql`EXCLUDED.monthly_budget_used_amount`,
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

export async function replacePurchaseItems(purchaseId: number, items: PurchaseItemData[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(approvalExpensePurchaseItems).where(eq(approvalExpensePurchaseItems.purchaseId, purchaseId));
    for (const item of items) {
      await tx.insert(approvalExpensePurchaseItems).values({
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
  });
}

export async function replacePurchaseProcessors(purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(approvalExpensePurchaseProcessors).where(eq(approvalExpensePurchaseProcessors.purchaseId, purchaseId));
    for (const p of processors) {
      await tx.insert(approvalExpensePurchaseProcessors).values({
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
