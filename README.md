# 钉钉审批数据同步服务

定时获取钉钉运营&采购支出审批数据并存储到 PostgreSQL，提供 HTTP API 查询。

## 功能特性

- **定时同步**：自动拉取钉钉审批实例（运营支出、采购支出）
- **增量同步**：基于游标的增量拉取，支持断点续传
- **补偿机制**：按 OA `updated_at`（更新时间）增量同步，并以 2 小时重叠窗口和每日 7 天核对兜底晚到、状态变化或漏入库的审批
- **汇率转换**：自动同步汇率并转换为人民币基準货币
- **结构化存储**：将审批表单数据解析为结构化字段
- **工资分部门**：支持工资中国按部门拆分存储

## 快速开始

### 1. 环境要求

- Node.js >= 18
- PostgreSQL >= 14

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 填入实际值：

```env
# 必填 - 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=dingtalk_approval
DB_USER=postgres
DB_PASSWORD=your_password

# 必填 - 钉钉应用凭证
DINGTALK_APPKEY=your_appkey
DINGTALK_APPSECRET=your_appsecret
```

### 4. 初始化数据库

```bash
# 创建表结构
psql -f sql/ensure_approval_expense_schema.sql
psql -f sql/ensure_fx_rates_daily.sql

# 添加工资分部门字段（如需要）
psql -f sql/add_salary_by_department.sql
```

### 5. 启动服务

```bash
# 生产模式
npm start

# 开发模式（自动重启）
npm run dev
```

服务默认运行在 `http://localhost:3002`

## 配置说明

### 配置优先级

```
环境变量（.env / 系统环境变量）
    ↓
config.json
    ↓
代码默认值
```

### config.json

```json
{
  "dingtalk": {
    "processTypeMap": {
      "operation": [
        "PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA",
        "PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD",
        "PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8",
        "PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B"
      ],
      "purchase": [
        "PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B",
        "PROC-6E11B527-2F82-439C-817D-C868DE086C97",
        "PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF",
        "PROC-E69FCD3E-E374-4C54-9D8F-6E1F55AD741F"
      ]
    }
  },
  "scheduler": {
    "cron": "7,37 * * * *",
    "startTime": "2026-04-01T00:00:00+08:00",
    "compensationCron": "17 3 * * *",
    "fxRatesCron": "5 0 * * *"
  },
  "server": {
    "port": 3002
  }
}
```

`processTypeMap` 是唯一流程配置来源。十四个现有流程码必须全部在正确分组中；缺失、错分、重复或继续配置旧 `processCodes` 都会导致项目拒绝启动。

### 定时任务配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `scheduler.cron` | 增量同步频率 | `7,37 * * * *`（每小时第7分和第37分执行，间隔30分钟） |
| `scheduler.startTime` | 首次同步起始时间 | `2026-04-01T00:00:00+08:00` |
| `scheduler.oaUpdatedAtInitialLookbackDays` | 首次按 OA 更新时间发现表单时的回看天数 | `45` |
| `scheduler.oaUpdatedAtOverlapMinutes` | OA 更新时间窗口重叠分钟数，避免边界和延迟到达漏单 | `120` |
| `scheduler.oaUpdatedAtDailyReconciliationLookbackDays` | 每日补偿前按 OA 更新时间核对的最近天数 | `7` |
| `scheduler.compensationCron` | 补偿任务频率 | `17 3 * * *`（每天凌晨3:17） |
| `scheduler.fxRatesCron` | 汇率同步频率 | `5 0 * * *`（每天凌晨0:05） |

### 实际支出统计口径

- 实际支出只统计整单 `COMPLETED`（已完成）且最终结果为同意/通过的审批，并要求存在 `approval_completed_at`（审批完成时间）。
- 最终结果优先读取 OA 原始数据的 `result`；仅当它为空时，才兼容回退到旧的 `flowResult`、`flow_result` 字段。
- 实际支出归属月份使用 `approval_completed_at` 的 UTC（世界协调时间）月份；预算申请金额仍沿用原提交时间和原有效状态口径。
- 不再根据出纳节点、付款节点、`activityId`（节点 ID）、`bizAction`（业务动作）或历史任务中曾经出现的驳回判断实际支出。
- 每半小时增量同步按 OA 更新时间回看最近 2 小时；每日补偿任务先核对最近 7 天 OA 更新时间窗口，再刷新已进入审批支出库的待处理记录。两类任务互斥执行。

## API 接口

### 健康检查

```
GET /health
```

### 手动同步

```
POST /api/sync/manual
```

触发一次运营/采购支出增量同步，并默认执行状态补偿，用于刷新已入库后又被拒绝、撤回或状态变化的审批。

