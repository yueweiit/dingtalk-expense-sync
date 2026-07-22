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

function createFakeClient(handler) {
  return {
    async query(sql, params) {
      return handler({ sql, params });
    },
  };
}

test('queryProcessInstanceIds returns paged ids and numeric nextToken', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(({ params }) => {
      assert.equal(params[0], 'PROC-OPERATION');
      assert.equal(params[1], '2026-07-01T00:00:00.000Z');
      assert.equal(params[2], '2026-07-31T23:59:59.999Z');
      assert.equal(params[3], 3);
      assert.equal(params[4], 0);
      return {
        rows: [
          { process_instance_id: 'INS-003' },
          { process_instance_id: 'INS-002' },
          { process_instance_id: 'INS-001' },
        ],
      };
    })
  );

  const result = await source.queryProcessInstanceIds(
    Date.parse('2026-07-01T00:00:00.000Z'),
    Date.parse('2026-07-31T23:59:59.999Z'),
    'PROC-OPERATION',
    0,
    2
  );

  assert.deepEqual(result, {
    list: ['INS-003', 'INS-002'],
    nextToken: 2,
  });
});

test('getDepartmentSnapshots returns a department path only when the id is unambiguous', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(({ sql, params }) => {
      assert.match(sql, /ding_department_tree/);
      assert.deepEqual(params, [['1059483024', 'ambiguous-id']]);
      return {
        rows: [{
          dept_id: '1059483024',
          name: 'OBG 线上业务组',
          path_ids: ['1', '1004758048', '1059358452', '1059483024'],
          path_names: ['ROOT', 'YUEWEI', '业务及生产执行单元', 'OBG 线上业务组'],
        }],
      };
    })
  );

  const snapshots = await source.getDepartmentSnapshots(['1059483024', 'ambiguous-id']);

  assert.deepEqual([...snapshots.entries()], [[
    '1059483024',
    {
      department: 'OBG 线上业务组',
      departmentPathIds: ['1', '1004758048', '1059358452', '1059483024'],
      departmentPathNames: ['ROOT', 'YUEWEI', '业务及生产执行单元', 'OBG 线上业务组'],
    },
  ]]);
});

test('getProcessInstance adapts raw payload and falls back to structured columns', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(() => ({
      rows: [
        {
          process_instance_id: 'PROC-INSTANCE-1',
          process_code: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
          title: 'structured title',
          status: 'COMPLETED',
          result: 'agree',
          originator_user_id: 'user-1',
          originator_user_name: '张三',
          originator_dept_id: 'dept-1',
          originator_dept_name: '运营一部',
          create_time: new Date('2026-07-01T01:02:03.000Z'),
          finish_time: new Date('2026-07-02T04:05:06.000Z'),
          form_component_values: [
            { name: '申请日期Fecha de solicitud', value: '2026-07-01' },
          ],
          raw_payload: {
            businessId: 'BIZ-001',
            createTime: '2026-07-01T01:02Z',
            ccUserIds: ['cc-1', 'cc-2'],
            operationRecords: [{ type: 'START_PROCESS_INSTANCE', date: '2026-07-01T01:02Z' }],
            formComponentValues: [
              { name: '金额importe', value: '88.50' },
            ],
            tasks: [{ userId: 'approver-1', status: 'RUNNING' }],
          },
        },
      ],
    }))
  );

  const instance = await source.getProcessInstance('PROC-INSTANCE-1');

  assert.equal(instance.processInstanceId, 'PROC-INSTANCE-1');
  assert.equal(instance.businessId, 'BIZ-001');
  assert.equal(instance.title, 'structured title');
  assert.equal(instance.status, 'COMPLETED');
  assert.equal(instance.result, 'agree');
  assert.equal(instance.originatorUserId, 'user-1');
  assert.equal(instance.originatorUserName, '张三');
  assert.equal(instance.originatorDeptId, 'dept-1');
  assert.equal(instance.originatorDeptName, '运营一部');
  assert.equal(instance.processCode, 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA');
  assert.equal(instance.processType, '运营支出');
  assert.equal(instance.createTime, '2026-07-01T01:02Z');
  assert.equal(instance.finishTime, '2026-07-02T04:05:06.000Z');
  assert.deepEqual(instance.ccUserIds, ['cc-1', 'cc-2']);
  assert.deepEqual(instance.operationRecords, [
    { type: 'START_PROCESS_INSTANCE', date: '2026-07-01T01:02Z' },
  ]);
  assert.deepEqual(instance.formComponentValues, [
    { name: '金额importe', value: '88.50' },
  ]);
  assert.deepEqual(instance.tasks, [{ userId: 'approver-1', status: 'RUNNING' }]);
  assert.deepEqual(instance.rawData, {
    businessId: 'BIZ-001',
    createTime: '2026-07-01T01:02Z',
    ccUserIds: ['cc-1', 'cc-2'],
    operationRecords: [{ type: 'START_PROCESS_INSTANCE', date: '2026-07-01T01:02Z' }],
    formComponentValues: [
      { name: '金额importe', value: '88.50' },
    ],
    tasks: [{ userId: 'approver-1', status: 'RUNNING' }],
  });
});

