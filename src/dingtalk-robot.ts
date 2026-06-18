import axios from 'axios';
import dingtalk from './dingtalk.ts';
import config from './config.ts';
import logger from './logger.ts';

interface RobotMessageResult {
  success: boolean;
  processQueryKey?: string;
  invalidStaffIds?: string[];
  flowControlledStaffIds?: string[];
  error?: string;
}

interface MarkdownMessage {
  title: string;
  text: string;
}

interface BatchSendResponse {
  processQueryKey?: string;
  invalidStaffIdList?: string[];
  flowControlledStaffIdList?: string[];
}

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 200;

/** Get access token using robot app credentials (separate from expense sync app) */
async function getRobotAccessToken(): Promise<string> {
  const robotAppkey = config.dingtalk.robotAppkey;
  const robotAppsecret = config.dingtalk.robotAppsecret;

  if (!robotAppkey || !robotAppsecret) {
    throw new Error('DINGTALK_ROBOT_APPKEY / DINGTALK_ROBOT_APPSECRET 未配置，无法获取机器人token');
  }

  const response = await axios.get<{ errcode: number; errmsg: string; access_token?: string }>(
    'https://oapi.dingtalk.com/gettoken',
    { params: { appkey: robotAppkey, appsecret: robotAppsecret } }
  );

  if (response.data.errcode !== 0 || !response.data.access_token) {
    throw new Error(`获取机器人token失败: ${response.data.errmsg}`);
  }

  return response.data.access_token;
}

async function sendBatch(
  userIds: string[],
  markdown: MarkdownMessage
): Promise<RobotMessageResult> {
  const robotCode = config.dingtalk.robotCode;
  if (!robotCode) {
    throw new Error('DINGTALK_ROBOT_CODE 未配置，无法发送机器人消息');
  }

  const token = await getRobotAccessToken();

  try {
    const response = await dingtalk.requestWithRetry(
      () => axios.post<BatchSendResponse>(
        'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
        {
          robotCode,
          userIds,
          msgKey: 'sampleMarkdown',
          msgParam: JSON.stringify({ title: markdown.title, text: markdown.text }),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
        }
      ),
      `robot batchSend (${userIds.length} users)`
    );

    const data = response.data;
    const invalidStaffIds = data.invalidStaffIdList || [];
    const flowControlledStaffIds = data.flowControlledStaffIdList || [];
    const allDelivered = invalidStaffIds.length === 0 && flowControlledStaffIds.length === 0;

    if (!allDelivered) {
      if (invalidStaffIds.length > 0) {
        logger.warn(`机器人消息: 无效userId: ${invalidStaffIds.join(', ')}`);
      }
      if (flowControlledStaffIds.length > 0) {
        logger.warn(`机器人消息: 被限流userId: ${flowControlledStaffIds.join(', ')}`);
      }
    }

    return {
      success: allDelivered,
      processQueryKey: data.processQueryKey,
      invalidStaffIds,
      flowControlledStaffIds,
      error: allDelivered ? undefined : `部分发送失败: invalid=${invalidStaffIds.length}, flowControlled=${flowControlledStaffIds.length}`,
    };
  } catch (error) {
    const message = dingtalk.formatAxiosError(error);
    logger.error(`机器人消息发送异常: ${message}`);
    return { success: false, error: message };
  }
}

export async function sendMarkdownToUsers(
  userIds: string[],
  markdown: MarkdownMessage
): Promise<RobotMessageResult> {
  if (userIds.length === 0) {
    return { success: true };
  }

  if (userIds.length <= BATCH_SIZE) {
    return sendBatch(userIds, markdown);
  }

  // Split into batches of 20
  const allInvalid: string[] = [];
  const allFlowControlled: string[] = [];
  let lastQueryKey: string | undefined;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const result = await sendBatch(chunk, markdown);

    if (result.invalidStaffIds) allInvalid.push(...result.invalidStaffIds);
    if (result.flowControlledStaffIds) allFlowControlled.push(...result.flowControlledStaffIds);
    if (result.processQueryKey) lastQueryKey = result.processQueryKey;

    if (!result.success && result.error && !result.invalidStaffIds?.length && !result.flowControlledStaffIds?.length) {
      // Hard failure (not partial), propagate
      return result;
    }

    if (i + BATCH_SIZE < userIds.length) {
      await dingtalk.sleep(BATCH_DELAY_MS);
    }
  }

  const allDelivered = allInvalid.length === 0 && allFlowControlled.length === 0;
  return {
    success: allDelivered,
    processQueryKey: lastQueryKey,
    invalidStaffIds: allInvalid,
    flowControlledStaffIds: allFlowControlled,
    error: allDelivered ? undefined : `部分发送失败: invalid=${allInvalid.length}, flowControlled=${allFlowControlled.length}`,
  };
}
