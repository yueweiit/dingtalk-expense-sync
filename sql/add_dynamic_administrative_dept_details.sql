-- Existing-database migration for dynamic management-expense department details.
-- Safe to run repeatedly before deploying the matching application code.

-- The application still reads this legacy field for historical compatibility.
-- Add it here as well so older databases can adopt the dynamic migration directly.
ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS office_equipment_by_department JSONB;

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS administrative_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.administrative_by_department
IS '管理费用动态分部门明细 — JSON array of {department, amount, note, categoryKey, categoryName}';

ALTER TABLE approval_expense_dept_split
ADD COLUMN IF NOT EXISTS category_key VARCHAR(255);

ALTER TABLE approval_expense_dept_split
ADD COLUMN IF NOT EXISTS category_name VARCHAR(500);

ALTER TABLE approval_expense_dept_split
DROP CONSTRAINT IF EXISTS approval_expense_dept_split_split_type_check;

ALTER TABLE approval_expense_dept_split
ADD CONSTRAINT approval_expense_dept_split_split_type_check
CHECK (split_type IN ('salary', 'bonus', 'office_equipment', 'social_insurance', 'office_space', 'individual_income_tax', 'administrative', 'it_operation', 'manual_company_allocation'));

DO $$
DECLARE index_definition TEXT;
BEGIN
  SELECT indexdef INTO index_definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uk_dept_split_biz_type_dept';

  IF index_definition IS NOT NULL
     AND index_definition NOT LIKE '%(business_id, split_type, category_key, department_id, department)%' THEN
    DROP INDEX uk_dept_split_biz_type_dept;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uk_dept_split_biz_type_dept
ON approval_expense_dept_split(business_id, split_type, category_key, department_id, department);
