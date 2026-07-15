import { Pool } from 'pg';
import config from './config.ts';
import { getProcessTypeLabel } from './process-config.ts';

interface QueryResultRow {
  process_instance_id?: string | null;
  process_code?: string | null;
  title?: string | null;
  status?: string | null;
  result?: string | null;
  originator_user_id?: string | null;
  originator_user_name?: string | null;
  snapshot_user_name?: string | null;
  originator_dept_id?: string | null;
  originator_dept_name?: string | null;
  create_time?: Date | string | null;
  finish_time?: Date | string | null;
  updated_at?: Date | string | null;
  form_component_values?: unknown;
  raw_payload?: unknown;
}

interface Queryable {
  query<T = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end?(): Promise<void>;
}

interface QueryProcessInstanceIdsResult {
  list: string[];
  nextToken: number;
}

interface ApprovalSourceInstanceResult {
  id: string;
  instance: Record<string, unknown> | null;
  error: string | null;
}

const oaPool = new Pool({
  host: config.oaDatabase.host,
  port: config.oaDatabase.port,
  database: config.oaDatabase.database,
  user: config.oaDatabase.user,
  password: config.oaDatabase.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

oaPool.on('error', (error: Error) => {
  console.error('dingtalk_oa 数据库连接池错误:', error);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = String(value).trim();
  return text || null;
}

function toText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

export function resolveOriginatorUserName(
  sourceName: unknown,
  userId: unknown,
  snapshotName: unknown
): string | undefined {
  const source = toText(sourceName);
  const user = toText(userId);
  const snapshot = toText(snapshotName);
  const sourceLooksLikeUserId = !source || source === user || /^\d+$/.test(source);

  return (sourceLooksLikeUserId ? snapshot || source : source || snapshot) || user || undefined;
}

function toApiString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  const text = String(value);
  return text;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeTask(task: unknown): unknown {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return task;
  }
  const next = { ...(task as Record<string, unknown>) };
  if (typeof next.taskId === 'string' && /^\d+$/.test(next.taskId)) {
    next.taskId = Number(next.taskId);
  }
  return next;
}

function defineHiddenProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function adaptInstanceRow(row: QueryResultRow): Record<string, unknown> {
  const rawPayload = parseJsonObject(row.raw_payload);
  const processCode = toText(rawPayload.processCode) || toText(row.process_code) || undefined;
  const processInstanceId =
    toText(rawPayload.processInstanceId) ||
    toText(row.process_instance_id) ||
    toText(rawPayload.businessId) ||
    undefined;
  const businessId =
    toText(rawPayload.businessId) ||
    toText(rawPayload.business_id) ||
    processInstanceId ||
    '';
  const originatorUserId =
    toText(rawPayload.originatorUserId) ||
    toText(row.originator_user_id) ||
    undefined;
  const sourceOriginatorUserName =
    toText(rawPayload.originatorUserName) ||
    toText(rawPayload.originator_user_name) ||
    toText(row.originator_user_name);
  const originatorUserName = resolveOriginatorUserName(
    sourceOriginatorUserName,
    originatorUserId,
    row.snapshot_user_name
  );
  const approvalNo =
    toText(rawPayload.approvalNo) ||
    toText(rawPayload.approval_no) ||
    businessId ||
    undefined;
  const rawTasks = toArray(rawPayload.tasks).map(normalizeTask);
  const rawFormComponentValues = toArray(rawPayload.formComponentValues);
  const fallbackFormComponentValues = toArray(row.form_component_values);

  const instance = {
    ...rawPayload,
    processInstanceId,
    businessId,
    title: toApiString(rawPayload.title) ?? toText(row.title) ?? undefined,
    processCode,
    processType: toText(rawPayload.processType) || getProcessTypeLabel(processCode, config.dingtalk),
    status: toApiString(rawPayload.status) ?? toText(row.status) ?? undefined,
    result: toApiString(rawPayload.result) ?? toApiString(row.result) ?? undefined,
    bizAction: toApiString(rawPayload.bizAction) ?? toApiString(rawPayload.biz_action) ?? undefined,
    createTime: toIsoString(rawPayload.createTime) || toIsoString(row.create_time) || undefined,
    endTime:
      toIsoString(rawPayload.endTime) ||
      toIsoString(rawPayload.finishTime) ||
      toIsoString(row.finish_time) ||
      undefined,
    finishTime: toIsoString(rawPayload.finishTime) || toIsoString(row.finish_time) || undefined,
    originatorUserId,
    originatorDeptId:
      toText(rawPayload.originatorDeptId) ||
      toText(row.originator_dept_id) ||
      undefined,
    originatorDeptName:
      toText(rawPayload.originatorDeptName) ||
      toText(row.originator_dept_name) ||
      undefined,
    updateTime: toIsoString(rawPayload.updateTime) || undefined,
    modifyTime: toIsoString(rawPayload.modifyTime) || undefined,
    tasks: rawTasks,
    formComponentValues:
      rawFormComponentValues.length > 0
        ? rawFormComponentValues
        : fallbackFormComponentValues,
  } satisfies Record<string, unknown>;

  defineHiddenProperty(instance, 'originatorUserName', originatorUserName);
  defineHiddenProperty(instance, 'originator_user_name', originatorUserName);
  defineHiddenProperty(instance, 'approvalNo', approvalNo);
  defineHiddenProperty(instance, 'approval_no', approvalNo);
  defineHiddenProperty(instance, 'rawData', rawPayload);

  return instance;
}

export function createOaApprovalSource(client: Queryable = oaPool) {
  return {
    sleep,

    async queryProcessInstanceIds(
      startTime: number,
      endTime: number,
      processCode: string,
      nextToken = 0,
      maxResults = 20
    ): Promise<QueryProcessInstanceIdsResult> {
      const safePageSize = Math.max(1, Number(maxResults) || 20);
      const safeOffset = Math.max(0, Number(nextToken) || 0);
      const limit = safePageSize + 1;
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();

      const result = await client.query<{ process_instance_id: string | null }>(
        `
          select process_instance_id
          from ding_approval_instance
          where deleted_at is null
            and process_code = $1
            and create_time >= $2::timestamptz
            and create_time <= $3::timestamptz
          order by create_time desc, process_instance_id desc
          limit $4 offset $5
        `,
        [processCode, startIso, endIso, limit, safeOffset]
      );

      const rows = result.rows
        .map((row) => toText(row.process_instance_id))
        .filter(Boolean) as string[];
      const hasMore = rows.length > safePageSize;

      return {
        list: hasMore ? rows.slice(0, safePageSize) : rows,
        nextToken: hasMore ? safeOffset + safePageSize : 0,
      };
    },

    async getProcessInstance(processInstanceId: string): Promise<Record<string, unknown>> {
      const result = await client.query<QueryResultRow>(
        `
          select
            process_instance_id,
            process_code,
            title,
            status,
            result,
            originator_user_id,
            originator_user_name,
            originator_dept_id,
            originator_dept_name,
            create_time,
            finish_time,
            updated_at,
            form_component_values,
            raw_payload,
            snapshot_row.name AS snapshot_user_name
          from ding_approval_instance AS source
          left join lateral (
            select snapshot.name
            from ding_user_snapshot AS snapshot
            where snapshot.corp_id = source.corp_id
              and snapshot.user_id = coalesce(
                nullif(trim(source.originator_user_id), ''),
                nullif(trim(source.raw_payload->>'originatorUserId'), ''),
                nullif(trim(source.raw_payload->>'originator_user_id'), '')
              )
              and snapshot.is_current = true
              and snapshot.fetch_status = 'success'
              and coalesce(trim(snapshot.name), '') <> ''
            order by snapshot.valid_from desc, snapshot.id desc
            limit 1
          ) AS snapshot_row on true
          where source.deleted_at is null
            and (
              source.process_instance_id = $1
              or coalesce(source.raw_payload->>'businessId', '') = $1
            )
          order by
            case when source.process_instance_id = $1 then 0 else 1 end,
            source.create_time desc
          limit 1
        `,
        [processInstanceId]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`approval instance not found: ${processInstanceId}`);
      }

      return adaptInstanceRow(row);
    },

    async getProcessInstances(processInstanceIds: string[]): Promise<ApprovalSourceInstanceResult[]> {
      if (!Array.isArray(processInstanceIds) || processInstanceIds.length === 0) {
        return [];
      }

      const ids = [...new Set(processInstanceIds.map((item) => String(item || '').trim()).filter(Boolean))];
      if (!ids.length) {
        return [];
      }

      const result = await client.query<QueryResultRow>(
        `
          select
            process_instance_id,
            process_code,
            title,
            status,
            result,
            originator_user_id,
            originator_user_name,
            originator_dept_id,
            originator_dept_name,
            create_time,
            finish_time,
            updated_at,
            form_component_values,
            raw_payload,
            snapshot_row.name AS snapshot_user_name
          from ding_approval_instance AS source
          left join lateral (
            select snapshot.name
            from ding_user_snapshot AS snapshot
            where snapshot.corp_id = source.corp_id
              and snapshot.user_id = coalesce(
                nullif(trim(source.originator_user_id), ''),
                nullif(trim(source.raw_payload->>'originatorUserId'), ''),
                nullif(trim(source.raw_payload->>'originator_user_id'), '')
              )
              and snapshot.is_current = true
              and snapshot.fetch_status = 'success'
              and coalesce(trim(snapshot.name), '') <> ''
            order by snapshot.valid_from desc, snapshot.id desc
            limit 1
          ) AS snapshot_row on true
          where source.deleted_at is null
            and (
              source.process_instance_id = any($1::text[])
              or coalesce(source.raw_payload->>'businessId', '') = any($1::text[])
            )
          order by source.create_time desc, source.process_instance_id desc
        `,
        [ids]
      );

      const rowMap = new Map<string, QueryResultRow>();
      for (const row of result.rows) {
        const processInstanceId = toText(row.process_instance_id);
        const businessId = toText(parseJsonObject(row.raw_payload).businessId);
        if (processInstanceId && !rowMap.has(processInstanceId)) {
          rowMap.set(processInstanceId, row);
        }
        if (businessId && !rowMap.has(businessId)) {
          rowMap.set(businessId, row);
        }
      }

      return processInstanceIds.map((id) => {
        const key = String(id || '').trim();
        const row = rowMap.get(key);
        if (!row) {
          return {
            id: key,
            instance: null,
            error: `approval instance not found: ${key}`,
          };
        }

        return {
          id: key,
          instance: adaptInstanceRow(row),
          error: null,
        };
      });
    },

    async close(): Promise<void> {
      if (typeof client.end === 'function') {
        await client.end();
      }
    },
  };
}

export const approvalSource = createOaApprovalSource();

export default approvalSource;
