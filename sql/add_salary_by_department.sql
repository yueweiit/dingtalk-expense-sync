-- 添加工资中国分部门明细列
ALTER TABLE approval_expense_operation 
ADD COLUMN IF NOT EXISTS salary_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.salary_by_department 
IS '工资中国分部门明细 — JSON array of {department, amount, note}';
