import { describe, expect, it } from 'vitest';
import {
  toCompatCancelTaskRequest,
  toCompatDeleteTaskPushNotificationConfigRequest,
  toCompatGetAuthenticatedExtendedCardRequest,
  toCompatGetTaskPushNotificationConfigRequest,
  toCompatGetTaskRequest,
  toCompatListTaskPushNotificationConfigRequest,
  toCompatListTaskPushNotificationConfigSuccessResponse,
  toCompatSendMessageRequest,
  toCompatSendMessageResponse,
  toCompatSendStreamingMessageRequest,
  toCompatSendMessageConfiguration,
  toCompatSetTaskPushNotificationConfigRequest,
  toCompatStreamResponse,
  toCompatTaskResubscriptionRequest,
  toCoreCancelTaskRequest,
  toCoreCreateTaskPushNotificationConfigRequest,
  toCoreDeleteTaskPushNotificationConfigRequest,
  toCoreGetExtendedAgentCardRequest,
  toCoreGetTaskPushNotificationConfigRequest,
  toCoreGetTaskRequest,
  toCoreListTaskPushNotificationConfigsRequest,
  toCoreListTaskPushNotificationConfigsResponse,
  toCoreSendMessageConfiguration,
  toCoreSendMessageRequest,
  toCoreSendMessageResponse,
  toCoreStreamResponse,
  toCoreSubscribeToTaskRequest,
} from '../../../../src/compat/v0_3/translate/requests.js';
import { A2AError } from '../../../../src/compat/v0_3/server/error.js';
import { Role, TaskState } from '../../../../src/types/pb/a2a.js';
import type {
  SendMessageRequest as V1SendMessageRequest,
  SendMessageResponse as V1SendMessageResponse,
  StreamResponse as V1StreamResponse,
  TaskPushNotificationConfig as V1TaskPushNotificationConfig,
} from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('requests', () => {
  describe('SendMessageConfiguration polarity inversion', () => {
    it('compat blocking=true → core returnImmediately=false', () => {
      const core = toCoreSendMessageConfiguration({ blocking: true });
      expect(core.returnImmediately).toBe(false);
    });

    it('compat blocking=false → core returnImmediately=true', () => {
      const core = toCoreSendMessageConfiguration({ blocking: false });
      expect(core.returnImmediately).toBe(true);
    });

    it('compat blocking undefined → core returnImmediately=true (v0.3 default is non-blocking)', () => {
      const core = toCoreSendMessageConfiguration({});
      expect(core.returnImmediately).toBe(true);
    });

    it('core returnImmediately=true → compat blocking=false', () => {
      const compat = toCompatSendMessageConfiguration({
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        historyLength: undefined,
        returnImmediately: true,
      });
      expect(compat.blocking).toBe(false);
    });

    it('core returnImmediately=false → compat blocking=true', () => {
      const compat = toCompatSendMessageConfiguration({
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        historyLength: undefined,
        returnImmediately: false,
      });
      expect(compat.blocking).toBe(true);
    });

    it('preserves empty acceptedOutputModes going core → compat', () => {
      const compat = toCompatSendMessageConfiguration({
        acceptedOutputModes: [],
        taskPushNotificationConfig: undefined,
        historyLength: undefined,
        returnImmediately: false,
      });
      expect(compat.acceptedOutputModes).toEqual([]);
    });

    it('round-trips an explicit empty acceptedOutputModes through v1', () => {
      const compat: legacy.MessageSendConfiguration = {
        blocking: true,
        acceptedOutputModes: [],
      };
      const back = toCompatSendMessageConfiguration(toCoreSendMessageConfiguration(compat));
      expect(back.acceptedOutputModes).toEqual([]);
    });
  });

  describe('SendMessageRequest', () => {
    function sampleCompatRequest(): legacy.SendMessageRequest {
      return {
        id: 'req-1',
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'hi' }],
          },
          configuration: { blocking: true },
          metadata: { source: 'tester' },
        },
      };
    }

    it('unwraps params and translates message + config', () => {
      const core = toCoreSendMessageRequest(sampleCompatRequest());
      expect(core.message?.role).toBe(Role.ROLE_USER);
      expect(core.configuration?.returnImmediately).toBe(false);
      expect(core.metadata).toEqual({ source: 'tester' });
    });

    it('builds a v0.3 envelope using the supplied requestId', () => {
      const core: V1SendMessageRequest = {
        tenant: '',
        message: {
          messageId: 'msg-1',
          contextId: '',
          taskId: '',
          role: Role.ROLE_USER,
          parts: [],
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: undefined,
      };
      const compat = toCompatSendMessageRequest(core, 'req-99');
      expect(compat.id).toBe('req-99');
      expect(compat.jsonrpc).toBe('2.0');
      expect(compat.method).toBe('message/send');
      expect(compat.params.message.messageId).toBe('msg-1');
    });

    it('uses message/stream when building a streaming envelope', () => {
      const core: V1SendMessageRequest = {
        tenant: '',
        message: {
          messageId: 'msg-1',
          contextId: '',
          taskId: '',
          role: Role.ROLE_USER,
          parts: [],
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: undefined,
      };
      const compat = toCompatSendStreamingMessageRequest(core, 'req-1');
      expect(compat.method).toBe('message/stream');
    });

    it('throws when v1 SendMessageRequest is missing the message', () => {
      expect(() =>
        toCompatSendMessageRequest(
          {
            tenant: '',
            message: undefined,
            configuration: undefined,
            metadata: undefined,
          },
          'r1'
        )
      ).toThrow(A2AError);
    });
  });

  describe('SendMessageResponse', () => {
    it('translates a task result both ways', () => {
      const core: V1SendMessageResponse = {
        payload: {
          $case: 'task',
          value: {
            id: 't-1',
            contextId: 'ctx',
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: undefined,
            },
            artifacts: [],
            history: [],
            metadata: undefined,
          },
        },
      };
      const compat = toCompatSendMessageResponse(core, 'req-1');
      expect(compat.id).toBe('req-1');
      expect((compat.result as legacy.Task2).kind).toBe('task');
      expect(toCoreSendMessageResponse({ ...compat })).toEqual(core);
    });

    it('translates a message result both ways', () => {
      const core: V1SendMessageResponse = {
        payload: {
          $case: 'message',
          value: {
            messageId: 'm-1',
            contextId: '',
            taskId: '',
            role: Role.ROLE_AGENT,
            parts: [],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
        },
      };
      const compat = toCompatSendMessageResponse(core, null);
      expect((compat.result as legacy.Message1).kind).toBe('message');
      expect(toCoreSendMessageResponse(compat)).toEqual(core);
    });

    it('throws when translating an error envelope to core', () => {
      const compatError: legacy.SendMessageResponse = {
        jsonrpc: '2.0',
        id: 'r-1',
        error: { code: -32603, message: 'boom' } as unknown as legacy.JSONRPCError,
      };
      expect(() => toCoreSendMessageResponse(compatError)).toThrow(A2AError);
    });
  });

  describe('StreamResponse', () => {
    it.each<V1StreamResponse['payload']>([
      {
        $case: 'message',
        value: {
          messageId: 'm-1',
          contextId: '',
          taskId: '',
          role: Role.ROLE_AGENT,
          parts: [],
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
        },
      },
      {
        $case: 'task',
        value: {
          id: 't-1',
          contextId: 'ctx',
          status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
          artifacts: [],
          history: [],
          metadata: undefined,
        },
      },
      {
        $case: 'statusUpdate',
        value: {
          taskId: 't-1',
          contextId: 'ctx',
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: undefined,
            timestamp: undefined,
          },
          metadata: undefined,
        },
      },
      {
        $case: 'artifactUpdate',
        value: {
          taskId: 't-1',
          contextId: 'ctx',
          artifact: {
            artifactId: 'a-1',
            name: '',
            description: '',
            parts: [],
            metadata: undefined,
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: undefined,
        },
      },
    ])('round-trips %#', (payload) => {
      const core: V1StreamResponse = { payload };
      const compat = toCompatStreamResponse(core, 'req-1');
      const back = toCoreStreamResponse(compat);
      expect(back).toEqual(core);
    });

    it('throws when translating an error envelope to core', () => {
      const compatError: legacy.SendStreamingMessageResponse = {
        jsonrpc: '2.0',
        id: 'r-1',
        error: { code: -32603, message: 'boom' } as unknown as legacy.JSONRPCError,
      };
      expect(() => toCoreStreamResponse(compatError)).toThrow(A2AError);
    });
  });

  describe('GetTaskRequest', () => {
    it('round-trips', () => {
      const compat: legacy.GetTaskRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { id: 't-1', historyLength: 5 },
      };
      const core = toCoreGetTaskRequest(compat);
      expect(core).toEqual({ tenant: '', id: 't-1', historyLength: 5 });
      expect(toCompatGetTaskRequest(core, 'r-1')).toEqual(compat);
    });
  });

  describe('CancelTaskRequest', () => {
    it('round-trips', () => {
      const compat: legacy.CancelTaskRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/cancel',
        params: { id: 't-1', metadata: { reason: 'user-request' } },
      };
      expect(toCompatCancelTaskRequest(toCoreCancelTaskRequest(compat), 'r-1')).toEqual(compat);
    });
  });

  describe('TaskResubscriptionRequest', () => {
    it('round-trips', () => {
      const compat: legacy.TaskResubscriptionRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/resubscribe',
        params: { id: 't-1' },
      };
      expect(
        toCompatTaskResubscriptionRequest(toCoreSubscribeToTaskRequest(compat), 'r-1')
      ).toEqual(compat);
    });
  });

  describe('SetTaskPushNotificationConfigRequest', () => {
    it('round-trips', () => {
      const compat: legacy.SetTaskPushNotificationConfigRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/set',
        params: {
          taskId: 't-1',
          pushNotificationConfig: {
            url: 'https://notify.example',
            id: 'cfg-1',
            token: 'tok',
            authentication: { schemes: ['Bearer'], credentials: 'cred' },
          },
        },
      };
      const core = toCoreCreateTaskPushNotificationConfigRequest(compat);
      expect(toCompatSetTaskPushNotificationConfigRequest(core, 'r-1')).toEqual(compat);
    });
  });

  describe('GetTaskPushNotificationConfigRequest', () => {
    it('round-trips with explicit pushNotificationConfigId', () => {
      const compat: legacy.GetTaskPushNotificationConfigRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/get',
        params: { id: 't-1', pushNotificationConfigId: 'cfg-1' },
      };
      const core = toCoreGetTaskPushNotificationConfigRequest(compat);
      expect(core).toEqual({ tenant: '', taskId: 't-1', id: 'cfg-1' });
      expect(toCompatGetTaskPushNotificationConfigRequest(core, 'r-1')).toEqual(compat);
    });

    it('uses TaskIdParams when no configId is provided', () => {
      const compat: legacy.GetTaskPushNotificationConfigRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/get',
        params: { id: 't-1' },
      };
      const core = toCoreGetTaskPushNotificationConfigRequest(compat);
      expect(core.id).toBe('');
      const back = toCompatGetTaskPushNotificationConfigRequest(core, 'r-1');
      expect(back.params).toEqual({ id: 't-1' });
    });
  });

  describe('DeleteTaskPushNotificationConfigRequest', () => {
    it('round-trips', () => {
      const compat: legacy.DeleteTaskPushNotificationConfigRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/delete',
        params: { id: 't-1', pushNotificationConfigId: 'cfg-1' },
      };
      expect(
        toCompatDeleteTaskPushNotificationConfigRequest(
          toCoreDeleteTaskPushNotificationConfigRequest(compat),
          'r-1'
        )
      ).toEqual(compat);
    });
  });

  describe('ListTaskPushNotificationConfigRequest', () => {
    it('round-trips', () => {
      const compat: legacy.ListTaskPushNotificationConfigRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'tasks/pushNotificationConfig/list',
        params: { id: 't-1' },
      };
      expect(
        toCompatListTaskPushNotificationConfigRequest(
          toCoreListTaskPushNotificationConfigsRequest(compat),
          'r-1'
        )
      ).toEqual(compat);
    });
  });

  describe('ListTaskPushNotificationConfigSuccessResponse', () => {
    it('round-trips a list of configs', () => {
      const cfg: V1TaskPushNotificationConfig = {
        tenant: '',
        taskId: 't-1',
        id: 'cfg-1',
        url: 'https://notify.example',
        token: '',
        authentication: undefined,
      };
      const core = { configs: [cfg], nextPageToken: '' };
      const compat = toCompatListTaskPushNotificationConfigSuccessResponse(core, 'r-1');
      expect(compat.result).toHaveLength(1);
      const back = toCoreListTaskPushNotificationConfigsResponse(compat);
      expect(back.configs).toEqual(core.configs);
    });
  });

  describe('GetExtendedAgentCardRequest', () => {
    it('round-trips', () => {
      const compat: legacy.GetAuthenticatedExtendedCardRequest = {
        id: 'r-1',
        jsonrpc: '2.0',
        method: 'agent/getAuthenticatedExtendedCard',
      };
      const core = toCoreGetExtendedAgentCardRequest(compat);
      expect(core).toEqual({ tenant: '' });
      expect(toCompatGetAuthenticatedExtendedCardRequest(core, 'r-1')).toEqual(compat);
    });
  });
});
