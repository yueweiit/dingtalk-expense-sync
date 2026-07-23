const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PASSWORD ??= 'test-password';

const { parseApplicantDepartmentIdentity } = require(path.join('..', 'src', 'processor.ts'));
const { ApprovalProcessor } = require(path.join('..', 'src', 'processor.ts'));

test('申请部门优先使用表单组件中的部门 ID', () => {
  const result = parseApplicantDepartmentIdentity([
    {
      componentType: 'DepartmentField',
      value: 'PG1 国内注塑',
      extendValue: [{ id: '1079492125' }],
    },
  ], {
    originatorDeptId: 'originator-department-id',
    originatorDeptName: '发起部门',
  });

  assert.deepEqual(result, {
    department: 'PG1 国内注塑',
    departmentId: '1079492125',
    departmentSource: 'form_id',
  });
});

test('表单没有部门 ID 时使用发起部门 ID 兜底', () => {
  const result = parseApplicantDepartmentIdentity([
    {
      componentType: 'DepartmentField',
      value: 'PG1 国内注塑',
    },
  ], {
    originatorDeptId: '1079492125',
    originatorDeptName: 'PG1 国内注塑',
  });

  assert.deepEqual(result, {
    department: 'PG1 国内注塑',
    departmentId: '1079492125',
    departmentSource: 'originator_id',
  });
});

test('没有任何部门 ID 时保留名称并标记为仅名称', () => {
  const result = parseApplicantDepartmentIdentity([
    {
      componentType: 'DepartmentField',
      value: '历史部门',
    },
  ], {
    originatorDeptName: '发起部门',
  });

  assert.deepEqual(result, {
    department: '历史部门',
    departmentId: null,
    departmentSource: 'name_only',
  });
});

test('运营支出解析保留申请部门身份字段', () => {
  const processor = new ApprovalProcessor();
  const result = processor.parseOperationExpenseData([
    {
      componentType: 'DepartmentField',
      value: 'PG1 国内注塑',
      extendValue: [{ id: '1079492125' }],
    },
  ], {
    originatorDeptId: 'originator-department-id',
  });

  assert.equal(result.applicantDepartment, 'PG1 国内注塑');
  assert.equal(result.applicantDepartmentId, '1079492125');
  assert.equal(result.applicantDepartmentSource, 'form_id');
});

test('采购支出解析在表单无 ID 时使用发起部门 ID', () => {
  const processor = new ApprovalProcessor();
  const result = processor.parsePurchaseExpenseData([
    {
      componentType: 'DepartmentField',
      value: 'PG1 国内注塑',
    },
  ], {
    originatorDeptId: '1079492125',
  });

  assert.equal(result.applicantDepartment, 'PG1 国内注塑');
  assert.equal(result.applicantDepartmentId, '1079492125');
  assert.equal(result.applicantDepartmentSource, 'originator_id');
});
