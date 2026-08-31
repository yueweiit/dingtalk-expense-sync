import { eq, sql } from 'drizzle-orm';
import { db } from './pool.ts';
import {
  approvalExpenseMonthlySettlement,
  approvalExpenseMonthlySettlementDetails,
  approvalExpenseMonthlySettlementLinks,
} from './schema/index.ts';
import type {
  MonthlySettlementData,
  MonthlySettlementDetailData,
  MonthlySettlementLinkData,
} from './types.ts';

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function decimalValue(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function textValue(value: string | null | undefined, max: number): string | null {
  return value == null ? null : String(value).trim().substring(0, max) || null;
}

export async function upsertMonthlySettlement(
  data: MonthlySettlementData,
  details: MonthlySettlementDetailData[],
  links: MonthlySettlementLinkData[],
): Promise<number | undefined> {
  if (!data.businessId) throw new Error('businessId is required for upsertMonthlySettlement');
  const uniqueLinks = [...new Map(links.map((link) => [
    `${String(link.linkedBusinessId || '').trim()}::${String(link.linkedProcessInstanceId || '').trim()}`,
    link,
  ])).values()];

  return db.transaction(async (tx) => {
    const [row] = await tx.insert(approvalExpenseMonthlySettlement).values({
      processInstanceId: textValue(data.processInstanceId, 128),
      businessId: textValue(data.businessId, 64),
      requestDate: data.requestDate || null,
      formName: textValue(data.formName, 128),
      totalAmount: decimalValue(data.totalAmount),
      baseCurrencyAmount: decimalValue(data.baseCurrencyAmount),
      currency: textValue(data.currency, 32),
      approvalCompletedAt: data.approvalCompletedAt || null,
      approvalStatus: textValue(data.approvalStatus, 64),
      approvalResult: textValue(data.approvalResult, 32),
      approvalNo: textValue(data.approvalNo, 128),
      creatorName: textValue(data.creatorName, 255),
      applicantDepartment: textValue(data.applicantDepartment, 500),
      applicantDepartmentId: textValue(data.applicantDepartmentId, 64),
      applicantDepartmentSource: textValue(data.applicantDepartmentSource, 32),
      applicantDepartmentPathIds: data.applicantDepartmentPathIds || null,
      applicantDepartmentPathNames: data.applicantDepartmentPathNames || null,
      sourceCreatedAt: data.sourceCreatedAt || null,
      sourceUpdatedAt: data.sourceUpdatedAt || null,
      rawData: data.rawData || {},
    }).onConflictDoUpdate({
      target: approvalExpenseMonthlySettlement.businessId,
      targetWhere: sql`${approvalExpenseMonthlySettlement.businessId} IS NOT NULL`,
      set: {
        processInstanceId: sql`EXCLUDED.process_instance_id`,
        requestDate: sql`EXCLUDED.request_date`,
        formName: sql`EXCLUDED.form_name`,
        totalAmount: sql`EXCLUDED.total_amount`,
        baseCurrencyAmount: sql`EXCLUDED.base_currency_amount`,
        currency: sql`EXCLUDED.currency`,
        approvalCompletedAt: sql`EXCLUDED.approval_completed_at`,
        approvalStatus: sql`EXCLUDED.approval_status`,
        approvalResult: sql`EXCLUDED.approval_result`,
        approvalNo: sql`EXCLUDED.approval_no`,
        creatorName: sql`EXCLUDED.creator_name`,
        applicantDepartment: sql`EXCLUDED.applicant_department`,
        applicantDepartmentId: sql`EXCLUDED.applicant_department_id`,
        applicantDepartmentSource: sql`EXCLUDED.applicant_department_source`,
        applicantDepartmentPathIds: sql`EXCLUDED.applicant_department_path_ids`,
        applicantDepartmentPathNames: sql`EXCLUDED.applicant_department_path_names`,
        sourceCreatedAt: sql`EXCLUDED.source_created_at`,
        sourceUpdatedAt: sql`EXCLUDED.source_updated_at`,
        rawData: sql`EXCLUDED.raw_data`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    }).returning({ id: approvalExpenseMonthlySettlement.id });
    const settlementId = row?.id;
    if (!settlementId) return undefined;

    await tx.delete(approvalExpenseMonthlySettlementDetails)
      .where(eq(approvalExpenseMonthlySettlementDetails.settlementId, settlementId));
    if (details.length > 0) {
      await tx.insert(approvalExpenseMonthlySettlementDetails).values(details.map((detail) => ({
        settlementId,
        rowNo: detail.rowNo,
        paymentDate: detail.paymentDate || null,
        amount: decimalValue(detail.amount) || '0',
        baseCurrencyAmount: decimalValue(detail.baseCurrencyAmount),
        currency: textValue(detail.currency, 32),
        paymentReason: textValue(detail.paymentReason, 10000),
        rawData: detail.rawData || {},
      })));
    }

    await tx.delete(approvalExpenseMonthlySettlementLinks)
      .where(eq(approvalExpenseMonthlySettlementLinks.settlementId, settlementId));
    if (uniqueLinks.length > 0) {
      await tx.insert(approvalExpenseMonthlySettlementLinks).values(uniqueLinks.map((link) => ({
        settlementId,
        linkedBusinessId: textValue(link.linkedBusinessId, 64) || link.linkedBusinessId,
        linkedProcessInstanceId: textValue(link.linkedProcessInstanceId, 128),
        rawData: link.rawData || {},
      })));
    }

    await tx.update(approvalExpenseMonthlySettlement)
      .set({
        resolutionStatus: 'independent',
        resolutionNote: '关联审批单仅作审计信息，不参与月结付款归属、金额、类型或去重',
        resolvedDepartment: null,
        resolvedDepartmentId: null,
        linkedExpenseKind: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(approvalExpenseMonthlySettlement.id, settlementId));
    return settlementId;
  });
}
