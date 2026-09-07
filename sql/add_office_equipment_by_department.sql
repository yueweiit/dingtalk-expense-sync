-- Existing-database migration for the office-equipment department split.
-- Safe to run repeatedly before deploying the matching application code.

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS office_equipment_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.office_equipment_by_department
IS '办公设备分部门明细 — JSON array of {department, amount, note}';

ALTER TABLE approval_expense_dept_split
DROP CONSTRAINT IF EXISTS approval_expense_dept_split_split_type_check;

ALTER TABLE approval_expense_dept_split
ADD CONSTRAINT approval_expense_dept_split_split_type_check
CHECK (split_type IN ('salary', 'bonus', 'office_equipment', 'social_insurance', 'office_space', 'individual_income_tax', 'it_operation', 'manual_company_allocation'));

COMMENT ON COLUMN approval_expense_dept_split.split_type
IS '拆分类型：salary/bonus/office_equipment/social_insurance/office_space/individual_income_tax/it_operation/manual_company_allocation';
