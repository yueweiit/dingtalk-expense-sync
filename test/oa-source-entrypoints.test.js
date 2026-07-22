const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('main sync entrypoints read approval data through oa-source', () => {
  const checks = [
    ['src/scheduler.ts', "import { approvalSource } from './oa-source.ts';"],
    ['scripts/sync-approval-expenses-from-dingtalk.ts', "import { approvalSource } from '../src/oa-source.ts';"],
    ['scripts/refresh-from-dingtalk.ts', "import { approvalSource } from '../src/oa-source.ts';"],
    ['scripts/refresh-from-dingtalk-window.ts', "import { approvalSource } from '../src/oa-source.ts';"],
  ];

  for (const [relativePath, expectedImport] of checks) {
    const content = readProjectFile(relativePath);
    assert.match(content, new RegExp(expectedImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, /import dingtalk from ['"].*dingtalk\.ts['"]/);
  }
});

test('direct operation write entrypoints enrich department paths before writing splits', () => {
  const checks = [
    ['scripts/sync-approval-expenses-from-dingtalk.ts', 'await processor.enrichOperationDepartmentPaths(opData);'],
    ['scripts/backfill-approval-expense-schema.ts', 'await processor.enrichOperationDepartmentPaths(parsed);'],
  ];

  for (const [relativePath, expectedCall] of checks) {
    assert.match(readProjectFile(relativePath), new RegExp(expectedCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('refresh-from-dingtalk-window rejects an inverted time range before touching the database', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(__dirname, '..', 'scripts', 'refresh-from-dingtalk-window.ts'),
      '--start=2026-07-10T00:00:00+08:00',
      '--end=2026-07-01T00:00:00+08:00',
      '--department=IT',
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: process.env,
    }
  );

  assert.notEqual(child.status, 0);
  assert.match(`${child.stderr}\n${child.stdout}`, /end.*start|greater than or equal/i);
});