```
POST /api/sync/operation-splits
```

按 `startTime` / `endTime` 时间窗口同步运营支出部门拆分数据：工资中国、社保公积金、办公场地总费用。

### 查询审批数据

#### 运营支出（按部门）

```
GET /api/approvals/approved/operation?department=IT&month=2026-06
```

#### 采购支出（按部门）

```
GET /api/approvals/approved/purchase?department=IT&month=2026-06
```

#### 运营支出（全部门）

```
GET /api/approvals/approved/operation/all?month=2026-06
```

#### 采购支出（全部门）

```
GET /api/approvals/approved/purchase/all?month=2026-06
```

#### 通用查询

```
GET /api/approvals/approved?kind=operation&department=IT&month=2026-06
```

### 查询参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `department` | 部门名称（支持模糊匹配） | `IT`、`YW Tech_Ai` |
| `dept_code` | 部门代码（精确匹配） | `IT`、`FC` |
| `month` | 月份 | `2026-06`、`2026-06-30` |
| `start_date` | 开始日期 | `2026-06-01` |
| `end_date` | 结束日期 | `2026-06-30` |
| `kind` | 支出类型 | `operation`、`purchase` |

### 汇率查询

```
GET /api/fx-rate?date=2026-06-10
```

## 脚本命令

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务 |
| `npm run dev` | 开发模式 |
| `npm run build` | 编译 TypeScript |
| `npm run refresh:dingtalk` | 从钉钉全量刷新数据 |
| `npm run refresh:dingtalk:window` | 按时间窗口重新拉取钉钉实例详情 |
| `npm run sync:approval-expenses` | 直接从钉钉同步结构化支出表 |
| `npm run sync:fx-rates` | 同步汇率数据 |
| `npm run backfill:base-currency` | 回填基准货币金额 |

## Department Identity Repair (部门身份回填)

Historical department-path repair is documented in [docs/department-identity-repair.md](docs/department-identity-repair.md). Always run the read-only `dry-run` (只读预演) first. Write mode (写入模式) requires `--write=1` and an absolute JSON backup path; it only fills empty department identity/path fields and does not delete data.

```bash
npm run repair:expense-department-identities -- --start=2026-07-01 --end=2026-07-31
```

## 项目结构

```
src/
├── index.ts              # 入口文件
├── config.ts             # 配置加载
├── database.ts           # 数据库模块入口（重导出）
├── database/
│   ├── index.ts          # Database 类组装
│   ├── pool.ts           # 连接池配置
│   ├── types.ts          # 数据库接口定义
│   ├── approval.ts       # 审批实例操作
│   ├── expense.ts        # 支出数据操作
│   └── fx.ts             # 汇率数据操作
├── dingtalk.ts           # 钉钉 API 封装
├── processor.ts          # 数据解析处理
├── scheduler.ts          # 定时任务调度
├── server.ts             # HTTP 服务
├── logger.ts             # 日志模块
├── fxToCny.ts            # 汇率转换
├── openErFx.ts           # 汇率 API
└── workflowIds.ts        # 工作流 ID 处理
```

## 数据库表

| 表名 | 说明 |
|------|------|
| `approval_instances` | 审批实例主表（基础信息、状态） |
| `sync_state` | 同步状态（游标，记录增量同步位置） |
| `fx_rates_daily` | 每日汇率快照（币种→人民币换算） |
| `approval_expense_operation` | 运营支出明细（结构化字段） |
| `approval_expense_purchase` | 采购支出明细（结构化字段） |
| `approval_expense_purchase_items` | 采购明细商品列表 |
| `approval_expense_purchase_processors` | 采购加工商信息 |
| `approval_expense_purchase_payments` | 采购付款信息 |
| `approval_expense_attachments` | 审批附件（运营/采购共用） |
| `approval_expense_dept_split` | 运营支出分部门拆分（CQRS read model） |

## License

Private

## Actual Payment Event Ingestion

The sync service extracts actual payment events from approval operation comments. It accepts only authorized users: an explicit amount in the comment takes priority; a single `已支付` comment without an amount uses the form amount component; a `部分支付` comment without an amount remains review-only. Events are written to `approval_expense_payment_events` and are idempotent on `business_id + paid_at + source_hash`, so repeated synchronization does not duplicate accounting. Salary, social insurance, housing fund, office space, and individual income tax forms continue through department splits instead of whole-form payment events.

Historical payment backfill is dry-run by default and requires explicit `--write=1` to write. Run `sql/ensure_approval_expense_schema.sql` before deployment; this project does not automatically migrate the budget server database.
