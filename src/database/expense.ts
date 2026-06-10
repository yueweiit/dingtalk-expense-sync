import { PoolClient, QueryResult } from 'pg';
import { pool } from './pool.js';
import config from '../config.js';
import {
  OperationExpenseData,
  PurchaseExpenseData,
  PurchaseItemData,
  PurchaseProcessorData,
  PurchasePaymentData,
  AttachmentData,
  ExpenseInstanceRow
} from './types.js';

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
  const client: PoolClient = await pool.connect();
  try {
    const cashierActivityIds = getCashierActivityIdsForSql();
    const result: QueryResult<ExpenseInstanceRow> = await client.query(
      `
        ${expenseInstanceUnionSql(`
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
            WHERE ($2::text[] IS NULL OR t->>'activityId' = ANY($2::text[]))
              AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
              AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
          )
        `)}
        ORDER BY updated_at DESC NULLS LAST
        LIMIT $1
      `,
      [limit, cashierActivityIds]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getStaleExpenseAgreed(limit = 80): Promise<ExpenseInstanceRow[]> {
  if (!limit || limit <= 0) {
    return [];
  }
  const client: PoolClient = await pool.connect();
  try {
    const cashierActivityIds = getCashierActivityIdsForSql();
    const result: QueryResult<ExpenseInstanceRow> = await client.query(
      `
        ${expenseInstanceUnionSql(`
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(e.raw_data->'tasks', '[]'::jsonb)) AS t
            WHERE ($2::text[] IS NULL OR t->>'activityId' = ANY($2::text[]))
              AND UPPER(COALESCE(t->>'status', '')) = 'COMPLETED'
              AND UPPER(COALESCE(t->>'result', '')) = 'AGREE'
          )
        `)}
        ORDER BY updated_at ASC NULLS FIRST
        LIMIT $1
      `,
      [limit, cashierActivityIds]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function upsertOperationExpense(data: OperationExpenseData): Promise<number | undefined> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `
      INSERT INTO approval_expense_operation (
        process_instance_id, business_id, request_date, applicant_department,
        production_type, monthly_budget_amount, monthly_budget_used_amount,
        application_type, expense_type, execution_region,
        operation_expense, employee_benefits_expense, bonus_expense, salary_expense,
        administrative_expense, vehicle_usage_expense, tax_expense, finance_related_expense,
        sales_expense, sales_channel_commission_expense, sales_team_customer_service_expense,
        other_sales_related_expense, marketing_advertising_expense,
        matter_description, beneficiary, amount, base_currency_amount, payment_terms, currency, payment_date, key_voucher,
        approval_completed_at, approval_status, current_node, current_owner,
        historical_approvers, approval_no, creator_name,
        source_created_at, source_updated_at, creator_department,
        salary_by_department,
        raw_data
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
      )
      ON CONFLICT (business_id) WHERE business_id IS NOT NULL DO UPDATE SET
        process_instance_id = COALESCE(EXCLUDED.process_instance_id, approval_expense_operation.process_instance_id),
        request_date = EXCLUDED.request_date,
        applicant_department = EXCLUDED.applicant_department,
        production_type = EXCLUDED.production_type,
        monthly_budget_amount = EXCLUDED.monthly_budget_amount,
        monthly_budget_used_amount = EXCLUDED.monthly_budget_used_amount,
        application_type = EXCLUDED.application_type,
        expense_type = EXCLUDED.expense_type,
        execution_region = EXCLUDED.execution_region,
        operation_expense = EXCLUDED.operation_expense,
        employee_benefits_expense = EXCLUDED.employee_benefits_expense,
        bonus_expense = EXCLUDED.bonus_expense,
        salary_expense = EXCLUDED.salary_expense,
        administrative_expense = EXCLUDED.administrative_expense,
        vehicle_usage_expense = EXCLUDED.vehicle_usage_expense,
        tax_expense = EXCLUDED.tax_expense,
        finance_related_expense = EXCLUDED.finance_related_expense,
        sales_expense = EXCLUDED.sales_expense,
        sales_channel_commission_expense = EXCLUDED.sales_channel_commission_expense,
        sales_team_customer_service_expense = EXCLUDED.sales_team_customer_service_expense,
        other_sales_related_expense = EXCLUDED.other_sales_related_expense,
        marketing_advertising_expense = EXCLUDED.marketing_advertising_expense,
        matter_description = EXCLUDED.matter_description,
        beneficiary = EXCLUDED.beneficiary,
        amount = EXCLUDED.amount,
        base_currency_amount = EXCLUDED.base_currency_amount,
        payment_terms = EXCLUDED.payment_terms,
        currency = EXCLUDED.currency,
        payment_date = EXCLUDED.payment_date,
        key_voucher = EXCLUDED.key_voucher,
        approval_completed_at = EXCLUDED.approval_completed_at,
        approval_status = EXCLUDED.approval_status,
        current_node = EXCLUDED.current_node,
        current_owner = EXCLUDED.current_owner,
        historical_approvers = EXCLUDED.historical_approvers,
        approval_no = EXCLUDED.approval_no,
        creator_name = EXCLUDED.creator_name,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        creator_department = EXCLUDED.creator_department,
        salary_by_department = EXCLUDED.salary_by_department,
        raw_data = EXCLUDED.raw_data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result: QueryResult<{ id: number }> = await client.query(query, [
      data.processInstanceId?.substring(0, 128) || null,
      data.businessId,
      data.requestDate || null,
      data.applicantDepartment?.substring(0, 500) || null,
      data.productionType?.substring(0, 64) || null,
      data.monthlyBudgetAmount ?? null,
      data.monthlyBudgetUsedAmount ?? null,
      data.applicationType?.substring(0, 128) || null,
      data.expenseType?.substring(0, 128) || null,
      data.executionRegion?.substring(0, 128) || null,
      data.operationExpense?.substring(0, 128) || null,
      data.employeeBenefitsExpense?.substring(0, 128) || null,
      data.bonusExpense?.substring(0, 128) || null,
      data.salaryExpense?.substring(0, 128) || null,
      data.administrativeExpense?.substring(0, 128) || null,
      data.vehicleUsageExpense?.substring(0, 128) || null,
      data.taxExpense?.substring(0, 128) || null,
      data.financeRelatedExpense?.substring(0, 128) || null,
      data.salesExpense?.substring(0, 128) || null,
      data.salesChannelCommissionExpense?.substring(0, 128) || null,
      data.salesTeamCustomerServiceExpense?.substring(0, 128) || null,
      data.otherSalesRelatedExpense?.substring(0, 128) || null,
      data.marketingAdvertisingExpense?.substring(0, 128) || null,
      data.matterDescription?.substring(0, 5000) || null,
      data.beneficiary?.substring(0, 500) || null,
      data.amount ?? null,
      data.baseCurrencyAmount ?? null,
      data.paymentTerms?.substring(0, 255) || null,
      data.currency?.substring(0, 32) || null,
      data.paymentDate || null,
      data.keyVoucher?.substring(0, 128) || null,
      data.approvalCompletedAt || null,
      data.approvalStatus?.substring(0, 32) || null,
      data.currentNode?.substring(0, 256) || null,
      data.currentOwner?.substring(0, 256) || null,
      data.historicalApprovers?.substring(0, 5000) || null,
      data.approvalNo?.substring(0, 128) || null,
      data.creatorName?.substring(0, 256) || null,
      data.sourceCreatedAt || null,
      data.sourceUpdatedAt || null,
      data.creatorDepartment?.substring(0, 500) || null,
      data.salaryByDepartment ? JSON.stringify(data.salaryByDepartment) : null,
      JSON.stringify(data.rawData || {})
    ]);
    return result.rows[0]?.id;
  } finally {
    client.release();
  }
}

export async function upsertPurchaseExpense(data: PurchaseExpenseData): Promise<number | undefined> {
  const client: PoolClient = await pool.connect();
  try {
    const query = `
      INSERT INTO approval_expense_purchase (
        process_instance_id, business_id, request_date, applicant_department,
        production_type, monthly_budget_amount, monthly_budget_used_amount,
        purchase_expense, order_name, project_name, product_name,
        yw_oem_iml_phone_case, yw_oem_phone_case, yw_oem_tablet_case, yw_oem_support,
        yw_moldes_odm, consulting_services, tiktok_online_store,
        execution_region, order_purchase, expense_classification,
        investment_purchase, service_purchase, mro_classification,
        productive_mro, non_productive_mro, pds_classification,
        piecework_outsourcing, logistics_transport_service, customs_clearance_service,
        detail_summary_amount, base_currency_amount, key_voucher,
        approval_completed_at, approval_status, current_node, current_owner,
        historical_approvers, approval_no, creator_name,
        source_created_at, source_updated_at, creator_department,
        raw_data
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44
      )
      ON CONFLICT (business_id) WHERE business_id IS NOT NULL DO UPDATE SET
        process_instance_id = COALESCE(EXCLUDED.process_instance_id, approval_expense_purchase.process_instance_id),
        request_date = EXCLUDED.request_date,
        applicant_department = EXCLUDED.applicant_department,
        production_type = EXCLUDED.production_type,
        monthly_budget_amount = EXCLUDED.monthly_budget_amount,
        monthly_budget_used_amount = EXCLUDED.monthly_budget_used_amount,
        purchase_expense = EXCLUDED.purchase_expense,
        order_name = EXCLUDED.order_name,
        project_name = EXCLUDED.project_name,
        product_name = EXCLUDED.product_name,
        yw_oem_iml_phone_case = EXCLUDED.yw_oem_iml_phone_case,
        yw_oem_phone_case = EXCLUDED.yw_oem_phone_case,
        yw_oem_tablet_case = EXCLUDED.yw_oem_tablet_case,
        yw_oem_support = EXCLUDED.yw_oem_support,
        yw_moldes_odm = EXCLUDED.yw_moldes_odm,
        consulting_services = EXCLUDED.consulting_services,
        tiktok_online_store = EXCLUDED.tiktok_online_store,
        execution_region = EXCLUDED.execution_region,
        order_purchase = EXCLUDED.order_purchase,
        expense_classification = EXCLUDED.expense_classification,
        investment_purchase = EXCLUDED.investment_purchase,
        service_purchase = EXCLUDED.service_purchase,
        mro_classification = EXCLUDED.mro_classification,
        productive_mro = EXCLUDED.productive_mro,
        non_productive_mro = EXCLUDED.non_productive_mro,
        pds_classification = EXCLUDED.pds_classification,
        piecework_outsourcing = EXCLUDED.piecework_outsourcing,
        logistics_transport_service = EXCLUDED.logistics_transport_service,
        customs_clearance_service = EXCLUDED.customs_clearance_service,
        detail_summary_amount = EXCLUDED.detail_summary_amount,
        base_currency_amount = EXCLUDED.base_currency_amount,
        key_voucher = EXCLUDED.key_voucher,
        approval_completed_at = EXCLUDED.approval_completed_at,
        approval_status = EXCLUDED.approval_status,
        current_node = EXCLUDED.current_node,
        current_owner = EXCLUDED.current_owner,
        historical_approvers = EXCLUDED.historical_approvers,
        approval_no = EXCLUDED.approval_no,
        creator_name = EXCLUDED.creator_name,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        creator_department = EXCLUDED.creator_department,
        raw_data = EXCLUDED.raw_data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result: QueryResult<{ id: number }> = await client.query(query, [
      data.processInstanceId?.substring(0, 128) || null,
      data.businessId,
      data.requestDate || null,
      data.applicantDepartment?.substring(0, 500) || null,
      data.productionType?.substring(0, 64) || null,
      data.monthlyBudgetAmount ?? null,
      data.monthlyBudgetUsedAmount ?? null,
      data.purchaseExpense?.substring(0, 128) || null,
      data.orderName?.substring(0, 256) || null,
      data.projectName?.substring(0, 256) || null,
      data.productName?.substring(0, 256) || null,
      data.ywOemImlPhoneCase?.substring(0, 128) || null,
      data.ywOemPhoneCase?.substring(0, 128) || null,
      data.ywOemTabletCase?.substring(0, 128) || null,
      data.ywOemSupport?.substring(0, 128) || null,
      data.ywMoldesOdm?.substring(0, 128) || null,
      data.consultingServices?.substring(0, 128) || null,
      data.tiktokOnlineStore?.substring(0, 128) || null,
      data.executionRegion?.substring(0, 128) || null,
      data.orderPurchase?.substring(0, 128) || null,
      data.expenseClassification?.substring(0, 128) || null,
      data.investmentPurchase?.substring(0, 128) || null,
      data.servicePurchase?.substring(0, 128) || null,
      data.mroClassification?.substring(0, 128) || null,
      data.productiveMro?.substring(0, 128) || null,
      data.nonProductiveMro?.substring(0, 128) || null,
      data.pdsClassification?.substring(0, 128) || null,
      data.pieceworkOutsourcing?.substring(0, 128) || null,
      data.logisticsTransportService?.substring(0, 128) || null,
      data.customsClearanceService?.substring(0, 128) || null,
      data.detailSummaryAmount ?? null,
      data.baseCurrencyAmount ?? null,
      data.keyVoucher?.substring(0, 128) || null,
      data.approvalCompletedAt || null,
      data.approvalStatus?.substring(0, 32) || null,
      data.currentNode?.substring(0, 256) || null,
      data.currentOwner?.substring(0, 256) || null,
      data.historicalApprovers?.substring(0, 5000) || null,
      data.approvalNo?.substring(0, 128) || null,
      data.creatorName?.substring(0, 256) || null,
      data.sourceCreatedAt || null,
      data.sourceUpdatedAt || null,
      data.creatorDepartment?.substring(0, 500) || null,
      JSON.stringify(data.rawData || {})
    ]);
    return result.rows[0]?.id;
  } finally {
    client.release();
  }
}

