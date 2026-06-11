import axios from 'axios';
import config from './config.ts';

interface DingTalkTokenResponse {
  errcode: number;
  errmsg: string;
  access_token?: string;
}

interface ProcessInstanceIdsResult {
  list: string[];
  nextToken: number;
}

interface ProcessInstanceQueryResponse {
  success: boolean;
  errorMsg?: string;
  result?: ProcessInstanceIdsResult;
}

interface ProcessInstanceDetailResponse {
  success: boolean;
  errorMsg?: string;
  result?: Record<string, unknown>;
}

class DingTalkAPI {
  private appkey: string | undefined;
  private appsecret: string | undefined;
  private processCodes: string[];
  private accessToken: string | null;
  private tokenExpireTime: number | null;
  private readonly maxRetryTimes: number;
  private readonly baseRetryDelayMs: number;

  constructor() {
    this.appkey = config.dingtalk.appkey;
    this.appsecret = config.dingtalk.appsecret;
    this.processCodes = config.dingtalk.processCodes;
    this.accessToken = null;
    this.tokenExpireTime = null;
    this.maxRetryTimes = 3;
    this.baseRetryDelayMs = 1000;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 格式化axios异常信息，便于定位403/权限问题
  formatAxiosError(error: unknown): string {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const data = typeof error.response.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response.data);
      return `HTTP ${status}, response=${data}`;
    }
    if (axios.isAxiosError(error) && error.request) {
      return `无响应: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  isQpsLimitError(error: unknown): boolean {
    if (!axios.isAxiosError(error) || !error.response?.data) {
      return false;
    }
    const responseData = error.response.data;
    if (typeof responseData === 'string') {
      return responseData.includes('QpsLimitForApi');
    }
    if (typeof responseData === 'object' && responseData !== null) {
      return (responseData as Record<string, unknown>).code === 'Forbidden.AccessDenied.QpsLimitForApi';
    }
    return false;
  }

  async requestWithRetry<T>(requestFn: () => Promise<T>, retryContext = ''): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetryTimes; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        const canRetry = this.isQpsLimitError(error) && attempt < this.maxRetryTimes;
        if (!canRetry) {
          break;
        }
        const delay = this.baseRetryDelayMs * (2 ** attempt);
        console.warn(`钉钉接口触发QPS限流${retryContext ? ` (${retryContext})` : ''}，${delay}ms后重试(${attempt + 1}/${this.maxRetryTimes})`);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  // 获取access token
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpireTime && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    try {
      const response = await axios.get<DingTalkTokenResponse>('https://oapi.dingtalk.com/gettoken', {
        params: {
          appkey: this.appkey,
          appsecret: this.appsecret
        }
      });

      if (response.data.errcode === 0) {
        this.accessToken = response.data.access_token ?? null;
        // token有效期2小时，提前5分钟刷新
        this.tokenExpireTime = Date.now() + (7200 - 300) * 1000;
        return this.accessToken!;
      } else {
        throw new Error(`获取token失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`获取token异常: ${error.message}`);
      }
      throw new Error(`获取token异常: ${String(error)}`);
    }
  }

  // 获取审批实例ID列表（单个流程）
  async queryProcessInstanceIds(
    startTime: number,
    endTime: number,
    processCode: string,
    nextToken = 0,
    maxResults = 20
  ): Promise<ProcessInstanceIdsResult> {
    const token = await this.getAccessToken();

    try {
      const response = await this.requestWithRetry(
        () => axios.post<ProcessInstanceQueryResponse>(
          'https://api.dingtalk.com/v1.0/workflow/processes/instanceIds/query',
          {
            processCode: processCode,
            startTime: startTime,
            endTime: endTime,
            nextToken: nextToken,
            maxResults: maxResults
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-acs-dingtalk-access-token': token
            }
          }
        ),
        `processCode=${processCode}, nextToken=${nextToken}`
      );

      if (response.data.success && response.data.result) {
        return response.data.result;
      } else {
        throw new Error(`查询实例ID失败: ${response.data.errorMsg}`);
      }
    } catch (error) {
      throw new Error(`查询实例ID异常(processCode=${processCode}, start=${startTime}, end=${endTime}, nextToken=${nextToken}): ${this.formatAxiosError(error)}`);
    }
  }

  // 获取实例详情
  async getProcessInstance(processInstanceId: string): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();

    try {
      const response = await this.requestWithRetry(
        () => axios.get<ProcessInstanceDetailResponse>(
          'https://api.dingtalk.com/v1.0/workflow/processInstances',
          {
            params: { processInstanceId },
            headers: {
              'Content-Type': 'application/json',
              'x-acs-dingtalk-access-token': token
            }
          }
        ),
        `processInstanceId=${processInstanceId}`
      );

      if (response.data.success && response.data.result) {
        const result = response.data.result;
        if (result && result.processInstanceId == null) {
          result.processInstanceId = processInstanceId;
        }
        return result;
      } else {
        throw new Error(`获取实例详情失败: ${response.data.errorMsg}`);
      }
    } catch (error) {
      throw new Error(`获取实例详情异常(processInstanceId=${processInstanceId}): ${this.formatAxiosError(error)}`);
    }
  }

  // 批量获取实例详情
  async getProcessInstances(instanceIds: string[]): Promise<Array<{ id: string; instance: Record<string, unknown> | null; error: string | null }>> {
    const results: Array<{ id: string; instance: Record<string, unknown> | null; error: string | null }> = [];
    for (const instanceId of instanceIds) {
      try {
        const instance = await this.getProcessInstance(instanceId);
        if (instance && instance.processInstanceId == null) {
          instance.processInstanceId = instanceId;
        }
        results.push({ id: instanceId, instance, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`获取实例 ${instanceId} 详情失败: ${message}`);
        results.push({ id: instanceId, instance: null, error: message });
      }
    }
    return results;
  }
}

export default new DingTalkAPI();
