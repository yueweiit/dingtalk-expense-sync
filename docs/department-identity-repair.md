# Department Identity Repair (部门身份回填)

## Purpose (目的)

`dingtalk-budget` (预算项目) uses a department ID (部门 ID) plus a department-path snapshot (部门路径快照) to present a reliable reporting department. A record without either a department ID or a path containing `YUEWEI` is displayed as `待确认` (待确认部门).

The OA department tree (`dingtalk_oa.ding_department_tree`, OA 部门树) retains old organization nodes after a reorganization, but marks them with `is_current = false`. Historical expenses can therefore have a valid old department ID while no path was written during synchronization.

## Snapshot Resolution (路径选择规则)

`src/oa-source.ts` resolves a path only by an exact `dept_id` (部门 ID) match:

1. Use one unique current (`is_current = true`) department-tree row first.
2. If there is no current row, use one unique historical (`is_current = false`) row.
3. Require a non-empty name, `path_ids` (部门 ID 路径), and `path_names` (部门名称路径).
4. If the ID has multiple matching rows, do not guess and do not fall back by department name.

This keeps new form data correct while allowing old, archived department IDs to retain their original reporting path.

## Historical Repair (历史回填)

The repair command processes only a bounded date range. It can repair both a missing `applicant_department_id` (申请部门 ID) and a missing department-path snapshot.

It may update only these fields in `dingtalk_approval` (审批支出库):

- `approval_expense_operation` (运营支出主表) and `approval_expense_purchase` (采购支出主表): department ID, source, path IDs, path names, and `updated_at` (更新时间).
- `approval_expense_dept_split` (部门拆分表): the equivalent split department fields.

It never changes amount fields, approval statuses, raw payloads, attachments, or purchase details. It does not run `DELETE`, `TRUNCATE`, or `DROP`.

### Dry Run (只读预演)

```bash
npm run repair:expense-department-identities -- --start=2026-07-01 --end=2026-07-31
```

### Write Mode (写入模式)

`--write=1` requires a new absolute backup path. The script writes a JSON snapshot of every repairable record before making any update.

```bash
mkdir -p /www/backup
npm run repair:expense-department-identities -- --start=2026-07-01 --end=2026-07-31 --write=1 --backup=/www/backup/department-path-repair-$(date +%Y%m%d-%H%M%S).json
```

Run the dry run on the target environment first. A record without a department ID, or an ID that has no unique usable department-tree path, is skipped for manual confirmation.

## Deployment Notes (部署说明)

Deploy `dingtalk-expense-sync` (审批支出同步项目) before running the repair. `dingtalk-oa` (OA 项目) does not need a code deployment for this change, but its database must retain the historical department-tree rows. After server-side repair, restart the `dingtalk-budget` (预算项目) Node service or wait for its 60-second report cache to expire before refreshing the report.