test('getProcessInstance uses snapshot name when the source name is a user id', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(() => ({
      rows: [{
        process_instance_id: 'PROC-INSTANCE-SNAPSHOT',
        process_code: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
        status: 'COMPLETED',
        originator_user_id: '15598386624892751',
        originator_user_name: '15598386624892751',
        snapshot_user_name: 'Snapshot User',
        create_time: new Date('2026-07-15T00:00:00.000Z'),
        form_component_values: [],
        raw_payload: {
          businessId: 'BIZ-SNAPSHOT',
          originatorUserId: '15598386624892751',
          originatorUserName: '15598386624892751',
          formComponentValues: [],
          tasks: [],
        },
      }],
    }))
  );

  const instance = await source.getProcessInstance('PROC-INSTANCE-SNAPSHOT');

  assert.equal(instance.originatorUserName, 'Snapshot User');
});

test('resolveOriginatorUserName preserves a readable source name', () => {
  const sourceModule = loadModule('oa-source');
  const resolveOriginatorUserName =
    sourceModule.resolveOriginatorUserName || sourceModule.default?.resolveOriginatorUserName;

  assert.equal(
    resolveOriginatorUserName('Source User', 'source-user', 'Different Snapshot User'),
    'Source User'
  );
});

test('getProcessInstance can fall back to businessId lookup when processInstanceId is missing upstream', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(({ params }) => {
      assert.equal(params[0], 'BIZ-002');
      return {
        rows: [
          {
            process_instance_id: 'PROC-INSTANCE-2',
            process_code: 'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B',
            title: '采购支出',
            status: 'RUNNING',
            result: '',
            originator_user_id: 'user-2',
            originator_user_name: '李四',
            originator_dept_id: 'dept-2',
            originator_dept_name: '采购部',
            create_time: new Date('2026-07-03T00:00:00.000Z'),
            finish_time: null,
            form_component_values: [],
            raw_payload: {
              businessId: 'BIZ-002',
              formComponentValues: [],
              tasks: [],
            },
          },
        ],
      };
    })
  );

  const instance = await source.getProcessInstance('BIZ-002');

  assert.equal(instance.processInstanceId, 'PROC-INSTANCE-2');
  assert.equal(instance.businessId, 'BIZ-002');
  assert.equal(instance.processType, '采购支出');
});

test('getProcessInstance does not use database updated_at as DingTalk updateTime fallback', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(() => ({
      rows: [
        {
          process_instance_id: 'PROC-INSTANCE-3',
          process_code: 'PROC-6E11B527-2F82-439C-817D-C868DE086C97',
          title: '电商采购支出',
          status: 'RUNNING',
          result: '',
          originator_user_id: 'user-4',
          originator_user_name: '赵六',
          originator_dept_id: 'dept-4',
          originator_dept_name: '电商采购部',
          create_time: new Date('2026-07-05T00:00:00.000Z'),
          finish_time: null,
          updated_at: new Date('2026-07-06T08:09:10.000Z'),
          form_component_values: [],
          raw_payload: {
            businessId: 'BIZ-004',
            createTime: '2026-07-05T00:00Z',
            formComponentValues: [],
            tasks: [],
          },
        },
      ],
    }))
  );

  const instance = await source.getProcessInstance('PROC-INSTANCE-3');

  assert.equal(instance.updateTime, undefined);
  assert.equal(instance.modifyTime, undefined);
});

test('getProcessInstances preserves per-id success and error results', async () => {
  const sourceModule = loadModule('oa-source');
  const createOaApprovalSource =
    sourceModule.createOaApprovalSource || sourceModule.default?.createOaApprovalSource;

  const source = createOaApprovalSource(
    createFakeClient(({ params }) => {
      assert.deepEqual(params[0], ['PROC-INSTANCE-1', 'BIZ-404']);
      return {
        rows: [
          {
            process_instance_id: 'PROC-INSTANCE-1',
            process_code: 'PROC-618F58F6-A68C-4BFE-A92B-49B3CD9B79DD',
            title: '电商运营支出',
            status: 'RUNNING',
            result: '',
            originator_user_id: 'user-3',
            originator_user_name: '王五',
            originator_dept_id: 'dept-3',
            originator_dept_name: '电商运营部',
            create_time: new Date('2026-07-04T00:00:00.000Z'),
            finish_time: null,
            form_component_values: [],
            raw_payload: {
              businessId: 'BIZ-003',
              formComponentValues: [],
              tasks: [],
            },
          },
        ],
      };
    })
  );

  const result = await source.getProcessInstances(['PROC-INSTANCE-1', 'BIZ-404']);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'PROC-INSTANCE-1');
  assert.equal(result[0].instance?.businessId, 'BIZ-003');
  assert.equal(result[0].error, null);
  assert.equal(result[1].id, 'BIZ-404');
  assert.equal(result[1].instance, null);
  assert.match(result[1].error || '', /not found/i);
});
