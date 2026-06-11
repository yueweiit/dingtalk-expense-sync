import database, { pool } from '../src/database.ts';
import processor from '../src/processor.ts';
import type { PoolClient } from 'pg';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [k, v] = item.slice(2).split('=');
    args[k] = v ?? '';
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month || '';
  const department = args.department || '';
  const processType = args.processType || '';
  const dryRun = String(args.dryRun || '').toLowerCase() === 'true';

  const client: PoolClient = await pool.connect();
  try {
    let query = `
      SELECT business_id, process_code, raw_data, cashier_task_id, cashier_user_id, cashier_status, cashier_result, cashier_complete_time
      FROM approval_instances
      WHERE raw_data IS NOT NULL
    `;
    const params: unknown[] = [];
    let i = 1;

    if (department) {
      query += ` AND department LIKE $${i++}`;
      params.push(`%${department}%`);
    }
    if (processType) {
      query += ` AND process_type = $${i++}`;
      params.push(processType);
    }
    if (month) {
      const [y, m] = month.split('-');
      const start = `${y}-${m}-01 00:00:00`;
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const end = `${y}-${m}-${String(lastDay).padStart(2, '0')} 23:59:59`;
      query += ` AND create_time >= $${i++} AND create_time <= $${i++}`;
      params.push(start, end);
    }

    const result = await client.query(query, params);
    let changed = 0;

    for (const row of result.rows) {
      const tasks = row.raw_data?.tasks || [];
      const processCode = row.process_code || row.raw_data?.processCode || null;
      const task = processor.getCashierTask(tasks, processCode);

      const next = {
        taskId: task?.taskId?.toString() || null,
        userId: task?.userId || null,
        status: task?.status || null,
        result: task?.result || null,
        finishTime: task?.finishTime ? new Date(task.finishTime) : null
      };

      const currFinishMs = row.cashier_complete_time ? new Date(row.cashier_complete_time).getTime() : null;
      const nextFinishMs = next.finishTime ? new Date(next.finishTime).getTime() : null;

      const same =
        (row.cashier_task_id || null) === next.taskId &&
        (row.cashier_user_id || null) === next.userId &&
        (row.cashier_status || null) === next.status &&
        (row.cashier_result || null) === next.result &&
        currFinishMs === nextFinishMs;

      if (same) continue;
      changed++;

      if (!dryRun) {
        await client.query(
          `
            UPDATE approval_instances
            SET cashier_task_id = $1,
                cashier_user_id = $2,
                cashier_status = $3,
                cashier_result = $4,
                cashier_complete_time = $5,
                update_time = CURRENT_TIMESTAMP
            WHERE business_id = $6
          `,
          [next.taskId, next.userId, next.status, next.result, next.finishTime, row.business_id]
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          scanned: result.rows.length,
          changed,
          dryRun
        },
        null,
        2
      )
    );
  } finally {
    client.release();
    await database.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});


