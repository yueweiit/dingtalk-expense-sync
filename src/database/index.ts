import { pool } from './pool.ts';
import * as approval from './approval.ts';
import * as expense from './expense.ts';
import * as fx from './fx.ts';
import type {
  ApprovalInstanceData,
  OperationExpenseData,
  PurchaseExpenseData,
  PurchaseItemData,
  PurchaseProcessorData,
  PurchasePaymentData,
  PaymentEventData,
  AttachmentData,
  FxRateRow,
  FxRateResult,
  PendingInstance,
  ExpenseInstanceRow,
  DeptSplitRow,
} from './types.ts';

class Database {
  // ==================== approval ====================
  async ensureProcessInstanceIdColumn(): Promise<void> {
    return approval.ensureProcessInstanceIdColumn();
  }

  async ensureBaseCurrencyAmountColumn(): Promise<void> {
    return approval.ensureBaseCurrencyAmountColumn();
  }

  async ensureSyncStateTable(): Promise<void> {
    return approval.ensureSyncStateTable();
  }

  async ensureApprovalExpenseSchema(): Promise<void> {
    return approval.ensureApprovalExpenseSchema();
  }

  async getSyncCursor(taskName: string): Promise<number | null> {
    return approval.getSyncCursor(taskName);
  }

  async setSyncCursor(taskName: string, timestampMs: number): Promise<void> {
    return approval.setSyncCursor(taskName, timestampMs);
  }

  async upsertApprovalInstance(data: ApprovalInstanceData): Promise<boolean> {
    return approval.upsertApprovalInstance(data);
  }

  async getLastUpdateTime(): Promise<string | null> {
    return approval.getLastUpdateTime();
  }

  async getPendingInstances(limit?: number): Promise<PendingInstance[]> {
    return approval.getPendingInstances(limit);
  }

  async getStaleAgreed(limit?: number): Promise<PendingInstance[]> {
    return approval.getStaleAgreed(limit);
  }

  async existsByBusinessId(businessId: string): Promise<boolean> {
    return approval.existsByBusinessId(businessId);
  }

  // ==================== expense ====================
  async getPendingExpenseInstances(limit?: number): Promise<ExpenseInstanceRow[]> {
    return expense.getPendingExpenseInstances(limit);
  }

  async getStaleExpenseAgreed(limit?: number): Promise<ExpenseInstanceRow[]> {
    return expense.getStaleExpenseAgreed(limit);
  }

  async upsertOperationExpense(data: OperationExpenseData): Promise<number | undefined> {
    return expense.upsertOperationExpense(data);
  }

  async upsertPurchaseExpense(data: PurchaseExpenseData): Promise<number | undefined> {
    return expense.upsertPurchaseExpense(data);
  }

  async replacePurchaseItems(purchaseId: number, items: PurchaseItemData[]): Promise<void> {
    return expense.replacePurchaseItems(purchaseId, items);
  }

  async replacePurchaseProcessors(purchaseId: number, processors: PurchaseProcessorData[]): Promise<void> {
    return expense.replacePurchaseProcessors(purchaseId, processors);
  }

  async replacePurchaseDetails(
    purchaseId: number,
    details: { items: PurchaseItemData[]; processors: PurchaseProcessorData[] }
  ): Promise<void> {
    return expense.replacePurchaseDetails(purchaseId, details);
  }

  async replacePurchasePayments(purchaseId: number, payments: PurchasePaymentData[]): Promise<void> {
    return expense.replacePurchasePayments(purchaseId, payments);
  }

  async insertPaymentEvents(events: PaymentEventData[]): Promise<number> {
    return expense.insertPaymentEvents(events);
  }

  async replaceAttachments(parentType: string, parentId: number, attachments: AttachmentData[]): Promise<void> {
    return expense.replaceAttachments(parentType, parentId, attachments);
  }

  async upsertOperationExpenseWithSplits(data: OperationExpenseData, splits: DeptSplitRow[]): Promise<number | undefined> {
    return expense.upsertOperationExpenseWithSplits(data, splits);
  }

  async rebuildDeptSplits(businessId: string): Promise<number> {
    return expense.rebuildDeptSplits(businessId);
  }

  async rebuildAllDeptSplits(): Promise<{ total: number; rebuilt: number }> {
    return expense.rebuildAllDeptSplits();
  }

  async backfillDeptSplits(): Promise<{ total: number; rebuilt: number }> {
    return expense.backfillDeptSplits();
  }

  // ==================== fx ====================
  async ensureFxRatesDailyTable(): Promise<void> {
    return fx.ensureFxRatesDailyTable();
  }

  async countFxRatesForDate(rateDateStr: string): Promise<number> {
    return fx.countFxRatesForDate(rateDateStr);
  }

  async replaceFxRatesForDate(rateDateStr: string, rows: FxRateRow[], sourceUrl: string | null): Promise<void> {
    return fx.replaceFxRatesForDate(rateDateStr, rows, sourceUrl);
  }

  async getLatestFxRate(isoUpper: string, rateDateStr?: string | null): Promise<FxRateResult | null> {
    return fx.getLatestFxRate(isoUpper, rateDateStr);
  }

  async getCnyPerUnitForSubmissionDate(isoUpper: string, submissionDateYmd: string): Promise<number | null> {
    return fx.getCnyPerUnitForSubmissionDate(isoUpper, submissionDateYmd);
  }

  // ==================== lifecycle ====================
  async close(): Promise<void> {
    await pool.end();
  }
}

const db = new Database();
export default db;
export { pool };
