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
  AttachmentData,
  FxRateRow,
  FxRateResult,
  PendingInstance,
  ExpenseInstanceRow
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

  async isCashierApproved(businessId: string): Promise<boolean> {
    return approval.isCashierApproved(businessId);
  }

  async getLastUpdateTime(): Promise<string | null> {
    return approval.getLastUpdateTime();
  }

  async getPendingInstances(limit?: number): Promise<PendingInstance[]> {
    return approval.getPendingInstances(limit);
  }

  async getStaleCashierAgreed(limit?: number): Promise<PendingInstance[]> {
    return approval.getStaleCashierAgreed(limit);
  }

  async existsByBusinessId(businessId: string): Promise<boolean> {
    return approval.existsByBusinessId(businessId);
  }

  // ==================== expense ====================
  getCashierActivityIdsForSql(): string[] {
    return expense.getCashierActivityIdsForSql();
  }

  expenseInstanceUnionSql(whereSql: string): string {
    return expense.expenseInstanceUnionSql(whereSql);
  }

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

  async replacePurchasePayments(purchaseId: number, payments: PurchasePaymentData[]): Promise<void> {
    return expense.replacePurchasePayments(purchaseId, payments);
  }

  async replaceAttachments(parentType: string, parentId: number, attachments: AttachmentData[]): Promise<void> {
    return expense.replaceAttachments(parentType, parentId, attachments);
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
