const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

test('config can load with only OA database credentials and without DingTalk app credentials', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-config-fixture-'));
  const fixtureSrc = path.join(fixtureRoot, 'src');
  writeFile(
    path.join(fixtureRoot, '.env'),
    [
      'DB_PASSWORD=test-db-password',
      'OA_DB_HOST=127.0.0.1',
      'OA_DB_PORT=5432',
      'OA_DB_NAME=dingtalk_oa',
      'OA_DB_USER=postgres',
      'OA_DB_PASSWORD=test-oa-password',
      'DINGTALK_PROCESS_CODES=["PROC-TEST-1"]',
    ].join('\n')
  );

  writeFile(
    path.join(fixtureSrc, 'config.ts'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'config.ts'), 'utf8')
  );
  writeFile(
    path.join(fixtureSrc, 'process-config.ts'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'process-config.ts'), 'utf8')
  );

  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
        '--eval',
        [
        `import * as configModule from ${JSON.stringify(pathToFileURL(path.join(fixtureSrc, 'config.ts')).href)};`,
        'const config = configModule.default?.default ?? configModule.default ?? configModule;',
        'console.log(JSON.stringify({',
        '  oaDatabase: config.oaDatabase,',
        '  appkey: config.dingtalk.appkey ?? null,',
        '  appsecret: config.dingtalk.appsecret ?? null,',
        '}));',
      ].join('\n'),
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DINGTALK_APPKEY: '',
        DINGTALK_APPSECRET: '',
        NODE_PATH: path.join(__dirname, '..', 'node_modules'),
      },
    }
  );

  assert.equal(child.status, 0, child.stderr || child.stdout);
  const lines = child.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = JSON.parse(lines.at(-1));
  assert.equal(parsed.oaDatabase.database, 'dingtalk_oa');
  assert.equal(parsed.appkey, null);
  assert.equal(parsed.appsecret, null);
});
