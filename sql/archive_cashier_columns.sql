-- 归档出纳列：rename 而非 DROP，保留回滚能力
-- 确认稳定后可用 ALTER TABLE ... DROP COLUMN 彻底清理

ALTER TABLE approval_instances RENAME COLUMN cashier_task_id TO _archived_cashier_task_id;
ALTER TABLE approval_instances RENAME COLUMN cashier_user_id TO _archived_cashier_user_id;
ALTER TABLE approval_instances RENAME COLUMN cashier_status TO _archived_cashier_status;
ALTER TABLE approval_instances RENAME COLUMN cashier_result TO _archived_cashier_result;
ALTER TABLE approval_instances RENAME COLUMN cashier_complete_time TO _archived_cashier_complete_time;

DROP INDEX IF EXISTS idx_cashier_status;

COMMENT ON COLUMN approval_instances._archived_cashier_status IS '已归档：出纳节点识别逻辑已移除，此列不再写入';
