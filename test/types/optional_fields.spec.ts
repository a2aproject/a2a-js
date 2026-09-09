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
  AuthenticationInfo,
  AgentInterface,
  OAuth2SecurityScheme,
  SendMessageRequest,
  TaskState,
  Role,
} from '../../src/types/pb/a2a.js';

describe('Issue #660 & PR #666: Spec-compliant optional and required fields', () => {
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

  it('allows Message creation with required messageId, role, parts (omits contextId, taskId, metadata, extensions, referenceTaskIds)', () => {
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

  it('allows Artifact creation with required artifactId, parts (omits name, description, metadata, extensions)', () => {
    const artifact: Artifact = {
      artifactId: 'art-001',
      parts: [{ content: { $case: 'text', value: 'file content' } }],
    };
    expect(artifact.name).toBeUndefined();
    expect(artifact.description).toBeUndefined();

    const json = Artifact.toJSON(artifact) as Record<string, unknown>;
    expect(json.artifactId).toBe('art-001');
    expect(json.name).toBeUndefined();
    expect(json.description).toBeUndefined();
  });

  it('allows Task creation with required id, status (omits contextId, artifacts, history, metadata)', () => {
    const task: Task = {
      id: 'task-001',
      status: { state: TaskState.TASK_STATE_SUBMITTED },
    };
    expect(task.contextId).toBeUndefined();
    expect(task.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);
    expect(task.artifacts).toBeUndefined();
    expect(task.history).toBeUndefined();

    const json = Task.toJSON(task) as Record<string, unknown>;
    expect(json.id).toBe('task-001');
    expect(json.contextId).toBeUndefined();
    expect((json.status as Record<string, unknown>).state).toBe('TASK_STATE_SUBMITTED');
    expect(json.artifacts).toBeUndefined();
  });

  it('requires taskId, contextId, and status on TaskStatusUpdateEvent (omits metadata)', () => {
    const event: TaskStatusUpdateEvent = {
      taskId: 'task-001',
      contextId: 'ctx-001',
      status: { state: TaskState.TASK_STATE_WORKING },
    };
    const json = TaskStatusUpdateEvent.toJSON(event) as Record<string, unknown>;
    expect(json.taskId).toBe('task-001');
    expect(json.contextId).toBe('ctx-001');
    expect((json.status as Record<string, unknown>).state).toBe('TASK_STATE_WORKING');
    expect(json.metadata).toBeUndefined();
  });

  it('requires taskId, contextId, and artifact on TaskArtifactUpdateEvent (omits append, lastChunk, metadata)', () => {
    const event: TaskArtifactUpdateEvent = {
      taskId: 'task-001',
      contextId: 'ctx-001',
      artifact: {
        artifactId: 'art-001',
        parts: [{ content: { $case: 'text', value: 'chunk 1' } }],
      },
    };
    const json = TaskArtifactUpdateEvent.toJSON(event) as Record<string, unknown>;
    expect(json.taskId).toBe('task-001');
    expect(json.contextId).toBe('ctx-001');
    expect(json.artifact).toBeDefined();
    expect(json.append).toBeUndefined();
    expect(json.lastChunk).toBeUndefined();
    expect(json.metadata).toBeUndefined();
  });

  it('enforces required fields on AgentCard and AgentSkill (omits optional provider, docUrl, icon, signatures, security)', () => {
    const card: AgentCard = {
      name: 'Weather Agent',
      description: 'Provides weather forecasts',
      version: '1.0.0',
      supportedInterfaces: [
        {
          url: 'https://example.com/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ],
      capabilities: {},
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
    expect(json.description).toBe('Provides weather forecasts');
    expect(json.provider).toBeUndefined();
    expect(json.documentationUrl).toBeUndefined();
    expect(json.iconUrl).toBeUndefined();
    expect(json.securitySchemes).toBeUndefined();
    expect(json.securityRequirements).toBeUndefined();
    expect(json.signatures).toBeUndefined();
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

  it('enforces required scheme on AuthenticationInfo and allows omitting credentials', () => {
    const auth: AuthenticationInfo = {
      scheme: 'Bearer',
    };
    expect(auth.scheme).toBe('Bearer');
    expect(auth.credentials).toBeUndefined();

    const json = AuthenticationInfo.toJSON(auth) as Record<string, unknown>;
    expect(json.scheme).toBe('Bearer');
    expect(json.credentials).toBeUndefined();
  });

  it('enforces required protocolVersion on AgentInterface and allows omitting tenant', () => {
    const iface: AgentInterface = {
      url: 'https://example.com/a2a',
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
    };
    expect(iface.tenant).toBeUndefined();

    const json = AgentInterface.toJSON(iface) as Record<string, unknown>;
    expect(json.url).toBe('https://example.com/a2a');
    expect(json.protocolBinding).toBe('HTTP+JSON');
    expect(json.protocolVersion).toBe('1.0');
    expect(json.tenant).toBeUndefined();
  });

  it('enforces required flows on OAuth2SecurityScheme and allows omitting description and metadata URL', () => {
    const scheme: OAuth2SecurityScheme = {
      flows: {
        flow: {
          $case: 'authorizationCode',
          value: {
            authorizationUrl: 'https://auth.example.com',
            tokenUrl: 'https://token.example.com',
            scopes: { read: 'Read access' },
          },
        },
      },
    };
    expect(scheme.description).toBeUndefined();
    expect(scheme.oauth2MetadataUrl).toBeUndefined();
  });

  it('enforces required message on SendMessageRequest and allows omitting tenant, config, metadata', () => {
    const req: SendMessageRequest = {
      message: {
        messageId: 'msg-001',
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: 'hello' } }],
      },
    };
    expect(req.tenant).toBeUndefined();
    expect(req.configuration).toBeUndefined();
    expect(req.metadata).toBeUndefined();

    const json = SendMessageRequest.toJSON(req) as Record<string, unknown>;
    expect(json.tenant).toBeUndefined();
    expect(json.configuration).toBeUndefined();
    expect(json.metadata).toBeUndefined();
    expect(json.message).toBeDefined();
  });
});
