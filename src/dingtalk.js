const axios = require('axios');
const config = require('./config');

class DingTalkAPI {
  constructor() {
    this.appkey = config.dingtalk.appkey;
    this.appsecret = config.dingtalk.appsecret;
    this.processCodes = config.dingtalk.processCodes;
    this.accessToken = null;
    this.tokenExpireTime = null;
    this.maxRetryTimes = 3;
    this.baseRetryDelayMs = 1000;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 格式化axios异常信息，便于定位403/权限问题
  formatAxiosError(error) {
    if (error.response) {
      const status = error.response.status;
      const data = typeof error.response.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response.data);
      return `HTTP ${status}, response=${data}`;
    }
    if (error.request) {
      return `无响应: ${error.message}`;
    }
    return error.message;
  }

  isQpsLimitError(error) {
    const responseData = error?.response?.data;
    if (!responseData) {
      return false;
    }
    if (typeof responseData === 'string') {
      return responseData.includes('QpsLimitForApi');
    }
    return responseData.code === 'Forbidden.AccessDenied.QpsLimitForApi';
  }

  async requestWithRetry(requestFn, retryContext = '') {
    let lastError = null;
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
  async getAccessToken() {
    if (this.accessToken && this.tokenExpireTime && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    try {
      const response = await axios.get('https://oapi.dingtalk.com/gettoken', {
        params: {
          appkey: this.appkey,
          appsecret: this.appsecret
        }
      });

      if (response.data.errcode === 0) {
        this.accessToken = response.data.access_token;
        // token有效期2小时，提前5分钟刷新
        this.tokenExpireTime = Date.now() + (7200 - 300) * 1000;
        return this.accessToken;
      } else {
        throw new Error(`获取token失败: ${response.data.errmsg}`);
      }
    } catch (error) {
      throw new Error(`获取token异常: ${error.message}`);
    }
  }

  // 获取审批实例ID列表（单个流程）
  async queryProcessInstanceIds(startTime, endTime, processCode, nextToken = 0, maxResults = 20) {
    const token = await this.getAccessToken();

    try {
      const response = await this.requestWithRetry(
        () => axios.post(
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

      if (response.data.success) {
        return response.data.result;
      } else {
        throw new Error(`查询实例ID失败: ${response.data.errorMsg}`);
      }
    } catch (error) {
      throw new Error(`查询实例ID异常(processCode=${processCode}, start=${startTime}, end=${endTime}, nextToken=${nextToken}): ${this.formatAxiosError(error)}`);
    }
  }

  // 获取实例详情
  async getProcessInstance(processInstanceId) {
    const token = await this.getAccessToken();

    try {
      const response = await this.requestWithRetry(
        () => axios.get(
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

      if (response.data.success) {
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
  async getProcessInstances(instanceIds) {
    const results = [];
    for (const instanceId of instanceIds) {
      try {
        const instance = await this.getProcessInstance(instanceId);
        if (instance && instance.processInstanceId == null) {
          instance.processInstanceId = instanceId;
        }
        results.push({ id: instanceId, instance, error: null });
      } catch (error) {
        console.error(`获取实例 ${instanceId} 详情失败: ${error.message}`);
        results.push({ id: instanceId, instance: null, error: error.message });
      }
    }
    return results;
  }
}

module.exports = new DingTalkAPI();
