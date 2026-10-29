import { describe, it, expect } from 'vitest';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_JSON_CONTENT_TYPE,
  LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD,
  LEGACY_METHOD_MESSAGE_SEND,
  LEGACY_METHOD_MESSAGE_STREAM,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET,
  LEGACY_METHOD_TASKS_CANCEL,
  LEGACY_METHOD_TASKS_GET,
  LEGACY_METHOD_TASKS_RESUBSCRIBE,
  LEGACY_GRPC_TO_LEGACY_JSONRPC,
  LEGACY_GRPC_TO_V1,
  LEGACY_JSONRPC_TO_LEGACY_GRPC,
  LEGACY_JSONRPC_TO_V1,
  V1_METHODS_WITHOUT_LEGACY_EQUIVALENT,
  V1_TO_LEGACY_GRPC,
  V1_TO_LEGACY_JSONRPC,
  legacyGrpcToLegacyJsonRpcMethod,
  legacyGrpcToV1Method,
  legacyJsonRpcToLegacyGrpcMethod,
  legacyJsonRpcToV1Method,
  v1MethodToLegacyGrpc,
  v1MethodToLegacyJsonRpc,
  isLegacyJsonRpcMethod,
  isV1JsonRpcMethod,
} from '../../../src/compat/v0_3/constants.js';
import { A2AError, isJsonRpcError } from '../../../src/errors/index.js';
import { JSON_RPC_ERROR_CODE } from '../../../src/errors/json_rpc.js';

/** Reads the wire code from a thrown error: envelopeCode wins, else per-error map. */
function wireCode(err: unknown): number | undefined {
  if (isJsonRpcError(err)) return err.envelopeCode;
  if (err instanceof A2AError) return JSON_RPC_ERROR_CODE[err.name];
  return undefined;
}

const ALL_LEGACY_METHODS = [
  LEGACY_METHOD_MESSAGE_SEND,
  LEGACY_METHOD_MESSAGE_STREAM,
  LEGACY_METHOD_TASKS_GET,
  LEGACY_METHOD_TASKS_CANCEL,
  LEGACY_METHOD_TASKS_RESUBSCRIBE,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST,
  LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE,
  LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD,
];

describe('compat/v0_3/constants - protocol/transport constants', () => {
  it('exposes the correct legacy protocol version', () => {
    expect(A2A_LEGACY_PROTOCOL_VERSION).toBe('0.3');
  });

  it('exposes the X-prefixed legacy extension header', () => {
    expect(LEGACY_HTTP_EXTENSION_HEADER).toBe('X-A2A-Extensions');
  });

  it('exposes the legacy plain JSON content type', () => {
    expect(LEGACY_JSON_CONTENT_TYPE).toBe('application/json');
  });
});

describe('compat/v0_3/constants - mapping completeness', () => {
  it('LEGACY_JSONRPC_TO_V1 contains every named legacy method', () => {
    for (const method of ALL_LEGACY_METHODS) {
      expect(LEGACY_JSONRPC_TO_V1, `missing ${method}`).toHaveProperty(method);
    }
    expect(Object.keys(LEGACY_JSONRPC_TO_V1)).toHaveLength(ALL_LEGACY_METHODS.length);
  });

  it('LEGACY_JSONRPC_TO_LEGACY_GRPC contains every named legacy method', () => {
    for (const method of ALL_LEGACY_METHODS) {
      expect(LEGACY_JSONRPC_TO_LEGACY_GRPC, `missing ${method}`).toHaveProperty(method);
    }
    expect(Object.keys(LEGACY_JSONRPC_TO_LEGACY_GRPC)).toHaveLength(ALL_LEGACY_METHODS.length);
  });
});

describe('compat/v0_3/constants - round-trip invariants', () => {
  it('LEGACY_JSONRPC_TO_V1 <-> V1_TO_LEGACY_JSONRPC is bijective', () => {
    for (const [legacy, v1] of Object.entries(LEGACY_JSONRPC_TO_V1)) {
      expect(V1_TO_LEGACY_JSONRPC[v1]).toBe(legacy);
    }
    for (const [v1, legacy] of Object.entries(V1_TO_LEGACY_JSONRPC)) {
      expect(LEGACY_JSONRPC_TO_V1[legacy]).toBe(v1);
    }
  });

  it('LEGACY_JSONRPC_TO_LEGACY_GRPC <-> LEGACY_GRPC_TO_LEGACY_JSONRPC is bijective', () => {
    for (const [jsonRpc, grpc] of Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC)) {
      expect(LEGACY_GRPC_TO_LEGACY_JSONRPC[grpc]).toBe(jsonRpc);
    }
    for (const [grpc, jsonRpc] of Object.entries(LEGACY_GRPC_TO_LEGACY_JSONRPC)) {
      expect(LEGACY_JSONRPC_TO_LEGACY_GRPC[jsonRpc]).toBe(grpc);
    }
  });

  it('LEGACY_GRPC_TO_V1 <-> V1_TO_LEGACY_GRPC is bijective', () => {
    for (const [legacyGrpc, v1] of Object.entries(LEGACY_GRPC_TO_V1)) {
      expect(V1_TO_LEGACY_GRPC[v1]).toBe(legacyGrpc);
    }
    for (const [v1, legacyGrpc] of Object.entries(V1_TO_LEGACY_GRPC)) {
      expect(LEGACY_GRPC_TO_V1[legacyGrpc]).toBe(v1);
    }
  });

  it('legacy gRPC -> v1 is the composition of legacy gRPC -> legacy JSON-RPC -> v1', () => {
    for (const [legacyGrpc, v1] of Object.entries(LEGACY_GRPC_TO_V1)) {
      const viaJsonRpc = LEGACY_JSONRPC_TO_V1[LEGACY_GRPC_TO_LEGACY_JSONRPC[legacyGrpc]];
      expect(viaJsonRpc).toBe(v1);
    }
  });
});

