-- 社保中国分部门明细
ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS social_insurance_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.social_insurance_by_department
IS '社保中国分部门明细 — JSON array of {department, amount}';

-- 办公场地总费用分部门明细
ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS office_space_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.office_space_by_department
IS '办公场地总费用分部门明细 — JSON array of {department, amount}';
