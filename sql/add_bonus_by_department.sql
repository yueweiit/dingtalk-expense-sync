-- 为已有 OA 数据库补充奖金分部门明细列。
-- 幂等执行，不改动历史数据；新列与 salary_by_department 使用相同 JSONB 结构。
ALTER TABLE approval_expense_operation
  ADD COLUMN IF NOT EXISTS bonus_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.bonus_by_department
  IS '奖金分部门明细 - JSON array of {department, amount, note}';

-- 单独执行本迁移时，也同步放行奖金拆分类型；重复执行安全。
DO $$
BEGIN
  IF to_regclass('public.approval_expense_dept_split') IS NOT NULL THEN
    ALTER TABLE approval_expense_dept_split
      DROP CONSTRAINT IF EXISTS approval_expense_dept_split_split_type_check;
    ALTER TABLE approval_expense_dept_split
      ADD CONSTRAINT approval_expense_dept_split_split_type_check
      CHECK (split_type IN ('salary', 'bonus', 'social_insurance', 'office_space', 'individual_income_tax', 'it_operation', 'manual_company_allocation'));
  END IF;
END $$;
