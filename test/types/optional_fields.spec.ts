import { describe, it, expect } from 'vitest';
import {
  Task,
  Part,
  Message,
  Artifact,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  AgentCard,
  SendMessageConfiguration,
  TaskState,
  Role,
} from '../../src/types/pb/a2a.js';

describe('Issue #660: Spec-compliant optional fields', () => {
  it('allows Part creation with only content (omits filename, mediaType, metadata)', () => {
    const textPart: Part = {
      content: { $case: 'text', value: 'hello' },
    };
    expect(textPart.content?.$case).toBe('text');
    expect(textPart.filename).toBeUndefined();

    const json = Part.toJSON(textPart);
    expect(json).toEqual({ text: 'hello' });
    expect(Part.fromJSON(json).content).toEqual({ $case: 'text', value: 'hello' });
  });

  it('allows Message creation with only messageId, role, parts (omits contextId, taskId, metadata, extensions, referenceTaskIds)', () => {
    const msg: Message = {
      messageId: 'msg-001',
      role: Role.ROLE_USER,
      parts: [{ content: { $case: 'text', value: 'hello' } }],
    };
    expect(msg.contextId).toBeUndefined();
    expect(msg.taskId).toBeUndefined();

    const json = Message.toJSON(msg) as Record<string, unknown>;
    expect(json.messageId).toBe('msg-001');
    expect(json.role).toBe('ROLE_USER');
    expect(json.parts).toEqual([{ text: 'hello' }]);
    expect(json.contextId).toBeUndefined();
    expect(json.taskId).toBeUndefined();
  });

  it('allows Artifact creation with artifactId, name, parts (omits description, metadata, extensions)', () => {
    const artifact: Artifact = {
      artifactId: 'art-001',
      name: 'report.txt',
      parts: [{ content: { $case: 'text', value: 'file content' } }],
    };
    expect(artifact.description).toBeUndefined();

    const json = Artifact.toJSON(artifact) as Record<string, unknown>;
    expect(json.artifactId).toBe('art-001');
    expect(json.name).toBe('report.txt');
    expect(json.description).toBeUndefined();
  });

  it('allows Task creation with only id (omits contextId, status, artifacts, history, metadata)', () => {
    const task: Task = {
      id: 'task-001',
    };
    expect(task.contextId).toBeUndefined();
    expect(task.status).toBeUndefined();
    expect(task.artifacts).toBeUndefined();
    expect(task.history).toBeUndefined();

    const json = Task.toJSON(task) as Record<string, unknown>;
    expect(json.id).toBe('task-001');
    expect(json.contextId).toBeUndefined();
    expect(json.status).toBeUndefined();
    expect(json.artifacts).toBeUndefined();
  });

  it('allows TaskStatusUpdateEvent with only taskId and contextId', () => {
    const event: TaskStatusUpdateEvent = {
      taskId: 'task-001',
      contextId: 'ctx-001',
      status: { state: TaskState.TASK_STATE_WORKING },
    };
    const json = TaskStatusUpdateEvent.toJSON(event) as Record<string, unknown>;
    expect(json.taskId).toBe('task-001');
    expect(json.contextId).toBe('ctx-001');
    expect((json.status as Record<string, unknown>).state).toBe('TASK_STATE_WORKING');
  });

  it('allows TaskArtifactUpdateEvent with minimal properties', () => {
    const event: TaskArtifactUpdateEvent = {
      taskId: 'task-001',
      artifact: {
        artifactId: 'art-001',
        name: 'test.txt',
        parts: [{ content: { $case: 'text', value: 'chunk 1' } }],
      },
    };
    const json = TaskArtifactUpdateEvent.toJSON(event) as Record<string, unknown>;
    expect(json.taskId).toBe('task-001');
    expect(json.contextId).toBeUndefined();
    expect(json.append).toBeUndefined();
    expect(json.lastChunk).toBeUndefined();
  });

  it('allows AgentCard with minimal spec properties', () => {
    const card: AgentCard = {
      name: 'Weather Agent',
      description: 'Provides weather forecasts',
      version: '1.0.0',
      supportedInterfaces: [
        {
          url: 'https://example.com/a2a',
          protocolBinding: 'HTTP+JSON',
        },
      ],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        {
          id: 'get_weather',
          name: 'Get Weather',
          description: 'Fetches weather for a location',
          tags: ['weather'],
        },
      ],
    };

    const json = AgentCard.toJSON(card) as Record<string, unknown>;
    expect(json.name).toBe('Weather Agent');
    expect(json.provider).toBeUndefined();
    expect(json.documentationUrl).toBeUndefined();
    expect(json.iconUrl).toBeUndefined();
    expect(json.capabilities).toBeUndefined();
  });

  it('allows SendMessageConfiguration with minimal properties', () => {
    const config: SendMessageConfiguration = {
      acceptedOutputModes: ['text/plain'],
    };
    const json = SendMessageConfiguration.toJSON(config) as Record<string, unknown>;
    expect(json.acceptedOutputModes).toEqual(['text/plain']);
    expect(json.taskPushNotificationConfig).toBeUndefined();
    expect(json.returnImmediately).toBeUndefined();
  });
});
