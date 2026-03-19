import { RequestMalformedError } from '../../errors.js';

const CONFIG_REGEX = /^tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/;
const TASK_ONLY_REGEX = /^tasks\/([^/]+)(?:\/|$)/;

export const extractTaskId = (name: string): string => {
  const match = name.match(TASK_ONLY_REGEX);
  if (!match) {
    throw new RequestMalformedError(`Invalid or missing task ID in: "${name}"`);
  }
  return match[1];
};

export const generateTaskName = (taskId: string): string => {
  return `tasks/${taskId}`;
};

export const extractTaskAndPushNotificationConfigId = (
  name: string
): { taskId: string; configId: string } => {
  const match = name.match(CONFIG_REGEX);
  if (!match) {
    throw new RequestMalformedError(`Invalid or missing config ID in: "${name}"`);
  }
  return { taskId: match[1], configId: match[2] };
};

export const generatePushNotificationConfigName = (taskId: string, configId: string): string => {
  return `tasks/${taskId}/pushNotificationConfigs/${configId}`;
};
