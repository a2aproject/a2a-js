import { A2AError } from '../../server/error.js';

const TASK_ID_REGEX = /tasks\/([^/]+)/;
const CONFIG_ID_REGEX = /pushNotificationConfigs\/([^/]+)/;

export const extractTaskId = (name: string): string => {
  const match = name.match(TASK_ID_REGEX);
  if (!match) {
    throw A2AError.invalidParams(`Invalid or missing task ID in: "${name}"`);
  }
  return match[1];
};

export const generateTaskName = (taskId: string): string => {
  return `tasks/${taskId}`;
};

export const extractPushNotificationConfigId = (name: string): string => {
  const match = name.match(CONFIG_ID_REGEX);
  if (!match) {
    throw A2AError.invalidParams(`Invalid or missing config ID in: "${name}"`);
  }
  return match[1];
};

export const generatePushNotificationConfigName = (taskId: string, configId: string): string => {
  return `tasks/${taskId}/pushNotificationConfigs/${configId}`;
};
