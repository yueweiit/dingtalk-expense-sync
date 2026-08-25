export interface ApprovalInstanceData {
  businessId: string;
  title?: string;
  processCode?: string;
  processType?: string;
  status?: string;
  originatorUserId?: string;
  originatorDeptId?: string;
  originatorDeptName?: string;
  bizAction?: string;
  createTime?: string;
  flowResult?: string;
  department?: string;
  applyType?: string;
  expenseType?: string;
  region?: string;
  operationExpenseType?: string;
  description?: string;
  beneficiary?: string;
  amount?: number;
  paymentTerms?: string;
  currency?: string;
  baseCurrencyAmount?: number;
  paymentDate?: string;
  applyDate?: string;
  productionType?: string;
  monthlyBudget?: number;
  monthlyBudgetUsed?: number;
  processInstanceId?: string;
  rawData?: Record<string, unknown>;
}

export interface OperationExpenseData {
  processInstanceId?: string | null;
  businessId: string;
  requestDate?: string | null;
  applicantDepartment?: string | null;
  applicantDepartmentId?: string | null;
  applicantDepartmentSource?: string | null;
  applicantDepartmentPathIds?: string[] | null;
  applicantDepartmentPathNames?: string[] | null;
  productionType?: string | null;
  monthlyBudgetAmount?: number | null;
  monthlyBudgetUsedAmount?: number | null;
  monthlyBudgetRemainingAmount?: number | null;
  applicationType?: string | null;
  expenseType?: string | null;
  executionRegion?: string | null;
  businessEntity?: string | null;
  serviceEntity?: string | null;
  formName?: string | null;
  platform?: string | null;
  platformName?: string | null;
  storeName?: string | null;
  operationExpense?: string | null;
  employeeBenefitsExpense?: string | null;
  bonusExpense?: string | null;
  salaryExpense?: string | null;
  administrativeExpense?: string | null;
  vehicleUsageExpense?: string | null;
  taxExpense?: string | null;
  financeRelatedExpense?: string | null;
  salesExpense?: string | null;
  salesChannelCommissionExpense?: string | null;
  salesTeamCustomerServiceExpense?: string | null;
  otherSalesRelatedExpense?: string | null;
  marketingAdvertisingExpense?: string | null;
  matterDescription?: string | null;
  paymentDetailReason?: string | null;
  beneficiary?: string | null;
  amount?: number | null;
  baseCurrencyAmount?: number | null;
  paymentTerms?: string | null;
  currency?: string | null;
  paymentDate?: string | null;
  keyVoucher?: string | null;
  approvalCompletedAt?: string | null;
  approvalStatus?: string | null;
  currentNode?: string | null;
  currentOwner?: string | null;
  historicalApprovers?: string | null;
  approvalNo?: string | null;
  creatorName?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  creatorDepartment?: string | null;
  salaryByDepartment?: DepartmentSplitValue[] | null;
  socialInsuranceByDepartment?: DepartmentSplitValue[] | null;
  officeSpaceByDepartment?: DepartmentSplitValue[] | null;
  individualIncomeTaxByDepartment?: DepartmentSplitValue[] | null;
  rawData?: Record<string, unknown>;
}

export interface PurchaseExpenseData {
  processInstanceId?: string | null;
  businessId: string;
  requestDate?: string | null;
  applicantDepartment?: string | null;
  applicantDepartmentId?: string | null;
  applicantDepartmentSource?: string | null;
  applicantDepartmentPathIds?: string[] | null;
  applicantDepartmentPathNames?: string[] | null;
  productionType?: string | null;
  monthlyBudgetAmount?: number | null;
  monthlyBudgetUsedAmount?: number | null;
  monthlyBudgetRemainingAmount?: number | null;
  businessEntity?: string | null;
  serviceEntity?: string | null;
  formName?: string | null;
  purchaseExpense?: string | null;
  orderName?: string | null;
  projectName?: string | null;
  productName?: string | null;
  ywOemImlPhoneCase?: string | null;
  ywOemPhoneCase?: string | null;
  ywOemTabletCase?: string | null;
  ywOemSupport?: string | null;
  ywMoldesOdm?: string | null;
  consultingServices?: string | null;
  tiktokOnlineStore?: string | null;
  executionRegion?: string | null;
  orderPurchase?: string | null;
  expenseClassification?: string | null;
  investmentPurchase?: string | null;
  servicePurchase?: string | null;
  mroClassification?: string | null;
  productiveMro?: string | null;
  nonProductiveMro?: string | null;
  pdsClassification?: string | null;
  pieceworkOutsourcing?: string | null;
  logisticsTransportService?: string | null;
  customsClearanceService?: string | null;
  detailSummaryAmount?: number | null;
  baseCurrencyAmount?: number | null;
  keyVoucher?: string | null;
  approvalCompletedAt?: string | null;
  approvalStatus?: string | null;
  currentNode?: string | null;
  currentOwner?: string | null;
  historicalApprovers?: string | null;
  approvalNo?: string | null;
  creatorName?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  creatorDepartment?: string | null;
  rawData?: Record<string, unknown>;
}

