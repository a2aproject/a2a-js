import { describe, expect, it } from 'vitest';
import { toCompatMessage, toCoreMessage } from '../../../../src/compat/v0_3/translate/messages.js';
import { A2AError } from '../../../../src/compat/v0_3/server/error.js';
import { JSON_RPC_ERROR_CODE } from '../../../../src/errors/json_rpc.js';
import { Role } from '../../../../src/types/pb/a2a.js';
import type { Message as V1Message } from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('messages', () => {
  describe('toCoreMessage', () => {
    it('converts a minimal user message', () => {
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'hi' }],
      };
      const core = toCoreMessage(compat);
      expect(core).toEqual({
        messageId: 'msg-1',
        contextId: undefined,
        taskId: undefined,
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'text', value: 'hi' },
            metadata: undefined,
            filename: '',
            mediaType: '',
          },
        ],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      });
    });

    it('leaves missing optional IDs as undefined', () => {
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [],
      };
      const core = toCoreMessage(compat);
      expect(core.contextId).toBeUndefined();
      expect(core.taskId).toBeUndefined();
    });

    it('preserves contextId, taskId, metadata, extensions, referenceTaskIds', () => {
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'msg-1',
        role: 'agent',
        parts: [],
        contextId: 'ctx-1',
        taskId: 'task-1',
        metadata: { source: 'tester' },
        extensions: ['https://ext.example/a'],
        referenceTaskIds: ['other-task'],
      };
      const core = toCoreMessage(compat);
      expect(core.role).toBe(Role.ROLE_AGENT);
      expect(core.contextId).toBe('ctx-1');
      expect(core.taskId).toBe('task-1');
      expect(core.metadata).toEqual({ source: 'tester' });
      expect(core.extensions).toEqual(['https://ext.example/a']);
      expect(core.referenceTaskIds).toEqual(['other-task']);
    });
  });

  describe('toCompatMessage', () => {
    it('adds the kind discriminator and prunes empty proto3 defaults', () => {
      const core: V1Message = {
        messageId: 'msg-1',
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      };
      expect(toCompatMessage(core)).toEqual({
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [],
      });
    });

    it('preserves non-empty optional fields', () => {
      const core: V1Message = {
        messageId: 'msg-1',
        contextId: 'ctx-1',
        taskId: 'task-1',
        role: Role.ROLE_AGENT,
        parts: [],
        metadata: { k: 'v' },
        extensions: ['https://ext.example/a'],
        referenceTaskIds: ['other-task'],
      };
      expect(toCompatMessage(core)).toEqual({
        kind: 'message',
        messageId: 'msg-1',
        role: 'agent',
        parts: [],
        contextId: 'ctx-1',
        taskId: 'task-1',
        metadata: { k: 'v' },
        extensions: ['https://ext.example/a'],
        referenceTaskIds: ['other-task'],
      });
    });
  });

  describe('round-tripping', () => {
    it('round-trips a fully-populated message', () => {
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'msg-1',
        role: 'agent',
        parts: [{ kind: 'text', text: 'hi' }],
        contextId: 'ctx',
        taskId: 'task',
        metadata: { m: 'v' },
        extensions: ['e1'],
        referenceTaskIds: ['t2'],
      };
      expect(toCompatMessage(toCoreMessage(compat))).toEqual(compat);
    });
  });

  describe('input validation', () => {
    it('rejects a non-object message with invalidParams', () => {
      expect(() => toCoreMessage(undefined as unknown as legacy.Message)).toThrowError(A2AError);
      expect(() => toCoreMessage(undefined as unknown as legacy.Message)).toThrow(/object/);
    });

    it('rejects a message missing messageId with invalidParams', () => {
      const bad = { kind: 'message', role: 'user', parts: [] } as unknown as legacy.Message;
      expect(() => toCoreMessage(bad)).toThrowError(A2AError);
      expect(() => toCoreMessage(bad)).toThrow(/messageId/);
    });

    it('rejects a message missing role with invalidParams', () => {
      const bad = { kind: 'message', messageId: 'm', parts: [] } as unknown as legacy.Message;
      expect(() => toCoreMessage(bad)).toThrowError(A2AError);
      expect(() => toCoreMessage(bad)).toThrow(/role/);
    });

    it('rejects a message whose role is not "user" or "agent"', () => {
      const bad = {
        kind: 'message',
        messageId: 'm',
        role: 'system',
        parts: [],
      } as unknown as legacy.Message;
      expect(() => toCoreMessage(bad)).toThrowError(A2AError);
      expect(() => toCoreMessage(bad)).toThrow(/"user" or "agent"/);
    });

    it('rejects a message whose parts field is not an array', () => {
      const bad = {
        kind: 'message',
        messageId: 'm',
        role: 'user',
        parts: 'invalid',
      } as unknown as legacy.Message;
      expect(() => toCoreMessage(bad)).toThrowError(A2AError);
      expect(() => toCoreMessage(bad)).toThrow(/parts/);
    });

    it('rejects a message whose parts field is missing', () => {
      const bad = { kind: 'message', messageId: 'm', role: 'user' } as unknown as legacy.Message;
      expect(() => toCoreMessage(bad)).toThrowError(A2AError);
      expect(() => toCoreMessage(bad)).toThrow(/parts/);
    });

    it('thrown errors carry the JSON-RPC invalid-params code', () => {
      try {
        toCoreMessage({ kind: 'message' } as unknown as legacy.Message);
        expect.fail('toCoreMessage should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(A2AError);
        expect(JSON_RPC_ERROR_CODE[(err as Error).name]).toBe(-32602);
      }
    });
  });

  describe('metadata deep-cloning', () => {
    it('toCoreMessage isolates nested metadata from the source', () => {
      const nested = { tags: ['a', 'b'] };
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'm1',
        role: 'user',
        parts: [],
        metadata: { nested },
      };
      const core = toCoreMessage(compat);
      (core.metadata!.nested as { tags: string[] }).tags.push('c');
      expect(nested.tags).toEqual(['a', 'b']);
    });

    it('toCompatMessage isolates nested metadata from the source', () => {
      const nested = { tags: ['a', 'b'] };
      const core: V1Message = {
        messageId: 'm1',
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [],
        metadata: { nested },
        extensions: [],
        referenceTaskIds: [],
      };
      const compat = toCompatMessage(core);
      (compat.metadata!.nested as { tags: string[] }).tags.push('c');
      expect(nested.tags).toEqual(['a', 'b']);
    });
  });

  describe('tolerates missing v0.3-optional fields', () => {
    function makePartialCore(overrides: Partial<V1Message> = {}): V1Message {
      return {
        messageId: 'msg-1',
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [],
        metadata: undefined,
        extensions: undefined as unknown as V1Message['extensions'],
        referenceTaskIds: undefined as unknown as V1Message['referenceTaskIds'],
        ...overrides,
      };
    }

    it('does not crash when referenceTaskIds is missing', () => {
      const core = makePartialCore({ extensions: [] });
      expect(() => toCompatMessage(core)).not.toThrow();
      expect(toCompatMessage(core).referenceTaskIds).toBeUndefined();
    });

    it('does not crash when extensions is missing', () => {
      const core = makePartialCore({ referenceTaskIds: [] });
      expect(() => toCompatMessage(core)).not.toThrow();
      expect(toCompatMessage(core).extensions).toBeUndefined();
    });

    it('does not crash when both optional array fields are missing at once', () => {
      const core = makePartialCore();
      expect(() => toCompatMessage(core)).not.toThrow();
      expect(toCompatMessage(core)).toEqual({
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [],
      });
    });

    it('tolerates null just like undefined for optional fields', () => {
      const core = makePartialCore({
        extensions: null as unknown as V1Message['extensions'],
        referenceTaskIds: null as unknown as V1Message['referenceTaskIds'],
      });
      expect(() => toCompatMessage(core)).not.toThrow();
      const compat = toCompatMessage(core);
      expect(compat.extensions).toBeUndefined();
      expect(compat.referenceTaskIds).toBeUndefined();
    });
  });

  describe('reports informative errors for missing required fields', () => {
    it('toCompatMessage throws A2AError.invalidParams when parts is missing', () => {
      const core = {
        messageId: 'msg-1',
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: undefined,
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      } as unknown as V1Message;
      expect(() => toCompatMessage(core)).toThrowError(A2AError);
      expect(() => toCompatMessage(core)).toThrow(/message\.parts is required/);
    });
  });
});
