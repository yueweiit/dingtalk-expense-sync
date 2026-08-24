export interface ServiceEntityDepartmentResolution {
  status: 'resolved' | 'unresolved';
  department?: string;
  departmentId?: string;
  departmentPathIds?: string[];
  departmentPathNames?: string[];
}

export interface ServiceEntityDepartmentLookup {
  resolveServiceEntityDepartment(input: {
    serviceEntity: string;
    serviceEntityCode?: string | null;
    correspondingDepartment?: string | null;
  }): Promise<ServiceEntityDepartmentResolution>;
}

function text(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

const SERVICE_ENTITY_FIELD_NAMES = new Set(['服务主体Cliente', '服务主体']);

interface ServiceEntityField {
  name?: string;
  extendValue?: unknown;
  extValue?: unknown;
}

function findServiceEntityField(
  formComponentValues: ServiceEntityField[] | undefined,
) {
  return formComponentValues?.find((item) => SERVICE_ENTITY_FIELD_NAMES.has(String(item?.name || '').trim()));
}

export function hasServiceEntityField(
  formComponentValues: ServiceEntityField[] | undefined,
): boolean {
  return Boolean(findServiceEntityField(formComponentValues));
}

export function extractCorrespondingDepartment(
  formComponentValues: Array<{ name?: string; value?: unknown }> | undefined,
): string | null {
  const fieldNames = new Set([
    '对应部门',
    '对应的部门',
    '对应部门Departamento correspondiente',
    '对应的部门Departamento correspondiente',
    '所属部门',
    '所属部门Departamento al que pertenece',
  ]);
  const field = formComponentValues?.find((item) => fieldNames.has(String(item?.name || '').trim()));
  return text(field?.value);
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractServiceEntityCode(
  formComponentValues: ServiceEntityField[] | undefined,
): string | null {
  const field = findServiceEntityField(formComponentValues);
  const value = parseObject(field?.extendValue ?? field?.extValue);
  return text(value?.code);
}

export async function routeByServiceEntity(
  data: Record<string, unknown>,
  lookup?: ServiceEntityDepartmentLookup,
): Promise<'not_applicable' | 'resolved' | 'unresolved'> {
  const serviceEntity = text(data.serviceEntity);
  const serviceEntityCode = text(data.serviceEntityCode);
  const serviceEntityExpected = data.serviceEntityExpected === true;
  if (!serviceEntityExpected && !serviceEntity && !serviceEntityCode) {
    return 'not_applicable';
  }
  if (!lookup) {
    return 'not_applicable';
  }

  const correspondingDepartment = text(data.correspondingDepartment);
  const resolved = await lookup.resolveServiceEntityDepartment({
    serviceEntity: serviceEntity || '',
    serviceEntityCode,
    correspondingDepartment,
  });

  if (resolved.status !== 'resolved' || !resolved.department || !resolved.departmentId) {
    data.applicantDepartment = null;
    data.applicantDepartmentId = null;
    data.applicantDepartmentSource = 'service_entity_unresolved';
    data.applicantDepartmentPathIds = null;
    data.applicantDepartmentPathNames = null;
    return 'unresolved';
  }

  data.applicantDepartment = resolved.department;
  data.applicantDepartmentId = resolved.departmentId;
  data.applicantDepartmentSource = 'service_entity_exact';
  data.applicantDepartmentPathIds = resolved.departmentPathIds || null;
  data.applicantDepartmentPathNames = resolved.departmentPathNames || null;
  return 'resolved';
}