export interface PurchaseItemData {
  rowNo?: number;
  itemName?: string;
  imageUrl?: string;
  itemCode?: string;
  itemSpecification?: string;
  quantity?: number;
  inventory?: number;
  unit?: string;
  unitPrice?: number;
  totalAmount?: number;
  rawData?: Record<string, unknown>;
}

export interface PurchaseProcessorData {
  rowNo?: number;
  processorName?: string;
  processorPhone?: string;
  odt?: string;
  salesOrderNo?: string;
  processingMaterial?: string;
  quantity?: number;
  unitPrice?: number;
  totalAmount?: number;
  specificationRequirementDescription?: string;
  deliveryDate?: string;
  rawData?: Record<string, unknown>;
}

export interface PurchasePaymentData {
  rowNo?: number;
  beneficiary?: string;
  amount?: number;
  paymentTerms?: string;
  currency?: string;
  paymentDate?: string;
  rawData?: Record<string, unknown>;
}

export interface PaymentEventData {
  businessId: string;
  processInstanceId?: string | null;
  expenseKind: 'operation' | 'purchase';
  paidAt: string;
  amount: number;
  baseCurrencyAmount?: number | null;
  currency?: string | null;
  sourceType: 'comment_explicit_amount' | 'manual_confirmed';
  ruleVersion: string;
  sourceUserId?: string | null;
  sourceHash: string;
  evidenceText: string;
  rawData?: Record<string, unknown> | null;
}

export interface AttachmentData {
  rowNo?: number;
  attachmentType?: string;
  fileName?: string;
  fileUrl?: string;
  rawData?: Record<string, unknown> | unknown;
}

export interface DepartmentSplitValue {
  department: string;
  departmentId?: string | null;
  departmentSource?: 'id' | 'name_only';
  departmentPathIds?: string[] | null;
  departmentPathNames?: string[] | null;
  amount: number;
  note?: string;
}

export interface DeptSplitRow extends DepartmentSplitValue {
  splitType: 'salary' | 'social_insurance' | 'office_space' | 'individual_income_tax';
}

export interface FxRateRow {
  currency: string;
  cny_per_unit: number;
  usd_per_unit: number;
  usd_cny: number;
}

export interface FxRateResult {
  rate_date: string;
  currency: string;
  cny_per_unit: number;
  usd_per_unit: number | null;
  usd_cny: number | null;
  source_url: string | null;
  fetched_at: string;
}

export interface PendingInstance {
  business_id: string;
  process_code: string;
  raw_data: Record<string, unknown>;
  process_instance_id: string | null;
}

export interface ExpenseInstanceRow {
  expense_type: string;
  business_id: string;
  process_instance_id: string | null;
  raw_data: Record<string, unknown>;
  process_code: string;
  updated_at: string;
}

// Drizzle schema inferred types
import type {
  approvalInstances,
  syncState,
  fxRatesDaily,
  approvalExpenseOperation,
  approvalExpensePurchase,
  approvalExpensePurchaseItems,
  approvalExpensePurchaseProcessors,
  approvalExpensePurchasePayments,
  approvalExpensePaymentEvents,
  approvalExpenseAttachments,
  approvalExpenseDeptSplit,
} from './schema/index.ts';

export type ApprovalInstance = typeof approvalInstances.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
export type FxRateDaily = typeof fxRatesDaily.$inferSelect;
export type OperationExpense = typeof approvalExpenseOperation.$inferSelect;
export type PurchaseExpense = typeof approvalExpensePurchase.$inferSelect;
export type PurchaseItem = typeof approvalExpensePurchaseItems.$inferSelect;
export type PurchaseProcessor = typeof approvalExpensePurchaseProcessors.$inferSelect;
export type PurchasePayment = typeof approvalExpensePurchasePayments.$inferSelect;
export type PaymentEvent = typeof approvalExpensePaymentEvents.$inferSelect;
export type Attachment = typeof approvalExpenseAttachments.$inferSelect;
export type DeptSplit = typeof approvalExpenseDeptSplit.$inferSelect;