describe('compat/v0_3/constants - asymmetric v1.0 methods', () => {
  it('V1_METHODS_WITHOUT_LEGACY_EQUIVALENT contains ListTasks', () => {
    expect(V1_METHODS_WITHOUT_LEGACY_EQUIVALENT.has('ListTasks')).toBe(true);
  });

  it('every entry in V1_METHODS_WITHOUT_LEGACY_EQUIVALENT is absent from both V1 -> legacy maps', () => {
    for (const method of V1_METHODS_WITHOUT_LEGACY_EQUIVALENT) {
      expect(V1_TO_LEGACY_JSONRPC, `JSON-RPC has unexpected ${method}`).not.toHaveProperty(method);
      expect(V1_TO_LEGACY_GRPC, `gRPC has unexpected ${method}`).not.toHaveProperty(method);
    }
  });

  it('v1MethodToLegacyJsonRpc throws unsupportedOperation (-32004) for ListTasks', () => {
    try {
      v1MethodToLegacyJsonRpc('ListTasks');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32004);
      expect((err as Error).message).toContain('ListTasks');
      expect((err as Error).message).toContain('JSON-RPC');
    }
  });

  it('v1MethodToLegacyGrpc throws unsupportedOperation (-32004) for ListTasks', () => {
    try {
      v1MethodToLegacyGrpc('ListTasks');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32004);
      expect((err as Error).message).toContain('ListTasks');
      expect((err as Error).message).toContain('gRPC');
    }
  });
});

describe('compat/v0_3/constants - helper error behaviour', () => {
  it('legacyJsonRpcToV1Method throws A2AError(invalidRequest) on unknown input', () => {
    try {
      legacyJsonRpcToV1Method('does/not/exist');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
      expect((err as Error).message).toContain('does/not/exist');
    }
  });

  it('v1MethodToLegacyJsonRpc throws A2AError(invalidRequest) on unknown input', () => {
    try {
      v1MethodToLegacyJsonRpc('NotAMethod');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
    }
  });

  it('legacyJsonRpcToLegacyGrpcMethod throws A2AError(invalidRequest) on unknown input', () => {
    try {
      legacyJsonRpcToLegacyGrpcMethod('still/nope');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
    }
  });

  it('legacyGrpcToLegacyJsonRpcMethod throws A2AError(invalidRequest) on unknown input', () => {
    try {
      legacyGrpcToLegacyJsonRpcMethod('NopeNope');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
    }
  });

  it('v1MethodToLegacyGrpc throws A2AError(invalidRequest) on gibberish input', () => {
    try {
      v1MethodToLegacyGrpc('NotARealMethodAtAll');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
    }
  });

  it('legacyGrpcToV1Method throws A2AError(invalidRequest) on unknown input', () => {
    try {
      legacyGrpcToV1Method('AlsoFake');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(A2AError);
      expect(wireCode(err)).toBe(-32600);
    }
  });
});

