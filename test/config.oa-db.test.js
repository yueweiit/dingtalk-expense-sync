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

function runConfigFixture(envLines, configJson = null) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-config-fixture-'));
  const fixtureSrc = path.join(fixtureRoot, 'src');
  writeFile(path.join(fixtureRoot, '.env'), envLines.join('\n'));
  if (configJson) {
    writeFile(path.join(fixtureRoot, 'config.json'), JSON.stringify(configJson));
  }

  for (const fileName of ['config.ts', 'process-config.ts', 'form-source.ts']) {
    writeFile(
      path.join(fixtureSrc, fileName),
      fs.readFileSync(path.join(__dirname, '..', 'src', fileName), 'utf8')
    );
  }

  const childEnv = { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules') };
  delete childEnv.DINGTALK_APPKEY;
  delete childEnv.DINGTALK_APPSECRET;
  delete childEnv.DINGTALK_PROCESS_CODES;
  delete childEnv.DINGTALK_PROCESS_TYPE_MAP;

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
        '  allProcessCodes: config.dingtalk.allProcessCodes,',
        '}));',
      ].join('\n'),
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: childEnv,
    }
  );

  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  return child;
}

const completeProcessTypeMap = [
  'DINGTALK_PROCESS_TYPE_MAP={"operation":["PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA","PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD","PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8","PROC-E7BC3316-E618-4812-BDCC-7A655A7C694B","PROC-14972EC1-2E3B-47DA-8346-9B1DBFE578C5"],"purchase":["PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B","PROC-6E11B527-2F82-439C-817D-C868DE086C97","PROC-481342D0-27B4-461C-A543-4AB0A96D2EDF","PROC-E69FCD3E-E374-4C54-9D8F-6E1F55AD741F","PROC-866867B6-1F7B-4F70-AB8F-3500D6560785"]}',
];

test('config loads with OA database credentials and a complete process type map', () => {
  const child = runConfigFixture([
    'DB_PASSWORD=test-db-password',
    'OA_DB_HOST=127.0.0.1',
    'OA_DB_PORT=5432',
    'OA_DB_NAME=dingtalk_oa',
    'OA_DB_USER=postgres',
    'OA_DB_PASSWORD=test-oa-password',
    ...completeProcessTypeMap,
  ]);

  assert.equal(child.status, 0, child.stderr || child.stdout);
  const lines = child.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = JSON.parse(lines.at(-1));
  assert.equal(parsed.oaDatabase.database, 'dingtalk_oa');
  assert.equal(parsed.appkey, null);
  assert.equal(parsed.appsecret, null);
  assert.equal(parsed.allProcessCodes.length, 10);
});

test('config rejects the deprecated process code array even when it is otherwise valid', () => {
  const child = runConfigFixture([
    'DB_PASSWORD=test-db-password',
    'DINGTALK_PROCESS_CODES=["PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA","PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B"]',
    ...completeProcessTypeMap,
  ]);

  assert.notEqual(child.status, 0);
  assert.match(child.stderr || child.stdout, /DINGTALK_PROCESS_CODES.*废弃|deprecated/i);
});

test('config rejects the deprecated process code array from config.json', () => {
  const child = runConfigFixture(
    [
      'DB_PASSWORD=test-db-password',
      ...completeProcessTypeMap,
    ],
    {
      dingtalk: {
        processCodes: ['PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA'],
      },
    }
  );

  assert.notEqual(child.status, 0);
  assert.match(child.stderr || child.stdout, /dingtalk\.processCodes.*废弃|deprecated/i);
});

test('config rejects an invalid environment map instead of falling back to config.json', () => {
  const child = runConfigFixture(
    [
      'DB_PASSWORD=test-db-password',
      'DINGTALK_PROCESS_TYPE_MAP=null',
    ],
    {
      dingtalk: {
        processTypeMap: {
          operation: [
            'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
            'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD',
          ],
          purchase: [
            'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B',
            'PROC-6E11B527-2F82-439C-817D-C868DE086C97',
          ],
        },
      },
    }
  );

  assert.notEqual(child.status, 0);
  assert.match(child.stderr || child.stdout, /DINGTALK_PROCESS_TYPE_MAP.*必须|invalid/i);
});
