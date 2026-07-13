const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function createSchedulerFixture() {
  const fixtureBase = path.join(__dirname, '..', '.tmp-test-fixtures');
  fs.mkdirSync(fixtureBase, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(fixtureBase, 'scheduler-fixture-'));
  const fixtureSrc = path.join(fixtureRoot, 'src');
  writeFile(
    path.join(fixtureSrc, 'scheduler.ts'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'scheduler.ts'), 'utf8')
  );

  writeFile(
    path.join(fixtureSrc, 'oa-source.ts'),
    `
      export const state = {
        queryCalls: [],
        batchCalls: [],
      };

      export const approvalSource = {
        async queryProcessInstanceIds(start, end, processCode, nextToken = 0) {
          state.queryCalls.push({ start, end, processCode, nextToken });
          return { list: nextToken === 0 ? ['INS-1'] : [], nextToken: 0 };
        },
        async getProcessInstances(ids) {
          state.batchCalls.push(ids);
          return ids.map((id) => ({
            id,
            error: null,
            instance: {
              processInstanceId: id,
              businessId: 'BIZ-1',
              processCode: 'PROC-TEST',
              processType: '测试流程',
              formComponentValues: [],
            },
          }));
        },
        async getProcessInstance(id) {
          return {
            processInstanceId: id,
            businessId: 'BIZ-1',
            processCode: 'PROC-TEST',
            processType: '测试流程',
            formComponentValues: [],
          };
        },
        async sleep() {},
        async close() {},
      };

      export default approvalSource;
    `
  );

  writeFile(
    path.join(fixtureSrc, 'processor.ts'),
    `
      export const state = {
        processedBatches: [],
      };

      export default {
        async processInstances(instances) {
          state.processedBatches.push(instances);
          return { success: instances.length, skipped: 0, failed: 0 };
        },
        parseOperationExpenseData() {
          return { operationExpense: '' };
        },
        async processInstance() {
          return { skipped: false };
        },
      };
    `
  );

  writeFile(
    path.join(fixtureSrc, 'database.ts'),
    `
      export default {
        async ensureSyncStateTable() {},
        async ensureApprovalExpenseSchema() {},
        async ensureFxRatesDailyTable() {},
        async getSyncCursor() { return 0; },
        async setSyncCursor() {},
        async getPendingExpenseInstances() { return []; },
        async getStaleExpenseAgreed() { return []; },
        async countFxRatesForDate() { return 1; },
        async replaceFxRatesForDate() {},
        async close() {},
      };
    `
  );

  writeFile(
    path.join(fixtureSrc, 'logger.ts'),
    `
      export default {
        info() {},
        warn() {},
        error() {},
      };
    `
  );

  writeFile(
    path.join(fixtureSrc, 'config.ts'),
    `
      export default {
        scheduler: {
          startTime: '2026-07-01T00:00:00+08:00',
          fxRatesTimezone: 'Asia/Shanghai',
          weeklyReportEnabled: false,
          cron: '7 * * * *',
        },
        dingtalk: {
          processCodes: ['PROC-TEST'],
        },
      };
    `
  );

  writeFile(
    path.join(fixtureSrc, 'process-config.ts'),
    `
      export function getProcessTypeLabel() {
        return '测试流程';
      }
    `
  );

  writeFile(
    path.join(fixtureSrc, 'workflowIds.ts'),
    `
      export function resolveProcessInstanceFetchId(_rawData, businessId, processInstanceId) {
        return processInstanceId || businessId;
      }
    `
  );

  writeFile(
    path.join(fixtureSrc, 'openErFx.ts'),
    `
      export const ER_API_LATEST_USD = 'usd';
      export function formatDateShanghai() { return '2026-07-10'; }
      export async function fetchUsdRatesLatest() { return {}; }
      export function buildFxDailyRows() { return []; }
      export function invalidateUsdRatesCache() {}
    `
  );

  writeFile(
    path.join(fixtureSrc, 'budget-report.ts'),
    `
      export async function sendWeeklyBudgetReport() {}
    `
  );

  return fixtureSrc;
}

test('scheduler runtime reads ids and details through approvalSource', async (t) => {
  const fixtureSrc = createSchedulerFixture();
  t.after(() => {
    fs.rmSync(path.dirname(fixtureSrc), { recursive: true, force: true });
  });
  const schedulerModule = await import(pathToFileURL(path.join(fixtureSrc, 'scheduler.ts')).href);
  const oaSourceModule = await import(pathToFileURL(path.join(fixtureSrc, 'oa-source.ts')).href);
  const processorModule = await import(pathToFileURL(path.join(fixtureSrc, 'processor.ts')).href);

  const scheduler = schedulerModule.default?.default ?? schedulerModule.default ?? schedulerModule;
  const ids = await scheduler.syncSingleProcess('PROC-TEST', 1000, 2000);

  assert.deepEqual(ids, [{ processInstanceId: 'INS-1', processCode: 'PROC-TEST' }]);
  assert.deepEqual(oaSourceModule.state.queryCalls, [
    { start: 1000, end: 2000, processCode: 'PROC-TEST', nextToken: 0 },
  ]);

  const processed = await scheduler.processInstanceIdBatch(ids);

  assert.equal(processed, true);
  assert.deepEqual(oaSourceModule.state.batchCalls, [['INS-1']]);
  assert.equal(processorModule.state.processedBatches.length, 1);
  assert.equal(processorModule.state.processedBatches[0][0].businessId, 'BIZ-1');
});
