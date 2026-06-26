-- 迁移：移除 approval_expense_dept_split.department_norm 列
-- department 列直接用于 ILIKE 查询，不再需要规范化列

ALTER TABLE approval_expense_dept_split DROP COLUMN IF EXISTS department_norm;

DROP INDEX IF EXISTS uk_dept_split_biz_type_dept;
CREATE UNIQUE INDEX uk_dept_split_biz_type_dept
    ON approval_expense_dept_split(business_id, split_type, department);

DROP INDEX IF EXISTS idx_dept_split_type_dept;
CREATE INDEX idx_dept_split_type_dept
    ON approval_expense_dept_split(split_type, department);
