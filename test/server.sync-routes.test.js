const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

process.env.DB_PASSWORD ??= 'test-password';
process.env.DINGTALK_APPKEY ??= 'test-appkey';
process.env.DINGTALK_APPSECRET ??= 'test-appsecret';

function loadModule(moduleName) {
  const srcPath = path.join('..', 'src', moduleName);
  const distPath = path.join('..', 'dist', 'src', moduleName);
  try {
    return require(srcPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(distPath);
  }
}

function getApp() {
  const serverModule = loadModule('server');
  return serverModule.app || serverModule.default?.app;
}

function getScheduler() {
  const schedulerModule = loadModule('scheduler');
  return schedulerModule.default || schedulerModule;
}

async function withServer(run) {
  const app = getApp();
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : address;
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test('POST /api/sync/operation-splits rejects missing startTime/endTime', async () => {
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/sync/operation-splits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(payload, {
      success: false,
      message: 'startTime 和 endTime 必填',
    });
  });
});

test('POST /api/sync/operation-splits returns scheduler summary message', async () => {
  const scheduler = getScheduler();
  const original = scheduler.syncOperationSplits;

  scheduler.syncOperationSplits = async ({ startTime, endTime, splitTypes }) => {
    assert.equal(startTime, 1);
    assert.equal(endTime, 2);
    assert.deepEqual(splitTypes, ['salary']);
    return {
      success: true,
      startedAt: '2026-07-02T00:00:00.000Z',
      completedAt: '2026-07-02T00:00:01.000Z',
      startTime: 1,
      endTime: 2,
      instanceIds: 3,
      fetched: 3,
      matched: 2,
      written: 2,
      skipped: 1,
      failed: 0,
      splitCounts: {
        salary: 1,
        social_insurance: 0,
        office_space: 1,
      },
      failures: [],
    };
  };

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/operation-splits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startTime: 1,
          endTime: 2,
          splitTypes: ['salary'],
        }),
      });

      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.matched, 2);
      assert.equal(payload.written, 2);
      assert.equal(payload.message, '支出拆分同步完成：匹配 2，写入 2，跳过 1，失败 0');
    });
  } finally {
    scheduler.syncOperationSplits = original;
  }
});

test('POST /api/sync/manual runs compensation by default', async () => {
  const scheduler = getScheduler();
  const originalManualSync = scheduler.manualSync;
  const originalCompensate = scheduler.compensatePendingApprovals;
  const calls = [];

  scheduler.manualSync = async () => {
    calls.push('manual');
  };
  scheduler.compensatePendingApprovals = async () => {
    calls.push('compensate');
  };

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(calls, ['manual', 'compensate']);
      assert.equal(payload.success, true);
      assert.equal(payload.compensation, true);
      assert.equal(payload.message, '支出同步和状态补偿已完成');
    });
  } finally {
    scheduler.manualSync = originalManualSync;
    scheduler.compensatePendingApprovals = originalCompensate;
  }
});

test('POST /api/sync/manual skips compensation when compensate=false', async () => {
  const scheduler = getScheduler();
  const originalManualSync = scheduler.manualSync;
  const originalCompensate = scheduler.compensatePendingApprovals;
  const calls = [];

  scheduler.manualSync = async () => {
    calls.push('manual');
  };
  scheduler.compensatePendingApprovals = async () => {
    calls.push('compensate');
  };

  try {
    await withServer(async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/manual`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ compensate: false }),
      });

      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(calls, ['manual']);
      assert.equal(payload.success, true);
      assert.equal(payload.compensation, false);
      assert.equal(payload.message, '支出同步已完成');
    });
  } finally {
    scheduler.manualSync = originalManualSync;
    scheduler.compensatePendingApprovals = originalCompensate;
  }
});
