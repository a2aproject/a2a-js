import { InternalError, InvalidParamsError } from '../../errors.js';
import {
  CancelTaskRequest,
  GetTaskRequest,
  CreateTaskPushNotificationConfigRequest,
  Message,
  SendMessageRequest,
  Part,
  SendMessageResponse,
  Task,
  TaskPushNotificationConfig,
  ListTaskPushNotificationConfigResponse,
  AgentCard,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  StreamResponse,
} from '../pb/a2a_types.js';
import { extractTaskId } from './id_decoding.js';

/**
 * Converts proto types to internal types.
 * Since we now use proto types as source of truth, this class is mostly an identity mapper
 * or handles minor structural differences if any legacy support is needed. Planned to be removed completely in the future.
 */
export class FromProto {
  static taskQueryParams(request: GetTaskRequest): GetTaskRequest {
    return request;
  }

  static taskIdParams(request: CancelTaskRequest): CancelTaskRequest {
    return request;
  }

  static createTaskPushNotificationConfig(
    request: CreateTaskPushNotificationConfigRequest
  ): TaskPushNotificationConfig {
    if (!request.config || !request.config.pushNotificationConfig) {
      throw new Error('Request must include a `config` with `pushNotificationConfig`');
    }
    return {
      name: `tasks/${extractTaskId(request.parent)}/pushNotificationConfigs/${request.config.pushNotificationConfig.id}`,
      pushNotificationConfig: request.config.pushNotificationConfig,
    };
  }

  static part(part: Part): Part {
    return part;
  }

  static messageSendParams(request: SendMessageRequest): SendMessageRequest {
    return request;
  }

  static sendMessageResult(response: SendMessageResponse): Task | Message {
    if (response.payload?.$case === 'task') {
      return response.payload.value;
    } else if (response.payload?.$case === 'msg') {
      return response.payload.value;
    }
    throw new InvalidParamsError('Invalid SendMessageResponse: missing result');
  }

  static task(task: Task): Task {
    return task;
  }

  static listTaskPushNotificationConfig(
    request: ListTaskPushNotificationConfigResponse
  ): TaskPushNotificationConfig[] {
    return request.configs;
  }

  static agentCard(agentCard: AgentCard): AgentCard {
    return agentCard;
  }

  static messageStreamResult(
    event: StreamResponse
  ): Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent {
    if (event.payload) {
      return event.payload.value;
    }
    throw new InternalError('Invalid event type in StreamResponse');
  }
}
