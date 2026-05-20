import { describe, expect, it } from 'vitest';
import { toCompatMessage, toCoreMessage } from '../../../../src/compat/v0_3/translate/messages.js';
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
        contextId: '',
        taskId: '',
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

    it('coerces missing IDs to empty strings (proto3 default)', () => {
      const compat: legacy.Message = {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [],
      };
      const core = toCoreMessage(compat);
      expect(core.contextId).toBe('');
      expect(core.taskId).toBe('');
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
});
