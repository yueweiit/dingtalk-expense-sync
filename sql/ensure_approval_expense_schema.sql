-- Standalone business schema for DingTalk operation and purchase expense forms.
-- This schema is intentionally independent from approval_instances.
-- It models the form fields directly and keeps multi-row sections in child tables.

CREATE TABLE IF NOT EXISTS approval_expense_operation (
    id BIGSERIAL PRIMARY KEY,

    process_instance_id VARCHAR(128),
    business_id VARCHAR(64),

    request_date DATE,
    applicant_department VARCHAR(500),
    production_type VARCHAR(64),
    monthly_budget_amount NUMERIC(18, 2),
    monthly_budget_used_amount NUMERIC(18, 2),
    monthly_budget_remaining_amount NUMERIC(18, 2),
    application_type VARCHAR(128),
    expense_type VARCHAR(128),
    execution_region VARCHAR(128),
    form_name VARCHAR(128),
    platform VARCHAR(128),
    platform_name VARCHAR(255),
    store_name VARCHAR(255),

    operation_expense VARCHAR(128),
    employee_benefits_expense VARCHAR(128),
    bonus_expense VARCHAR(128),
    salary_expense VARCHAR(128),
    administrative_expense VARCHAR(128),
    vehicle_usage_expense VARCHAR(128),
    tax_expense VARCHAR(128),
    finance_related_expense VARCHAR(128),
    sales_expense VARCHAR(128),
    sales_channel_commission_expense VARCHAR(128),
    sales_team_customer_service_expense VARCHAR(128),
    other_sales_related_expense VARCHAR(128),
    marketing_advertising_expense VARCHAR(128),

    matter_description TEXT,
    payment_detail_reason TEXT,
    beneficiary VARCHAR(500),
    amount NUMERIC(18, 2),
    base_currency_amount NUMERIC(15, 2),
    payment_terms VARCHAR(255),
    currency VARCHAR(32),
    payment_date DATE,
    key_voucher TEXT,

    approval_completed_at TIMESTAMPTZ,
    approval_status VARCHAR(64),
    current_node VARCHAR(255),
    current_owner VARCHAR(500),
    historical_approvers TEXT,
    approval_no VARCHAR(128),
    creator_name VARCHAR(255),
    source_created_at TIMESTAMPTZ,
    source_updated_at TIMESTAMPTZ,
    creator_department VARCHAR(500),

    salary_by_department JSONB,
    social_insurance_by_department JSONB,
    office_space_by_department JSONB,
    individual_income_tax_by_department JSONB,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS monthly_budget_remaining_amount NUMERIC(18, 2);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS form_name VARCHAR(128);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS platform VARCHAR(128);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS platform_name VARCHAR(255);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS store_name VARCHAR(255);

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS payment_detail_reason TEXT;

ALTER TABLE approval_expense_operation
ADD COLUMN IF NOT EXISTS individual_income_tax_by_department JSONB;

COMMENT ON COLUMN approval_expense_operation.salary_by_department IS '工资中国分部门明细 — JSON array of {department, amount, note}';
COMMENT ON COLUMN approval_expense_operation.social_insurance_by_department IS '社保中国分部门明细 — JSON array of {department, amount}';
COMMENT ON COLUMN approval_expense_operation.office_space_by_department IS '办公场地总费用分部门明细 — JSON array of {department, amount}';
COMMENT ON COLUMN approval_expense_operation.individual_income_tax_by_department IS '个税分部门明细 — JSON array of {department, amount, note}';

CREATE TABLE IF NOT EXISTS approval_expense_purchase (
    id BIGSERIAL PRIMARY KEY,

    process_instance_id VARCHAR(128),
    business_id VARCHAR(64),

    request_date DATE,
    applicant_department VARCHAR(500),
    production_type VARCHAR(64),
    monthly_budget_amount NUMERIC(18, 2),
    monthly_budget_used_amount NUMERIC(18, 2),
    monthly_budget_remaining_amount NUMERIC(18, 2),
    form_name VARCHAR(128),

    purchase_expense VARCHAR(128),
    order_name VARCHAR(255),
    project_name VARCHAR(255),
    product_name VARCHAR(255),

    yw_oem_iml_phone_case VARCHAR(128),
    yw_oem_phone_case VARCHAR(128),
    yw_oem_tablet_case VARCHAR(128),
    yw_oem_support VARCHAR(128),
    yw_moldes_odm VARCHAR(128),
    consulting_services VARCHAR(128),
    tiktok_online_store VARCHAR(128),

    execution_region VARCHAR(128),
    order_purchase VARCHAR(128),
    expense_classification VARCHAR(255),
    investment_purchase VARCHAR(128),
    service_purchase VARCHAR(128),
    mro_classification VARCHAR(128),
    productive_mro VARCHAR(128),
    non_productive_mro VARCHAR(128),
    pds_classification VARCHAR(128),
    piecework_outsourcing VARCHAR(128),
    logistics_transport_service VARCHAR(128),
    customs_clearance_service VARCHAR(128),

    detail_summary_amount NUMERIC(18, 2),
    base_currency_amount NUMERIC(15, 2),
    key_voucher TEXT,

    approval_completed_at TIMESTAMPTZ,
    approval_status VARCHAR(64),
    current_node VARCHAR(255),
    current_owner VARCHAR(500),
    historical_approvers TEXT,
    approval_no VARCHAR(128),
    creator_name VARCHAR(255),
    source_created_at TIMESTAMPTZ,
    source_updated_at TIMESTAMPTZ,
    creator_department VARCHAR(500),

    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE approval_expense_purchase
ADD COLUMN IF NOT EXISTS monthly_budget_remaining_amount NUMERIC(18, 2);

ALTER TABLE approval_expense_purchase
ADD COLUMN IF NOT EXISTS form_name VARCHAR(128);

CREATE TABLE IF NOT EXISTS approval_expense_purchase_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES approval_expense_purchase(id) ON DELETE CASCADE,

    row_no INTEGER DEFAULT 1,
    item_name VARCHAR(500),
    image_url TEXT,
    item_code VARCHAR(128),
    item_specification TEXT,
    quantity NUMERIC(18, 4),
    inventory NUMERIC(18, 4),
    unit VARCHAR(64),
    unit_price NUMERIC(18, 4),
    total_amount NUMERIC(18, 2),

    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_expense_purchase_processors (
    id BIGSERIAL PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES approval_expense_purchase(id) ON DELETE CASCADE,

    row_no INTEGER DEFAULT 1,
    processor_name VARCHAR(500),
    processor_phone VARCHAR(64),
    odt VARCHAR(128),
    sales_order_no VARCHAR(128),
    processing_material TEXT,
    quantity NUMERIC(18, 4),
    unit_price NUMERIC(18, 4),
    total_amount NUMERIC(18, 2),
    specification_requirement_description TEXT,
    delivery_date DATE,

    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_expense_purchase_payments (
    id BIGSERIAL PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES approval_expense_purchase(id) ON DELETE CASCADE,

    row_no INTEGER DEFAULT 1,
    beneficiary VARCHAR(500),
    amount NUMERIC(18, 2),
    payment_terms VARCHAR(255),
    currency VARCHAR(32),
    payment_date DATE,

    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_expense_attachments (
    id BIGSERIAL PRIMARY KEY,
    parent_type VARCHAR(32) NOT NULL CHECK (parent_type IN ('operation', 'purchase')),
    parent_id BIGINT NOT NULL,

    row_no INTEGER DEFAULT 1,
    attachment_type VARCHAR(64),
    file_name VARCHAR(500),
    file_url TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_approval_expense_operation_business_id
    ON approval_expense_operation(business_id)
    WHERE business_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_approval_expense_operation_process_instance_id
    ON approval_expense_operation(process_instance_id)
    WHERE process_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_expense_operation_request_date
    ON approval_expense_operation(request_date);

CREATE INDEX IF NOT EXISTS idx_approval_expense_operation_department
    ON approval_expense_operation(applicant_department);

CREATE INDEX IF NOT EXISTS idx_approval_expense_operation_status
    ON approval_expense_operation(approval_status);

CREATE UNIQUE INDEX IF NOT EXISTS uk_approval_expense_purchase_business_id
    ON approval_expense_purchase(business_id)
    WHERE business_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_approval_expense_purchase_process_instance_id
    ON approval_expense_purchase(process_instance_id)
    WHERE process_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_request_date
    ON approval_expense_purchase(request_date);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_department
    ON approval_expense_purchase(applicant_department);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_status
    ON approval_expense_purchase(approval_status);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_items_purchase_id
    ON approval_expense_purchase_items(purchase_id);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_processors_purchase_id
    ON approval_expense_purchase_processors(purchase_id);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_payments_purchase_id
    ON approval_expense_purchase_payments(purchase_id);

CREATE INDEX IF NOT EXISTS idx_approval_expense_purchase_payments_payment_date
    ON approval_expense_purchase_payments(payment_date);

CREATE INDEX IF NOT EXISTS idx_approval_expense_attachments_parent
    ON approval_expense_attachments(parent_type, parent_id);

-- updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_approval_expense_operation') THEN
        CREATE TRIGGER set_updated_at_approval_expense_operation
            BEFORE UPDATE ON approval_expense_operation
            FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_approval_expense_purchase') THEN
        CREATE TRIGGER set_updated_at_approval_expense_purchase
            BEFORE UPDATE ON approval_expense_purchase
            FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
    END IF;
END;
$$;

COMMENT ON TABLE approval_expense_operation IS '钉钉运营支出审批表';
COMMENT ON COLUMN approval_expense_operation.id IS '主键ID';
COMMENT ON COLUMN approval_expense_operation.process_instance_id IS '钉钉审批实例ID';
COMMENT ON COLUMN approval_expense_operation.business_id IS '钉钉审批业务编号businessId';
COMMENT ON COLUMN approval_expense_operation.request_date IS '申请日期 Fecha de solicitud';
COMMENT ON COLUMN approval_expense_operation.applicant_department IS '申请部门/组织 Departamento Solicitante';
COMMENT ON COLUMN approval_expense_operation.production_type IS '生产/非生产 Producción / No producción';
COMMENT ON COLUMN approval_expense_operation.monthly_budget_amount IS '本月预算金额 Importe presupuestado del mes';
COMMENT ON COLUMN approval_expense_operation.monthly_budget_used_amount IS '本月预算已用金额 Importe utilizado del presupuesto mensual';
COMMENT ON COLUMN approval_expense_operation.monthly_budget_remaining_amount IS '本月预算剩余金额 Importe restante del presupuesto mensual';
COMMENT ON COLUMN approval_expense_operation.application_type IS '申请类型 Tipo de trámite';
COMMENT ON COLUMN approval_expense_operation.expense_type IS '支出类型';
COMMENT ON COLUMN approval_expense_operation.execution_region IS '执行地区 Región de ejecución';
COMMENT ON COLUMN approval_expense_operation.platform IS '平台 Plataforma';
COMMENT ON COLUMN approval_expense_operation.platform_name IS '平台名称 Nombre de la plataforma';
COMMENT ON COLUMN approval_expense_operation.store_name IS '店铺名称 Nombre de la tienda';
COMMENT ON COLUMN approval_expense_operation.operation_expense IS '管理支出 Gastos de operación';
COMMENT ON COLUMN approval_expense_operation.employee_benefits_expense IS '职工福利费 Gastos de beneficios laborales';
COMMENT ON COLUMN approval_expense_operation.bonus_expense IS '奖金 Bonificaciones';
COMMENT ON COLUMN approval_expense_operation.salary_expense IS '工资 salario';
COMMENT ON COLUMN approval_expense_operation.administrative_expense IS '管理费用 Gastos administrativos';
COMMENT ON COLUMN approval_expense_operation.vehicle_usage_expense IS '车辆使用费 gastos de uso de vehículo';
COMMENT ON COLUMN approval_expense_operation.tax_expense IS '税费 Impuestos';
COMMENT ON COLUMN approval_expense_operation.finance_related_expense IS '财务相关费用 Gastos relacionados con finanzas';
COMMENT ON COLUMN approval_expense_operation.sales_expense IS '销售费用 Gastos de venta';
COMMENT ON COLUMN approval_expense_operation.sales_channel_commission_expense IS '销售渠道管理与佣金费用 Gastos de gestión de canales de venta';
COMMENT ON COLUMN approval_expense_operation.sales_team_customer_service_expense IS '销售团队与客户服务费用 Gastos del equipo de ventas y servicio';
COMMENT ON COLUMN approval_expense_operation.other_sales_related_expense IS '其他销售相关费用 Otros gastos relacionados con las ventas';
COMMENT ON COLUMN approval_expense_operation.marketing_advertising_expense IS '市场推广与广告费用 Gastos de marketing, promoción y publicidad';
COMMENT ON COLUMN approval_expense_operation.matter_description IS '事项说明 Explicación de asuntos';
COMMENT ON COLUMN approval_expense_operation.payment_detail_reason IS '付款详细事由 Detalles de pago';
COMMENT ON COLUMN approval_expense_operation.beneficiary IS '收款人 beneficiario';
COMMENT ON COLUMN approval_expense_operation.amount IS '金额 importe';
COMMENT ON COLUMN approval_expense_operation.base_currency_amount IS '本位币金额（人民币）：按提交日汇率折算';
COMMENT ON COLUMN approval_expense_operation.payment_terms IS '付款条件 Términos de pago';
COMMENT ON COLUMN approval_expense_operation.currency IS '币种 Moneda';
COMMENT ON COLUMN approval_expense_operation.payment_date IS '付款日期 Fecha de pago';
COMMENT ON COLUMN approval_expense_operation.key_voucher IS '关键凭证 Comprobante clave';
COMMENT ON COLUMN approval_expense_operation.approval_completed_at IS '审批完成时间';
COMMENT ON COLUMN approval_expense_operation.approval_status IS '审批状态';
COMMENT ON COLUMN approval_expense_operation.current_node IS '当前节点';
COMMENT ON COLUMN approval_expense_operation.current_owner IS '当前负责人';
COMMENT ON COLUMN approval_expense_operation.historical_approvers IS '历史审批人';
COMMENT ON COLUMN approval_expense_operation.approval_no IS '审批编号';
COMMENT ON COLUMN approval_expense_operation.creator_name IS '创建人';
COMMENT ON COLUMN approval_expense_operation.source_created_at IS '创建时间';
COMMENT ON COLUMN approval_expense_operation.source_updated_at IS '更新时间';
COMMENT ON COLUMN approval_expense_operation.creator_department IS '创建人部门';
COMMENT ON COLUMN approval_expense_operation.raw_data IS '原始钉钉审批详情JSON';
COMMENT ON COLUMN approval_expense_operation.created_at IS '本表记录创建时间';
COMMENT ON COLUMN approval_expense_operation.updated_at IS '本表记录更新时间';

COMMENT ON TABLE approval_expense_purchase IS '钉钉采购支出审批主表';
COMMENT ON COLUMN approval_expense_purchase.id IS '主键ID';
COMMENT ON COLUMN approval_expense_purchase.process_instance_id IS '钉钉审批实例ID';
COMMENT ON COLUMN approval_expense_purchase.business_id IS '钉钉审批业务编号businessId';
COMMENT ON COLUMN approval_expense_purchase.request_date IS '申请日期 Fecha de solicitud';
COMMENT ON COLUMN approval_expense_purchase.applicant_department IS '申请部门/组织 Departamento Solicitante';
COMMENT ON COLUMN approval_expense_purchase.production_type IS '生产/非生产 Producción / No producción';
COMMENT ON COLUMN approval_expense_purchase.monthly_budget_amount IS '本月预算金额 Importe presupuestado del mes';
COMMENT ON COLUMN approval_expense_purchase.monthly_budget_used_amount IS '本月预算已用金额 Importe utilizado del presupuesto mensual';
COMMENT ON COLUMN approval_expense_purchase.monthly_budget_remaining_amount IS '本月预算剩余金额 Importe restante del presupuesto mensual';
COMMENT ON COLUMN approval_expense_purchase.form_name IS '表单来源名称，标识采购支出或电商采购支出';
COMMENT ON COLUMN approval_expense_purchase.purchase_expense IS '采购支出 Gastos de Compra';
COMMENT ON COLUMN approval_expense_purchase.order_name IS '订单 Pedido';
COMMENT ON COLUMN approval_expense_purchase.project_name IS '项目 Proyecto';
COMMENT ON COLUMN approval_expense_purchase.product_name IS '产品 Producto';
COMMENT ON COLUMN approval_expense_purchase.yw_oem_iml_phone_case IS 'YW OEM IML Phone Case OEM IML手机保护套类';
COMMENT ON COLUMN approval_expense_purchase.yw_oem_phone_case IS 'YW OEM Phone Case OEM手机保护套类';
COMMENT ON COLUMN approval_expense_purchase.yw_oem_tablet_case IS 'YW OEM Tablet Case YW OEM平板保护套类';
COMMENT ON COLUMN approval_expense_purchase.yw_oem_support IS 'YW OEM Soporte 支架类';
COMMENT ON COLUMN approval_expense_purchase.yw_moldes_odm IS 'YW MOLDES ODM YW模具ODM类';
COMMENT ON COLUMN approval_expense_purchase.consulting_services IS '咨询服务类 Servicios De Consultoría';
COMMENT ON COLUMN approval_expense_purchase.tiktok_online_store IS 'Tiktok线上店铺';
COMMENT ON COLUMN approval_expense_purchase.execution_region IS '执行地区 Región de ejecución';
COMMENT ON COLUMN approval_expense_purchase.order_purchase IS '订单采购 Compras por pedido';
COMMENT ON COLUMN approval_expense_purchase.expense_classification IS '费用分类 Clasificación de gastos';
COMMENT ON COLUMN approval_expense_purchase.investment_purchase IS '投资采购 Compra de inversión';
COMMENT ON COLUMN approval_expense_purchase.service_purchase IS '服务类采购 Adquisiciones de servicios';
COMMENT ON COLUMN approval_expense_purchase.mro_classification IS 'MRO分类 Clasificación MRO';
COMMENT ON COLUMN approval_expense_purchase.productive_mro IS '生产性 Productivo MRO';
COMMENT ON COLUMN approval_expense_purchase.non_productive_mro IS '非生产性 No productivo MRO';
COMMENT ON COLUMN approval_expense_purchase.pds_classification IS 'PDS分类 Clasificación PDS';
COMMENT ON COLUMN approval_expense_purchase.piecework_outsourcing IS '计件外包 Outsourcing por pieza';
COMMENT ON COLUMN approval_expense_purchase.logistics_transport_service IS '物流及运输服务 Servicios de logística y transporte';
COMMENT ON COLUMN approval_expense_purchase.customs_clearance_service IS '清关服务 Servicios de despacho aduanero';
COMMENT ON COLUMN approval_expense_purchase.detail_summary_amount IS '明细汇总金额 Monto total detallado';
COMMENT ON COLUMN approval_expense_purchase.base_currency_amount IS '本位币金额（人民币）：按提交日汇率折算';
COMMENT ON COLUMN approval_expense_purchase.key_voucher IS '关键凭证 Comprobante clave';
COMMENT ON COLUMN approval_expense_purchase.approval_completed_at IS '审批完成时间';
COMMENT ON COLUMN approval_expense_purchase.approval_status IS '审批状态';
COMMENT ON COLUMN approval_expense_purchase.current_node IS '当前节点';
COMMENT ON COLUMN approval_expense_purchase.current_owner IS '当前负责人';
COMMENT ON COLUMN approval_expense_purchase.historical_approvers IS '历史审批人';
COMMENT ON COLUMN approval_expense_purchase.approval_no IS '审批编号';
COMMENT ON COLUMN approval_expense_purchase.creator_name IS '创建人';
COMMENT ON COLUMN approval_expense_purchase.source_created_at IS '创建时间';
COMMENT ON COLUMN approval_expense_purchase.source_updated_at IS '更新时间';
COMMENT ON COLUMN approval_expense_purchase.creator_department IS '创建人部门';
COMMENT ON COLUMN approval_expense_purchase.raw_data IS '原始钉钉审批详情JSON';
COMMENT ON COLUMN approval_expense_purchase.created_at IS '本表记录创建时间';
COMMENT ON COLUMN approval_expense_purchase.updated_at IS '本表记录更新时间';

COMMENT ON TABLE approval_expense_purchase_items IS '采购支出需求明细/物品明细表';
COMMENT ON COLUMN approval_expense_purchase_items.id IS '主键ID';
COMMENT ON COLUMN approval_expense_purchase_items.purchase_id IS '采购支出主表ID';
COMMENT ON COLUMN approval_expense_purchase_items.row_no IS '明细行号';
COMMENT ON COLUMN approval_expense_purchase_items.item_name IS '物品名称 Nombre del artículo';
COMMENT ON COLUMN approval_expense_purchase_items.image_url IS '图片 Imagen';
COMMENT ON COLUMN approval_expense_purchase_items.item_code IS '物品编码 Código';
COMMENT ON COLUMN approval_expense_purchase_items.item_specification IS '物品规格 Especificacion';
COMMENT ON COLUMN approval_expense_purchase_items.quantity IS '数量 Cantidad';
COMMENT ON COLUMN approval_expense_purchase_items.inventory IS '库存 Inventario';
COMMENT ON COLUMN approval_expense_purchase_items.unit IS '单位 Unidad';
COMMENT ON COLUMN approval_expense_purchase_items.unit_price IS '单价 Precio';
COMMENT ON COLUMN approval_expense_purchase_items.total_amount IS '总金额 Monto Total';
COMMENT ON COLUMN approval_expense_purchase_items.raw_data IS '该明细行原始JSON';
COMMENT ON COLUMN approval_expense_purchase_items.created_at IS '本表记录创建时间';

COMMENT ON TABLE approval_expense_purchase_processors IS '采购支出加工商明细表';
COMMENT ON COLUMN approval_expense_purchase_processors.id IS '主键ID';
COMMENT ON COLUMN approval_expense_purchase_processors.purchase_id IS '采购支出主表ID';
COMMENT ON COLUMN approval_expense_purchase_processors.row_no IS '明细行号';
COMMENT ON COLUMN approval_expense_purchase_processors.processor_name IS '加工商名字 Nombre del proveedor de servicios de procesamiento';
COMMENT ON COLUMN approval_expense_purchase_processors.processor_phone IS '加工商电话 Teléfono del proveedor de servicios de procesamiento';
COMMENT ON COLUMN approval_expense_purchase_processors.odt IS 'ODT';
COMMENT ON COLUMN approval_expense_purchase_processors.sales_order_no IS '销售订单号码 El número de la orden de venta';
COMMENT ON COLUMN approval_expense_purchase_processors.processing_material IS '加工物料 Materiales de Procesamiento';
COMMENT ON COLUMN approval_expense_purchase_processors.quantity IS '数量 Cantidad';
COMMENT ON COLUMN approval_expense_purchase_processors.unit_price IS '单价 Precio Unitario';
COMMENT ON COLUMN approval_expense_purchase_processors.total_amount IS '总金额 Monto Total';
COMMENT ON COLUMN approval_expense_purchase_processors.specification_requirement_description IS '规格明细需求说明 Descripción de las necesidades de detalles';
COMMENT ON COLUMN approval_expense_purchase_processors.delivery_date IS '交付日期 Fecha de entrega';
COMMENT ON COLUMN approval_expense_purchase_processors.raw_data IS '该加工商明细行原始JSON';
COMMENT ON COLUMN approval_expense_purchase_processors.created_at IS '本表记录创建时间';

COMMENT ON TABLE approval_expense_purchase_payments IS '采购支出付款信息表，支持多组收款人/金额/付款日期';
COMMENT ON COLUMN approval_expense_purchase_payments.id IS '主键ID';
COMMENT ON COLUMN approval_expense_purchase_payments.purchase_id IS '采购支出主表ID';
COMMENT ON COLUMN approval_expense_purchase_payments.row_no IS '付款行号';
COMMENT ON COLUMN approval_expense_purchase_payments.beneficiary IS '收款人 beneficiario';
COMMENT ON COLUMN approval_expense_purchase_payments.amount IS '金额 importe';
COMMENT ON COLUMN approval_expense_purchase_payments.payment_terms IS '付款条件 Términos de pago';
COMMENT ON COLUMN approval_expense_purchase_payments.currency IS '币种 Moneda';
COMMENT ON COLUMN approval_expense_purchase_payments.payment_date IS '付款日期 Fecha de pago';
COMMENT ON COLUMN approval_expense_purchase_payments.raw_data IS '该付款行原始JSON';
COMMENT ON COLUMN approval_expense_purchase_payments.created_at IS '本表记录创建时间';

COMMENT ON TABLE approval_expense_attachments IS '通用凭证/附件表，运营支出和采购支出共用';
COMMENT ON COLUMN approval_expense_attachments.id IS '主键ID';
COMMENT ON COLUMN approval_expense_attachments.parent_type IS '所属业务类型：operation=运营支出，purchase=采购支出';
COMMENT ON COLUMN approval_expense_attachments.parent_id IS '所属主表ID，对应 approval_expense_operation.id 或 approval_expense_purchase.id';
COMMENT ON COLUMN approval_expense_attachments.row_no IS '附件行号';
COMMENT ON COLUMN approval_expense_attachments.attachment_type IS '附件类型，如关键凭证、图片等';
COMMENT ON COLUMN approval_expense_attachments.file_name IS '文件名';
COMMENT ON COLUMN approval_expense_attachments.file_url IS '文件地址';
COMMENT ON COLUMN approval_expense_attachments.raw_data IS '附件原始JSON';
COMMENT ON COLUMN approval_expense_attachments.created_at IS '本表记录创建时间';

-- 分部门拆分表（CQRS read model，从 JSONB 派生）
CREATE TABLE IF NOT EXISTS approval_expense_dept_split (
    id BIGSERIAL PRIMARY KEY,
    business_id VARCHAR(64) NOT NULL,
    split_type VARCHAR(32) NOT NULL CHECK (split_type IN ('salary', 'social_insurance', 'office_space', 'individual_income_tax')),
    department VARCHAR(500) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE approval_expense_dept_split
DROP CONSTRAINT IF EXISTS approval_expense_dept_split_split_type_check;

ALTER TABLE approval_expense_dept_split
ADD CONSTRAINT approval_expense_dept_split_split_type_check
CHECK (split_type IN ('salary', 'social_insurance', 'office_space', 'individual_income_tax'));

CREATE UNIQUE INDEX IF NOT EXISTS uk_dept_split_biz_type_dept
    ON approval_expense_dept_split(business_id, split_type, department);

CREATE INDEX IF NOT EXISTS idx_dept_split_biz
    ON approval_expense_dept_split(business_id);

CREATE INDEX IF NOT EXISTS idx_dept_split_type_dept
    ON approval_expense_dept_split(split_type, department);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_approval_expense_dept_split') THEN
        CREATE TRIGGER set_updated_at_approval_expense_dept_split
            BEFORE UPDATE ON approval_expense_dept_split
            FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
    END IF;
END;
$$;

COMMENT ON TABLE approval_expense_dept_split IS '运营支出分部门拆分表（CQRS read model）';
COMMENT ON COLUMN approval_expense_dept_split.business_id IS '关联审批 business_id';
COMMENT ON COLUMN approval_expense_dept_split.split_type IS '拆分类型：salary/social_insurance/office_space/individual_income_tax';
COMMENT ON COLUMN approval_expense_dept_split.department IS '部门名称';
COMMENT ON COLUMN approval_expense_dept_split.amount IS '拆分金额';
COMMENT ON COLUMN approval_expense_dept_split.note IS '备注';
