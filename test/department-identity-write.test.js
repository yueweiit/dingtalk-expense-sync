const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PASSWORD ??= 'test-password';

function loadModule(moduleName) {
  const sourcePath = path.join('..', 'src', moduleName);
  const module = require(sourcePath);
  return module.default || module;
}

const processorModule = require(path.join('..', 'src', 'processor.ts'));
const processor = processorModule.default || processorModule;
const ApprovalProcessor = processorModule.ApprovalProcessor;
const databaseModule = require(path.join('..', 'src', 'database'));
const database = databaseModule.default || databaseModule;
const pool = databaseModule.pool || databaseModule.default?.pool;

test('department split writes the selected department id and source', async () => {
  const businessId = `test-department-identity-${Date.now()}`;
  const processorWithoutPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map(),
  });
  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithoutPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [[
            {
              id: 'DepartmentField_1UHJJHSCID6O0',
              value: 'FC CN财务中心 Centro de finanzas',
              extendValue: [{ id: '1079492125' }],
            },
            { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
          ]],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department, department_id, department_source,
              department_path_ids, department_path_names
       FROM approval_expense_dept_split
       WHERE business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows, [{
      department: 'FC CN财务中心 Centro de finanzas',
      department_id: '1079492125',
      department_source: 'id',
      department_path_ids: null,
      department_path_names: null,
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('department split writes a path snapshot when OA has an unambiguous department id', async () => {
  const businessId = `test-department-path-${Date.now()}`;
  const processorWithPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async (departmentIds) => {
    assert.deepEqual(departmentIds, ['1079492125']);
    return new Map([['1079492125', {
      department: 'FC CN财务中心 Centro de finanzas',
      departmentPathIds: ['1', '1004758048', '1059222339', '1059287403', '1079492125'],
      departmentPathNames: ['ROOT', 'YUEWEI', '管理规划中心', 'FC 财务中心', 'FC CN财务中心'],
    }]]);
    },
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [[
            {
              id: 'DepartmentField_1UHJJHSCID6O0',
              value: 'FC CN财务中心 Centro de finanzas',
              extendValue: [{ id: '1079492125' }],
            },
            { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
          ]],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department_path_ids, department_path_names
       FROM approval_expense_dept_split
       WHERE business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows, [{
      department_path_ids: ['1', '1004758048', '1059222339', '1059287403', '1079492125'],
      department_path_names: ['ROOT', 'YUEWEI', '管理规划中心', 'FC 财务中心', 'FC CN财务中心'],
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('department splits keep same-name departments separate when their ids differ', async () => {
  const businessId = `test-department-identity-duplicate-name-${Date.now()}`;
  const processorWithoutPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map(),
  });
  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithoutPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      formComponentValues: [
        { name: '管理支出', value: '工资中国' },
        { name: '金额importe', value: '300' },
        { name: '币种Moneda', value: '人民币RMB' },
        {
          componentType: 'TableField',
          id: 'TableField_13B0RI3JBQXS0',
          details: [
            [
              { id: 'DepartmentField_1UHJJHSCID6O0', value: '同名部门', extendValue: [{ id: '100' }] },
              { id: 'MoneyField_T2TFVV7BXN40', value: '100' },
            ],
            [
              { id: 'DepartmentField_1UHJJHSCID6O0', value: '同名部门', extendValue: [{ id: '200' }] },
              { id: 'MoneyField_T2TFVV7BXN40', value: '200' },
            ],
          ],
        },
      ],
    });

    const result = await pool.query(
      `SELECT department_id, amount
       FROM approval_expense_dept_split
       WHERE business_id = $1
       ORDER BY department_id`,
      [businessId]
    );
    assert.deepEqual(result.rows, [
      { department_id: '100', amount: '100.00' },
      { department_id: '200', amount: '200.00' },
    ]);
  } finally {
    await pool.query('DELETE FROM approval_expense_dept_split WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('运营支出主表保存申请部门的 ID、来源与路径快照', async () => {
  const businessId = `test-applicant-department-operation-${Date.now()}`;
  const processorWithPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map([['1079492125', {
      department: 'PG1 国内注塑',
      departmentPathIds: ['1', '100', '1079492125'],
      departmentPathNames: ['ROOT', 'PG 生产组', 'PG1 国内注塑'],
    }]]),
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      originatorDeptId: 'originator-department-id',
      formComponentValues: [
        {
          name: '申请部门/组织 Departamento Solicitante',
          componentType: 'DepartmentField',
          value: 'PG1 国内注塑',
          extendValue: [{ id: '1079492125' }],
        },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
      ],
    });

    const result = await pool.query(
      `SELECT applicant_department, applicant_department_id, applicant_department_source,
              applicant_department_path_ids, applicant_department_path_names
       FROM approval_expense_operation
       WHERE business_id = $1`,
      [businessId]
    );

    assert.deepEqual(result.rows, [{
      applicant_department: 'PG1 国内注塑',
      applicant_department_id: '1079492125',
      applicant_department_source: 'form_id',
      applicant_department_path_ids: ['1', '100', '1079492125'],
      applicant_department_path_names: ['ROOT', 'PG 生产组', 'PG1 国内注塑'],
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('服务主体和对应部门会覆盖运营主表的申请部门身份', async () => {
  const businessId = `test-service-entity-operation-${Date.now()}`;
  const processorWithServiceEntityRouting = new ApprovalProcessor({
    getDepartmentSnapshots: async (departmentIds) => new Map(
      departmentIds.map((departmentId) => [departmentId, {
        department: departmentId === 'service-entity-child-id' ? 'PG生产Producción PG' : '申请部门',
        departmentPathIds: departmentId === 'service-entity-child-id'
          ? ['root', 'service-entity-parent-id', 'service-entity-child-id']
          : ['root', departmentId],
        departmentPathNames: departmentId === 'service-entity-child-id'
          ? ['ROOT', 'YUEWEI MX核心制造', 'PG生产Producción PG']
          : ['ROOT', '申请部门'],
      }])
    ),
    resolveServiceEntityDepartment: async ({ serviceEntity, correspondingDepartment }) => {
      assert.equal(serviceEntity, 'YUEWEI MX核心制造');
      assert.equal(correspondingDepartment, 'PG生产Producción PG');
      return {
        status: 'resolved',
        department: 'PG生产Producción PG',
        departmentId: 'service-entity-child-id',
        departmentPathIds: ['root', 'service-entity-parent-id', 'service-entity-child-id'],
        departmentPathNames: ['ROOT', 'YUEWEI MX核心制造', 'PG生产Producción PG'],
      };
    },
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithServiceEntityRouting.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-0DC5DE17-A29A-497C-8A1F-1324298A04AA',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-08-21T10:00:00+08:00',
      formComponentValues: [
        { name: '申请部门/组织 Departamento Solicitante', componentType: 'DepartmentField', value: '旧申请部门', extendValue: [{ id: 'old-applicant-id' }] },
        { name: '服务主体', value: 'YUEWEI MX核心制造' },
        { name: '对应的部门', value: 'PG生产Producción PG' },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
      ],
    });

    const result = await pool.query(
      `SELECT applicant_department, applicant_department_id, applicant_department_source,
              applicant_department_path_names, service_entity
       FROM approval_expense_operation
       WHERE business_id = $1`,
      [businessId]
    );
    assert.deepEqual(result.rows, [{
      applicant_department: 'PG生产Producción PG',
      applicant_department_id: 'service-entity-child-id',
      applicant_department_source: 'service_entity_exact',
      applicant_department_path_names: ['ROOT', 'YUEWEI MX核心制造', 'PG生产Producción PG'],
      service_entity: 'YUEWEI MX核心制造',
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test('采购支出主表在表单无 ID 时保存发起部门 ID', async () => {
  const businessId = `test-applicant-department-purchase-${Date.now()}`;
  const processorWithPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map([['1079492125', {
      department: 'PG1 国内注塑',
      departmentPathIds: ['1', '100', '1079492125'],
      departmentPathNames: ['ROOT', 'PG 生产组', 'PG1 国内注塑'],
    }]]),
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-BFDF6F09-4551-43B3-8C55-537AA74A241B',
      processType: '采购支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      originatorDeptId: '1079492125',
      formComponentValues: [
        { name: '申请部门/组织 Departamento Solicitante', componentType: 'DepartmentField', value: 'PG1 国内注塑' },
        { name: '明细汇总金额Monto total detallado', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
      ],
    });

    const result = await pool.query(
      `SELECT applicant_department, applicant_department_id, applicant_department_source,
              applicant_department_path_ids, applicant_department_path_names
       FROM approval_expense_purchase
       WHERE business_id = $1`,
      [businessId]
    );

    assert.deepEqual(result.rows, [{
      applicant_department: 'PG1 国内注塑',
      applicant_department_id: '1079492125',
      applicant_department_source: 'originator_id',
      applicant_department_path_ids: ['1', '100', '1079492125'],
      applicant_department_path_names: ['ROOT', 'PG 生产组', 'PG1 国内注塑'],
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_purchase WHERE business_id = $1', [businessId]);
  }
});

test('专用流程也以表单 extValue 中的部门 ID 为准，不覆盖实际归属', async () => {
  const businessId = `test-applicant-department-shared-form-${Date.now()}`;
  const processorWithPaths = new ApprovalProcessor({
    getDepartmentSnapshots: async () => new Map([['obg-cn-id', {
      department: 'OBG 线上业务组（中国）',
      departmentPathIds: ['1', 'cn', 'obg-cn-id'],
      departmentPathNames: ['ROOT', '中国', 'OBG 线上业务组（中国）'],
    }]]),
  });

  await database.ensureApprovalExpenseSchema();
  try {
    await processorWithPaths.processInstance({
      businessId,
      processInstanceId: `pid-${businessId}`,
      processCode: 'PROC-39D6CE87-6F84-40B1-A3EB-B96F363CE8F8',
      processType: '运营支出',
      status: 'RUNNING',
      createTime: '2026-07-22T10:00:00+08:00',
      originatorDeptId: 'originator-department-id',
      originatorDeptName: '财务中心',
      formComponentValues: [
        {
          name: '申请部门/组织 Departamento Solicitante',
          componentType: 'DepartmentField',
          value: 'OBG 线上业务组（中国）',
          extValue: '[{"itemId":"obg-cn-id","name":"OBG 线上业务组（中国）"}]',
        },
        { name: '金额importe', value: '100' },
        { name: '币种Moneda', value: '人民币RMB' },
      ],
    });

    const result = await pool.query(
      `SELECT applicant_department, applicant_department_id, applicant_department_source,
              applicant_department_path_ids, applicant_department_path_names
       FROM approval_expense_operation
       WHERE business_id = $1`,
      [businessId]
    );

    assert.deepEqual(result.rows, [{
      applicant_department: 'OBG 线上业务组（中国）',
      applicant_department_id: 'obg-cn-id',
      applicant_department_source: 'form_id',
      applicant_department_path_ids: ['1', 'cn', 'obg-cn-id'],
      applicant_department_path_names: ['ROOT', '中国', 'OBG 线上业务组（中国）'],
    }]);
  } finally {
    await pool.query('DELETE FROM approval_expense_operation WHERE business_id = $1', [businessId]);
  }
});

test.after(async () => {
  await pool.end();
});
