import { describe, it, expect, beforeEach } from 'vitest';

import { Artifact, Message, Role, Task, TaskState } from '../../src/types/pb/a2a.js';
import { ServerCallContext } from '../../src/server/context.js';
import { ResultManager } from '../../src/server/result_manager.js';
import { InMemoryTaskStore } from '../../src/server/store.js';
import { AgentEvent } from '../../src/server/events/execution_event_bus.js';

function createMessage(messageId: string, text: string, role: Role = Role.ROLE_USER): Message {
  return {
    messageId,
    role,
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    taskId: '',
    contextId: '',
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

function createArtifact(artifactId: string, text: string): Artifact {
  return {
    artifactId,
    name: artifactId,
    description: '',
    parts: [
      {
        content: { $case: 'text', value: text },
        mediaType: 'text/plain',
        filename: '',
        metadata: undefined,
      },
    ],
    metadata: {},
    extensions: [],
  };
}

function createTask(id: string, contextId: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    contextId,
    status: {
      state: TaskState.TASK_STATE_SUBMITTED,
      message: undefined,
      timestamp: undefined,
    },
    artifacts: [],
    history: [],
    metadata: {},
    ...overrides,
  };
}

describe('ResultManager.processEvent("task")', () => {
  let store: InMemoryTaskStore;
  let context: ServerCallContext;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    context = new ServerCallContext();
  });

  it('persists the task as-is when no prior state exists', async () => {
    const rm = new ResultManager(store, context);
    const userMsg = createMessage('user-1', 'hello');
    rm.setContext(userMsg);

    const task = createTask('task-1', 'ctx-1');
    await rm.processEvent(AgentEvent.task(task));

    const saved = await store.load('task-1', context);
    expect(saved).toBeDefined();
    expect(saved!.id).toBe('task-1');
    // The latest user message is still injected when missing.
    expect(saved!.history).toHaveLength(1);
    expect(saved!.history![0].messageId).toBe('user-1');
  });

  it('preserves persisted history when the incoming Task event has empty history', async () => {
    // Turn 1: prime the store with a task that already has a multi-message
    // history (the user message and the agent's INPUT_REQUIRED response).
    const turn1Task = createTask('task-multi', 'ctx-multi', {
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
      history: [
        createMessage('user-1', 'first user message'),
        createMessage('agent-1', 'please clarify', Role.ROLE_AGENT),
      ],
    });
    await store.save(turn1Task, context);

    // Turn 2: the executor publishes a fresh Task event with empty history
    // (e.g. a follow-up after INPUT_REQUIRED). Before the merge fix this
    // wholesale-replaced the persisted task and dropped the conversation.
    const rm = new ResultManager(store, context);
    const followUpUserMsg = createMessage('user-2', 'follow up answer');
    rm.setContext(followUpUserMsg);

    const turn2Task = createTask('task-multi', 'ctx-multi', {
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: undefined,
      },
      history: [], // executor doesn't re-send history on follow-up turns.
      artifacts: [],
    });
    await rm.processEvent(AgentEvent.task(turn2Task));

    const saved = await store.load('task-multi', context);
    expect(saved).toBeDefined();
    expect(saved!.status?.state).toBe(TaskState.TASK_STATE_WORKING);

    // History is preserved AND the latest user message is appended/prepended.
    const ids = (saved!.history ?? []).map((m) => m.messageId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('agent-1');
    expect(ids).toContain('user-2');
    expect(saved!.history!.length).toBe(3);
  });

  it('appends new artifacts to persisted artifacts instead of replacing them', async () => {
    const persistedArtifact = createArtifact('artifact-keep', 'keep me');
    const turn1Task = createTask('task-artifacts', 'ctx-art', {
      history: [createMessage('user-1', 'do work')],
      artifacts: [persistedArtifact],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    await store.save(turn1Task, context);

    const rm = new ResultManager(store, context);
    const turn2UserMsg = createMessage('user-2', 'continue');
    rm.setContext(turn2UserMsg);

    const newArtifact = createArtifact('artifact-new', 'newly added');
    const turn2Task = createTask('task-artifacts', 'ctx-art', {
      history: [],
      artifacts: [newArtifact],
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: undefined,
      },
    });
    await rm.processEvent(AgentEvent.task(turn2Task));

    const saved = await store.load('task-artifacts', context);
    expect(saved).toBeDefined();
    const artifactIds = (saved!.artifacts ?? []).map((a) => a.artifactId);
    // Persisted artifact survives and the new one is added.
    expect(artifactIds).toEqual(['artifact-keep', 'artifact-new']);
  });

  it('overlays incoming artifact onto persisted one when artifactIds collide', async () => {
    const persistedArtifact = createArtifact('artifact-shared', 'old content');
    const turn1Task = createTask('task-overlap', 'ctx-overlap', {
      artifacts: [persistedArtifact],
      history: [createMessage('user-1', 'go')],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    await store.save(turn1Task, context);

    const rm = new ResultManager(store, context);
    rm.setContext(createMessage('user-2', 'more'));

    const updatedArtifact = createArtifact('artifact-shared', 'new content');
    const turn2Task = createTask('task-overlap', 'ctx-overlap', {
      artifacts: [updatedArtifact],
    });
    await rm.processEvent(AgentEvent.task(turn2Task));

    const saved = await store.load('task-overlap', context);
    expect(saved!.artifacts).toHaveLength(1);
    const parts = saved!.artifacts![0].parts;
    expect((parts[0].content as { $case: 'text'; value: string }).value).toBe('new content');
  });

  it('lets the executor override persisted history when it provides a non-empty history', async () => {
    const turn1Task = createTask('task-replace-hist', 'ctx-rh', {
      history: [createMessage('stale-1', 'old')],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    await store.save(turn1Task, context);

    const rm = new ResultManager(store, context);
    rm.setContext(createMessage('user-2', 'next'));

    // Executor explicitly publishes a history list; this is authoritative
    // per §3.7, so we should NOT keep the persisted history.
    const turn2Task = createTask('task-replace-hist', 'ctx-rh', {
      history: [createMessage('fresh-1', 'agent rewrote history', Role.ROLE_AGENT)],
    });
    await rm.processEvent(AgentEvent.task(turn2Task));

    const saved = await store.load('task-replace-hist', context);
    const ids = (saved!.history ?? []).map((m) => m.messageId);
    expect(ids).toContain('fresh-1');
    expect(ids).not.toContain('stale-1');
    // Latest user message is still added if missing.
    expect(ids).toContain('user-2');
  });

  it('merges metadata, with incoming Task event values winning on key collisions', async () => {
    const turn1Task = createTask('task-meta', 'ctx-meta', {
      metadata: { keep: 'persisted', shared: 'old' },
      history: [createMessage('user-1', 'hi')],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    await store.save(turn1Task, context);

    const rm = new ResultManager(store, context);
    rm.setContext(createMessage('user-2', 'again'));

    const turn2Task = createTask('task-meta', 'ctx-meta', {
      metadata: { shared: 'new', extra: 'added' },
    });
    await rm.processEvent(AgentEvent.task(turn2Task));

    const saved = await store.load('task-meta', context);
    expect(saved!.metadata).toEqual({
      keep: 'persisted',
      shared: 'new',
      extra: 'added',
    });
  });

  it('multi-turn scenario: turn-1 sets history, turn-2 preserves history and adds artifacts', async () => {
    const contextId = 'ctx-multi-turn';
    const taskId = 'task-multi-turn';

    // ---- Turn 1: user asks, agent enters INPUT_REQUIRED ----
    const turn1Rm = new ResultManager(store, context);
    const turn1UserMsg = createMessage('user-1', 'tell me a movie');
    turn1Rm.setContext(turn1UserMsg);

    await turn1Rm.processEvent(
      AgentEvent.task(
        createTask(taskId, contextId, {
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: undefined,
          },
        })
      )
    );

    await turn1Rm.processEvent(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          timestamp: undefined,
          message: {
            ...createMessage('agent-1', 'which genre?', Role.ROLE_AGENT),
            taskId,
            contextId,
          },
        },
        metadata: {},
      })
    );

    const afterTurn1 = await store.load(taskId, context);
    expect(afterTurn1!.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect((afterTurn1!.history ?? []).map((m) => m.messageId)).toEqual(['user-1', 'agent-1']);

    // ---- Turn 2: fresh ResultManager (simulating a follow-up request); the
    // executor re-publishes a Task event with empty history. ----
    const turn2Rm = new ResultManager(store, context);
    const turn2UserMsg = createMessage('user-2', 'sci-fi');
    turn2Rm.setContext(turn2UserMsg);

    await turn2Rm.processEvent(
      AgentEvent.task(
        createTask(taskId, contextId, {
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
          history: [], // executor does not re-send history.
          artifacts: [],
        })
      )
    );

    // The agent then produces an artifact and completes the task.
    await turn2Rm.processEvent(
      AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: createArtifact('movie-rec', 'Blade Runner'),
        append: false,
        lastChunk: true,
        metadata: {},
      })
    );

    await turn2Rm.processEvent(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: undefined,
        },
        metadata: {},
      })
    );

    const finalTask = await store.load(taskId, context);
    expect(finalTask).toBeDefined();
    expect(finalTask!.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    // Conversation history from turn 1 is preserved AND the turn-2 user
    // message is included.
    const finalIds = (finalTask!.history ?? []).map((m) => m.messageId);
    expect(finalIds).toContain('user-1');
    expect(finalIds).toContain('agent-1');
    expect(finalIds).toContain('user-2');

    // The new artifact landed without clobbering anything.
    expect(finalTask!.artifacts).toHaveLength(1);
    expect(finalTask!.artifacts![0].artifactId).toBe('movie-rec');
  });
});
