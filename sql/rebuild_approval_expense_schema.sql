-- Rebuild only the approval_expense_* standalone business tables.
-- This intentionally drops the newly-created approval_expense_* tables.
-- It does not touch approval_instances, fx_rates_daily, sync_state, or any existing runtime table.

DROP TABLE IF EXISTS approval_expense_attachments CASCADE;
DROP TABLE IF EXISTS approval_expense_purchase_payments CASCADE;
DROP TABLE IF EXISTS approval_expense_purchase_processors CASCADE;
DROP TABLE IF EXISTS approval_expense_purchase_items CASCADE;
DROP TABLE IF EXISTS approval_expense_purchase CASCADE;
DROP TABLE IF EXISTS approval_expense_operation CASCADE;