export async function replacePurchaseItems(purchaseId: number, items: PurchaseItemData[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('DELETE FROM approval_expense_purchase_items WHERE purchase_id = $1', [purchaseId]);
    for (const item of items) {
      await client.query(
        `
          INSERT INTO approval_expense_purchase_items (
            purchase_id, row_no, item_name, image_url, item_code, item_specification,
            quantity, inventory, unit, unit_price, total_amount, raw_data
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          purchaseId,
          item.rowNo || 1,
          item.itemName?.substring(0, 500) || null,
          item.imageUrl || null,
          item.itemCode?.substring(0, 128) || null,
          item.itemSpecification || null,
          item.quantity ?? null,
          item.inventory ?? null,
          item.unit?.substring(0, 64) || null,
          item.unitPrice ?? null,
          item.totalAmount ?? null,
          JSON.stringify(item.rawData || {})
        ]
      );
    }
  } finally {
    client.release();
  }
}

export async function replacePurchaseProcessors(purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('DELETE FROM approval_expense_purchase_processors WHERE purchase_id = $1', [purchaseId]);
    for (const p of processors) {
      await client.query(
        `
          INSERT INTO approval_expense_purchase_processors (
            purchase_id, row_no, processor_name, processor_phone, odt,
            sales_order_no, processing_material, quantity, unit_price, total_amount,
            specification_requirement_description, delivery_date, raw_data
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13)
        `,
        [
          purchaseId,
          p.rowNo || 1,
          p.processorName?.substring(0, 500) || null,
          p.processorPhone?.substring(0, 64) || null,
          p.odt?.substring(0, 128) || null,
          p.salesOrderNo?.substring(0, 128) || null,
          p.processingMaterial || null,
          p.quantity ?? null,
          p.unitPrice ?? null,
          p.totalAmount ?? null,
          p.specificationRequirementDescription || null,
          p.deliveryDate || null,
          JSON.stringify(p.rawData || {})
        ]
      );
    }
  } finally {
    client.release();
  }
}

export async function replacePurchasePayments(purchaseId: number, payments: PurchasePaymentData[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('DELETE FROM approval_expense_purchase_payments WHERE purchase_id = $1', [purchaseId]);
    for (const p of payments) {
      await client.query(
        `
          INSERT INTO approval_expense_purchase_payments (
            purchase_id, row_no, beneficiary, amount, payment_terms, currency, payment_date, raw_data
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8)
        `,
        [
          purchaseId,
          p.rowNo || 1,
          p.beneficiary?.substring(0, 500) || null,
          p.amount ?? null,
          p.paymentTerms?.substring(0, 255) || null,
          p.currency?.substring(0, 32) || null,
          p.paymentDate || null,
          JSON.stringify(p.rawData || {})
        ]
      );
    }
  } finally {
    client.release();
  }
}

export async function replaceAttachments(parentType: string, parentId: number, attachments: AttachmentData[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(
      'DELETE FROM approval_expense_attachments WHERE parent_type = $1 AND parent_id = $2',
      [parentType, parentId]
    );
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      await client.query(
        `
          INSERT INTO approval_expense_attachments (
            parent_type, parent_id, row_no, attachment_type, file_name, file_url, raw_data
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          parentType,
          parentId,
          a.rowNo || i + 1,
          a.attachmentType?.substring(0, 64) || null,
          a.fileName?.substring(0, 500) || null,
          a.fileUrl || null,
          JSON.stringify(a.rawData || {})
        ]
      );
    }
  } finally {
    client.release();
  }
}
