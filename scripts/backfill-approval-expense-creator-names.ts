import { Pool } from 'pg';
import database, { pool } from '../src/database.ts';
import config from '../src/config.ts';
import { resolveOriginatorUserName } from '../src/oa-source.ts';

type Args = {
  businessId?: string;
  all: boolean;
  write: boolean;
};

type CreatorNameSource = {
  business_id: string | null;
  process_instance_id: string | null;
  originator_user_id: string | null;
  originator_user_name: string | null;
  snapshot_user_name: string | null;
};

function parseArgs(argv: string[]): Args {
  const getValue = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const arg = argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : undefined;
  };

  return {
    businessId: getValue('businessId') || getValue('business_id'),
    all: argv.includes('--all=1'),
    write: argv.includes('--write=1'),
  };
}

function createOaPool(): Pool {
  return new Pool({
    host: config.oaDatabase.host,
    port: config.oaDatabase.port,
    database: config.oaDatabase.database,
    user: config.oaDatabase.user,
    password: config.oaDatabase.password,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

async function loadSources(oaPool: Pool, businessId?: string): Promise<CreatorNameSource[]> {
  const params: string[] = [];
  const filter = businessId
    ? `and coalesce(source.raw_payload->>'businessId', '') = $1`
    : '';

  if (businessId) params.push(businessId);

  const result = await oaPool.query<CreatorNameSource>(
    `
      select
        coalesce(source.raw_payload->>'businessId', '') as business_id,
        source.process_instance_id,
        coalesce(
          nullif(trim(source.originator_user_id), ''),
          nullif(trim(source.raw_payload->>'originatorUserId'), ''),
          nullif(trim(source.raw_payload->>'originator_user_id'), '')
        ) as originator_user_id,
        coalesce(
          nullif(trim(source.raw_payload->>'originatorUserName'), ''),
          nullif(trim(source.raw_payload->>'originator_user_name'), ''),
          nullif(trim(source.originator_user_name), '')
        ) as originator_user_name,
        snapshot_row.name as snapshot_user_name
      from ding_approval_instance as source
      left join lateral (
        select snapshot.name
        from ding_user_snapshot as snapshot
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
      ) as snapshot_row on true
      where source.deleted_at is null
        ${filter}
      order by source.create_time asc nulls last, source.process_instance_id asc
    `,
    params
  );

  return result.rows;
}

function isWritableTargetName(value: unknown, sourceUserId: string | null): boolean {
  const text = String(value ?? '').trim();
  return !text || text === String(sourceUserId ?? '').trim() || /^[0-9]+$/.test(text);
}

async function updateCreatorName(source: CreatorNameSource, creatorName: string): Promise<{ matched: number; updated: number }> {
  const processInstanceId = String(source.process_instance_id || '').trim();
  const businessId = String(source.business_id || '').trim();
  const sourceUserId = String(source.originator_user_id || '').trim();
  if (!processInstanceId && !businessId) return { matched: 0, updated: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let matched = 0;
    let updated = 0;
    for (const tableName of ['approval_expense_operation', 'approval_expense_purchase']) {
      const result = await client.query(
        `
          update ${tableName}
          set creator_name = $1
          where (process_instance_id = $2 or business_id = $3)
            and (
              coalesce(trim(creator_name), '') = ''
              or creator_name = $4
              or creator_name ~ '^[0-9]+$'
            )
          returning creator_name
        `,
        [creatorName, processInstanceId || null, businessId || null, sourceUserId || null]
      );
      matched += result.rowCount || 0;
      updated += result.rowCount || 0;
    }
    await client.query('COMMIT');
    return { matched, updated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.businessId && !args.all) {
    throw new Error('Specify --businessId=<business id> or --all=1.');
  }
  if (args.businessId && args.all) {
    throw new Error('Use either --businessId=<business id> or --all=1, not both.');
  }

  const oaPool = createOaPool();
  try {
    const sources = await loadSources(oaPool, args.businessId);
    let resolved = 0;
    let skipped = 0;
    let matched = 0;
    let updated = 0;
    const preview: Array<Record<string, string | null>> = [];

    for (const source of sources) {
      const snapshotName = String(source.snapshot_user_name || '').trim();
      const sourceName = String(source.originator_user_name || '').trim();
      const sourceLooksLikeUserId = !sourceName ||
        sourceName === String(source.originator_user_id || '').trim() ||
        /^[0-9]+$/.test(sourceName);

      if (sourceLooksLikeUserId && (!snapshotName || /^[0-9]+$/.test(snapshotName))) {
        skipped++;
        continue;
      }

      const creatorName = resolveOriginatorUserName(
        source.originator_user_name,
        source.originator_user_id,
        source.snapshot_user_name
      );

      if (!creatorName || creatorName === source.originator_user_id) {
        skipped++;
        continue;
      }

      resolved++;
      if (preview.length < 20) {
        preview.push({
          businessId: source.business_id,
          processInstanceId: source.process_instance_id,
          creatorName,
        });
      }

      if (args.write) {
        const result = await updateCreatorName(source, creatorName);
        matched += result.matched;
        updated += result.updated;
      }
    }

    console.log(JSON.stringify({
      dryRun: !args.write,
      sources: sources.length,
      resolved,
      skipped,
      matched,
      updated,
      preview,
    }, null, 2));
  } finally {
    await Promise.all([database.close(), oaPool.end()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
