# 钉钉审批数据同步服务

定时获取钉钉运营&采购支出审批数据并存储到 PostgreSQL，提供 HTTP API 查询。

## 功能特性

- **定时同步**：自动拉取钉钉审批实例（运营支出、采购支出）
- **增量同步**：基于游标的增量拉取，支持断点续传
- **补偿机制**：自动重试失败的记录，处理 RUNNING 状态的审批
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
    "cashierActivityIds": ["1793_35c3"],
    "processCodes": [
      "PROC-0288DB08-...",
      "PROC-BFDF6F09-..."
    ]
  },
  "scheduler": {
    "cron": "7 * * * *",
    "startTime": "2026-04-01T00:00:00+08:00",
    "compensationCron": "17 3 * * *",
    "fxRatesCron": "5 0 * * *"
  },
  "server": {
    "port": 3002
  }
}
```

### 定时任务配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `scheduler.cron` | 增量同步频率 | `7 * * * *`（每小时第7分钟） |
| `scheduler.startTime` | 首次同步起始时间 | `2026-04-01T00:00:00+08:00` |
| `scheduler.compensationCron` | 补偿任务频率 | `17 3 * * *`（每天凌晨3:17） |
| `scheduler.fxRatesCron` | 汇率同步频率 | `5 0 * * *`（每天凌晨0:05） |

## API 接口

### 健康检查

```
GET /health
```

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
| `npm run sync:fx-rates` | 同步汇率数据 |
| `npm run backfill:cashier` | 回填出纳状态 |
| `npm run backfill:base-currency` | 回填基准货币金额 |

## 项目结构

```
src/
├── index.ts          # 入口文件
├── config.ts         # 配置加载
├── database.ts       # 数据库操作
├── dingtalk.ts       # 钉钉 API 封装
├── processor.ts      # 数据解析处理
├── scheduler.ts      # 定时任务调度
├── server.ts         # HTTP 服务
├── logger.ts         # 日志模块
├── fxToCny.ts        # 汇率转换
├── openErFx.ts       # 汇率 API
└── workflowIds.ts    # 工作流 ID 处理
```

## 数据库表

| 表名 | 说明 |
|------|------|
| `approval_instance` | 审批实例基础信息 |
| `approval_expense_operation` | 运营支出明细 |
| `approval_expense_purchase` | 采购支出明细 |
| `approval_attachment` | 审批附件 |
| `fx_rates_daily` | 每日汇率 |

## License

Private