describe('compat/v0_3/constants - divergent-name spot checks', () => {
  it('tasks/resubscribe maps to v1.0 SubscribeToTask but legacy gRPC TaskSubscription', () => {
    expect(legacyJsonRpcToV1Method('tasks/resubscribe')).toBe('SubscribeToTask');
    expect(legacyJsonRpcToLegacyGrpcMethod('tasks/resubscribe')).toBe('TaskSubscription');
  });

  it('agent/getAuthenticatedExtendedCard maps to v1.0 GetExtendedAgentCard but legacy gRPC GetAgentCard', () => {
    expect(legacyJsonRpcToV1Method('agent/getAuthenticatedExtendedCard')).toBe(
      'GetExtendedAgentCard'
    );
    expect(legacyJsonRpcToLegacyGrpcMethod('agent/getAuthenticatedExtendedCard')).toBe(
      'GetAgentCard'
    );
  });

  it('tasks/pushNotificationConfig/list maps to v1.0 plural and legacy gRPC singular', () => {
    expect(legacyJsonRpcToV1Method('tasks/pushNotificationConfig/list')).toBe(
      'ListTaskPushNotificationConfigs'
    );
    expect(legacyJsonRpcToLegacyGrpcMethod('tasks/pushNotificationConfig/list')).toBe(
      'ListTaskPushNotificationConfig'
    );
  });

  it('message/send is identical across all three coordinate systems', () => {
    expect(legacyJsonRpcToV1Method('message/send')).toBe('SendMessage');
    expect(legacyJsonRpcToLegacyGrpcMethod('message/send')).toBe('SendMessage');
  });

  it('inverse helpers recover the legacy JSON-RPC names for the divergent methods', () => {
    expect(v1MethodToLegacyJsonRpc('SubscribeToTask')).toBe('tasks/resubscribe');
    expect(v1MethodToLegacyJsonRpc('GetExtendedAgentCard')).toBe(
      'agent/getAuthenticatedExtendedCard'
    );
    expect(v1MethodToLegacyJsonRpc('ListTaskPushNotificationConfigs')).toBe(
      'tasks/pushNotificationConfig/list'
    );
    expect(legacyGrpcToLegacyJsonRpcMethod('TaskSubscription')).toBe('tasks/resubscribe');
    expect(legacyGrpcToLegacyJsonRpcMethod('GetAgentCard')).toBe(
      'agent/getAuthenticatedExtendedCard'
    );
    expect(legacyGrpcToLegacyJsonRpcMethod('ListTaskPushNotificationConfig')).toBe(
      'tasks/pushNotificationConfig/list'
    );
  });

  it('v1 <-> legacy gRPC helpers translate the divergent names', () => {
    expect(v1MethodToLegacyGrpc('SubscribeToTask')).toBe('TaskSubscription');
    expect(v1MethodToLegacyGrpc('GetExtendedAgentCard')).toBe('GetAgentCard');
    expect(v1MethodToLegacyGrpc('ListTaskPushNotificationConfigs')).toBe(
      'ListTaskPushNotificationConfig'
    );
    expect(legacyGrpcToV1Method('TaskSubscription')).toBe('SubscribeToTask');
    expect(legacyGrpcToV1Method('GetAgentCard')).toBe('GetExtendedAgentCard');
    expect(legacyGrpcToV1Method('ListTaskPushNotificationConfig')).toBe(
      'ListTaskPushNotificationConfigs'
    );
  });
});

describe('compat/v0_3/constants - method classification predicates', () => {
  describe('isLegacyJsonRpcMethod', () => {
    it('returns true for every known v0.3 JSON-RPC method', () => {
      for (const method of ALL_LEGACY_METHODS) {
        expect(isLegacyJsonRpcMethod(method)).toBe(true);
      }
    });

    it('returns false for v1.0 PascalCase methods', () => {
      expect(isLegacyJsonRpcMethod('SendMessage')).toBe(false);
      expect(isLegacyJsonRpcMethod('ListTasks')).toBe(false);
    });

    it('returns false for non-string inputs and unknown strings', () => {
      expect(isLegacyJsonRpcMethod(undefined)).toBe(false);
      expect(isLegacyJsonRpcMethod(null)).toBe(false);
      expect(isLegacyJsonRpcMethod(42)).toBe(false);
      expect(isLegacyJsonRpcMethod('nonexistent/method')).toBe(false);
    });
  });

  describe('isV1JsonRpcMethod', () => {
    it('returns true for every v1.0 method present in V1_TO_LEGACY_JSONRPC', () => {
      for (const v1Name of Object.keys(V1_TO_LEGACY_JSONRPC)) {
        expect(isV1JsonRpcMethod(v1Name)).toBe(true);
      }
    });

    it('returns true for v1.0-only methods (e.g. ListTasks)', () => {
      for (const v1Name of V1_METHODS_WITHOUT_LEGACY_EQUIVALENT) {
        expect(isV1JsonRpcMethod(v1Name)).toBe(true);
      }
    });

    it('returns false for v0.3 method names', () => {
      for (const method of ALL_LEGACY_METHODS) {
        expect(isV1JsonRpcMethod(method)).toBe(false);
      }
    });

    it('returns false for non-string inputs and unknown strings', () => {
      expect(isV1JsonRpcMethod(undefined)).toBe(false);
      expect(isV1JsonRpcMethod(null)).toBe(false);
      expect(isV1JsonRpcMethod(42)).toBe(false);
      expect(isV1JsonRpcMethod('')).toBe(false);
      expect(isV1JsonRpcMethod('FakeMethodName')).toBe(false);
    });
  });
});
