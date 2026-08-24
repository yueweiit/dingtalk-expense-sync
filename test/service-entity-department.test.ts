import assert from 'node:assert/strict';
import test from 'node:test';
import { createOaApprovalSource } from '../src/oa-source.ts';
import {
  extractCorrespondingDepartment,
  extractServiceEntityCode,
  routeByServiceEntity,
} from '../src/service-entity-department.ts';

function createFakeClient(rows: unknown[]) {
  return {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /path_names @> jsonb_build_array/);
      return { rows };
    },
  };
}

test('服务主体和对应部门必须在同一部门路径中精确匹配', async () => {
  const source = createOaApprovalSource(createFakeClient([{
    dept_id: 'child-1',
    name: 'PG生产',
    path_ids: ['root', 'entity-1', 'child-1'],
    path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
    is_current: true,
  }]));

  const resolved = await source.resolveServiceEntityDepartment({
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
  });

  assert.deepEqual(resolved, {
    status: 'resolved',
    department: 'PG生产',
    departmentId: 'child-1',
    departmentPathIds: ['root', 'entity-1', 'child-1'],
    departmentPathNames: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
  });
});

test('服务主体单独提交时只接受唯一同名部门', async () => {
  const source = createOaApprovalSource(createFakeClient([{
    dept_id: 'entity-1',
    name: '悦为智能 YW Tech_Ai',
    path_ids: ['root', 'entity-1'],
    path_names: ['ROOT', '悦为智能 YW Tech_Ai'],
    is_current: true,
  }]));

  const resolved = await source.resolveServiceEntityDepartment({
    serviceEntity: '悦为智能 YW Tech_Ai',
  });

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.departmentId, 'entity-1');
});

test('服务主体多层选择优先使用组件编码精确匹配部门 ID', async () => {
  const source = createOaApprovalSource(createFakeClient([{
    dept_id: '1092705940',
    name: 'PG生产Producción PG',
    path_ids: ['root', 'entity-1', '1092705940'],
    path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产Producción PG'],
    is_current: true,
  }]));

  const code = extractServiceEntityCode([{
    name: '服务主体Cliente',
    extValue: '{"code":"1092705940","name":"PG生产Producción PG"}',
  }]);
  const resolved = await source.resolveServiceEntityDepartment({
    serviceEntity: 'YUEWEI MX核心制造/PG生产Producción PG',
    serviceEntityCode: code,
  });

  assert.equal(code, '1092705940');
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.departmentId, '1092705940');
  assert.equal(resolved.department, 'PG生产Producción PG');
});

test('当前部门树存在同名歧义时不回退到历史部门', async () => {
  const source = createOaApprovalSource(createFakeClient([
    {
      dept_id: 'current-a',
      name: 'PG生产',
      path_ids: ['root', 'entity', 'current-a'],
      path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
      is_current: true,
    },
    {
      dept_id: 'current-b',
      name: 'PG生产',
      path_ids: ['root', 'entity', 'current-b'],
      path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
      is_current: true,
    },
    {
      dept_id: 'historical-only',
      name: 'PG生产',
      path_ids: ['root', 'entity', 'historical-only'],
      path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
      is_current: false,
    },
  ]));

  const resolved = await source.resolveServiceEntityDepartment({
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
  });

  assert.deepEqual(resolved, { status: 'unresolved' });
});

test('当前部门树没有匹配时不使用历史部门归属新表单', async () => {
  const source = createOaApprovalSource(createFakeClient([{
    dept_id: 'historical-only',
    name: 'PG生产',
    path_ids: ['root', 'entity', 'historical-only'],
    path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产'],
    is_current: false,
  }]));

  const resolved = await source.resolveServiceEntityDepartment({
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
  });

  assert.deepEqual(resolved, { status: 'unresolved' });
});

test('服务主体解析仅接受表单中明确的对应部门字段', () => {
  assert.equal(extractCorrespondingDepartment([
    { name: '申请部门', value: '不能使用' },
    { name: '对应的部门', value: 'PG生产' },
  ]), 'PG生产');
});

test('服务主体未能唯一归属时清空申请部门而不是回退到申请部门', async () => {
  const data: Record<string, unknown> = {
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
    applicantDepartment: '申请部门',
    applicantDepartmentId: 'old-id',
  };

  await routeByServiceEntity(data, {
    async resolveServiceEntityDepartment() {
      return { status: 'unresolved' };
    },
  });

  assert.deepEqual(data, {
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
    applicantDepartment: null,
    applicantDepartmentId: null,
    applicantDepartmentSource: 'service_entity_unresolved',
    applicantDepartmentPathIds: null,
    applicantDepartmentPathNames: null,
  });
});

test('服务主体精确归属覆盖主表身份但不修改明细行', async () => {
  const split = { department: '工资部门', departmentId: 'split-id', amount: 100 };
  const data: Record<string, unknown> = {
    serviceEntity: 'YUEWEI MX核心制造',
    correspondingDepartment: 'PG生产',
    applicantDepartment: '申请部门',
    salaryByDepartment: [split],
  };

  await routeByServiceEntity(data, {
    async resolveServiceEntityDepartment() {
      return {
        status: 'resolved',
        department: 'PG生产',
        departmentId: 'entity-child-id',
        departmentPathIds: ['root', 'entity-child-id'],
        departmentPathNames: ['ROOT', 'PG生产'],
      };
    },
  });

  assert.equal(data.applicantDepartment, 'PG生产');
  assert.equal(data.applicantDepartmentId, 'entity-child-id');
  assert.equal(data.applicantDepartmentSource, 'service_entity_exact');
  assert.deepEqual(data.salaryByDepartment, [split]);
});

test('服务主体组件存在但为空时也标记为待确认', async () => {
  const data: Record<string, unknown> = {
    serviceEntityExpected: true,
    applicantDepartment: '旧申请部门',
    applicantDepartmentId: 'old-id',
  };

  await routeByServiceEntity(data, {
    async resolveServiceEntityDepartment() {
      return { status: 'unresolved' };
    },
  });

  assert.equal(data.applicantDepartment, null);
  assert.equal(data.applicantDepartmentId, null);
  assert.equal(data.applicantDepartmentSource, 'service_entity_unresolved');
});
