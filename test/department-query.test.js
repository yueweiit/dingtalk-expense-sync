import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDepartmentQuery } from '../src/department-query.ts';

test('uses the department ID instead of a same-name department query', () => {
  assert.deepEqual(resolveDepartmentQuery({
    department: 'OBG 线上业务部 Grupo de negocios en linea',
    departmentId: 'new-obg-mx',
  }), {
    mode: 'id',
    value: 'new-obg-mx',
  });
});

test('accepts all supported department ID parameter names', () => {
  for (const parameter of ['department_id', 'deptId', 'dept_id']) {
    assert.deepEqual(resolveDepartmentQuery({ [parameter]: 'dept-100' }), {
      mode: 'id',
      value: 'dept-100',
    });
  }
});

test('accepts DingTalk fixed Chinese department parameter name', () => {
  assert.deepEqual(resolveDepartmentQuery({
    '\u90e8\u95e8': 'Sales',
  }), {
    mode: 'name',
    value: 'Sales',
  });
});

test('keeps legacy department-name queries identifiable during connector migration', () => {
  assert.deepEqual(resolveDepartmentQuery({ department: 'OBG 线上业务组' }), {
    mode: 'name',
    value: 'OBG 线上业务组',
  });
});

test('keeps the full department name when exact matching distinguishes OBG and OBG1', () => {
  assert.deepEqual(resolveDepartmentQuery({
    department: 'OBG1 线上业务部 Grupo de negocios en linea',
  }), {
    mode: 'name',
    value: 'OBG1 线上业务部 Grupo de negocios en linea',
  });
});
