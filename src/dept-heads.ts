import axios from 'axios';
import dingtalk from './dingtalk.ts';
import logger from './logger.ts';

interface SubDept {
  id: number;
  name: string;
}

interface DeptDetail {
  id: number;
  name: string;
  deptManagerUseridList?: string; // pipe-separated: "id1|id2|id3"
}

interface DeptHeadCache {
  data: Map<string, string[]>;  // normalized dept name -> head userIds
  fetchedAt: number;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
let cache: DeptHeadCache | null = null;

/** Normalize department name: trim, strip company prefix, lowercase for comparison */
function normalizeDeptName(name: string): string {
  let trimmed = name.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    trimmed = parts.slice(1).join(' ');
  }
  return trimmed.toLowerCase();
}

async function fetchAllDepts(): Promise<SubDept[]> {
  const token = await dingtalk.getAccessToken();
  try {
    const response = await axios.get<{ department?: SubDept[]; errcode?: number; errmsg?: string }>(
      'https://oapi.dingtalk.com/department/list',
      {
        params: { access_token: token, id: 1, fetch_child: true },
      }
    );
    if (response.data.errcode !== 0) {
      throw new Error(`获取部门列表失败: ${response.data.errmsg}`);
    }
    return response.data.department || [];
  } catch (error) {
    const message = dingtalk.formatAxiosError(error);
    logger.error(`获取部门列表失败: ${message}`);
    throw error;
  }
}

async function fetchDeptDetail(deptId: number): Promise<DeptDetail | null> {
  const token = await dingtalk.getAccessToken();
  try {
    const response = await axios.get<DeptDetail & { errcode?: number; errmsg?: string }>(
      'https://oapi.dingtalk.com/department/get',
      {
        params: { access_token: token, id: deptId },
      }
    );
    if (response.data.errcode && response.data.errcode !== 0) {
      logger.warn(`获取部门详情失败 deptId=${deptId}: ${response.data.errmsg}`);
      return null;
    }
    return response.data;
  } catch (error) {
    const message = dingtalk.formatAxiosError(error);
    logger.warn(`获取部门详情失败 deptId=${deptId}: ${message}`);
    return null;
  }
}

async function buildDeptHeadMap(): Promise<Map<string, string[]>> {
  logger.info('开始获取钉钉部门组织架构...');
  const depts = await fetchAllDepts();
  logger.info(`获取到 ${depts.length} 个部门`);

  const map = new Map<string, string[]>();

  for (const dept of depts) {
    await dingtalk.sleep(100); // rate limit spacing
    const detail = await fetchDeptDetail(dept.id);
    if (!detail || !detail.deptManagerUseridList || detail.deptManagerUseridList.length === 0) {
      continue;
    }

    // deptManagerUseridList is pipe-separated: "id1|id2|id3"
    const managerIds = detail.deptManagerUseridList.split('|').filter(Boolean);
    if (managerIds.length === 0) {
      continue;
    }

    // Store both original name and normalized name
    const normalized = normalizeDeptName(dept.name);
    map.set(normalized, managerIds);

    // Also store with original casing for exact match
    if (!map.has(dept.name.toLowerCase())) {
      map.set(dept.name.toLowerCase(), managerIds);
    }
  }

  logger.info(`部门负责人映射构建完成: ${map.size} 条映射`);
  return map;
}

async function getDeptHeadMap(forceRefresh = false): Promise<Map<string, string[]>> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const data = await buildDeptHeadMap();
  cache = { data, fetchedAt: Date.now() };
  return data;
}

/** Get head userIds for a department name. Returns empty array if not found. */
export async function getDeptHeadUserIds(deptName: string, forceRefresh = false): Promise<string[]> {
  const map = await getDeptHeadMap(forceRefresh);

  // Try exact match first
  const exact = map.get(deptName.toLowerCase());
  if (exact) return exact;

  // Try normalized match
  const normalized = normalizeDeptName(deptName);
  const byNormalized = map.get(normalized);
  if (byNormalized) return byNormalized;

  return [];
}

/** Get all department head mappings (normalized name -> userIds). Force-refreshes by default for weekly send. */
export async function getAllDeptHeadMappings(forceRefresh = true): Promise<Map<string, string[]>> {
  return getDeptHeadMap(forceRefresh);
}
