import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  Artifact,
  Message,
  Role,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from '../../src/types/pb/a2a.js';
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

    // Executor explicitly publishes a history list; this is
    // authoritative, so we should NOT keep the persisted history.
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

  it('re-loads from the store when the cached task id differs from the incoming Task event', async () => {
    // Silence the expected mid-stream-switch warn from `lastSeenTaskId`
    // tracking; the dedicated "warns" test below verifies it fires.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Prime the store with two distinct tasks.
    const taskA = createTask('task-A', 'ctx-A', {
      history: [createMessage('a-user-1', 'A first')],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    const taskB = createTask('task-B', 'ctx-B', {
      history: [createMessage('b-user-1', 'B first')],
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: undefined,
        timestamp: undefined,
      },
    });
    await store.save(taskA, context);
    await store.save(taskB, context);

    const rm = new ResultManager(store, context);
    rm.setContext(createMessage('a-user-2', 'A second'));

    // First publish a Task event for task-A so the ResultManager has a
    // cached `currentTask` from a prior event.
    await rm.processEvent(
      AgentEvent.task(
        createTask('task-A', 'ctx-A', {
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
        })
      )
    );
    expect(rm.getCurrentTask()?.id).toBe('task-A');

    // Now publish a Task event for task-B with empty history. Under the
    // always-reload-inside-lock semantics, this must load task-B fresh
    // from the store (not merge against the stale task-A cache) so
    // task-B's history is preserved.
    rm.setContext(createMessage('b-user-2', 'B second'));
    await rm.processEvent(
      AgentEvent.task(
        createTask('task-B', 'ctx-B', {
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
        })
      )
    );

    const finalB = await store.load('task-B', context);
    const finalBIds = (finalB!.history ?? []).map((m) => m.messageId);
    expect(finalBIds).toContain('b-user-1'); // history preserved across reload
    expect(finalBIds).toContain('b-user-2');
    // task-A's persisted state should not have been touched by the task-B
    // event. The latest user message is prepended by ResultManager when
    // missing from history.
    const finalA = await store.load('task-A', context);
    const finalAIds = (finalA!.history ?? []).map((m) => m.messageId);
    expect(finalAIds).toContain('a-user-1');
    expect(finalAIds).toContain('a-user-2');
    expect(finalAIds).toHaveLength(2);

    warnSpy.mockRestore();
  });

  it('isolates persisted state from later mutation of the incoming Task event payload', async () => {
    const rm = new ResultManager(store, context);
    const userMsg = createMessage('user-1', 'hi');
    rm.setContext(userMsg);

    const sharedArtifact = createArtifact('art-1', 'original content');
    const taskEvent = createTask('task-mutate', 'ctx-mutate', {
      artifacts: [sharedArtifact],
      metadata: { agentVersion: 'v1' },
    });
    await rm.processEvent(AgentEvent.task(taskEvent));

    // Mutate the originals after publication; the persisted task must not
    // observe these changes.
    sharedArtifact.name = 'mutated-name';
    sharedArtifact.parts[0].content = { $case: 'text', value: 'mutated content' };
    (taskEvent.metadata as Record<string, string>).agentVersion = 'v999';
    taskEvent.history = [createMessage('injected', 'should not appear')];

    const saved = await store.load('task-mutate', context);
    expect(saved!.artifacts![0].name).toBe('art-1');
    expect((saved!.artifacts![0].parts[0].content as { $case: 'text'; value: string }).value).toBe(
      'original content'
    );
    expect((saved!.metadata as Record<string, string>).agentVersion).toBe('v1');
    // The injected history entry must not have leaked into our stored task.
    expect((saved!.history ?? []).map((m) => m.messageId)).not.toContain('injected');
  });

  it('isolates persisted state from later mutation of incoming status / artifact event payloads', async () => {
    const taskId = 'task-mutate-updates';
    const contextId = 'ctx-mutate-updates';

    // Seed with a base task.
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('user-1', 'go')],
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: undefined,
        },
      }),
      context
    );

    const rm = new ResultManager(store, context);

    // Status update with a message — mutate the original after delivery.
    const statusMessage = createMessage('agent-1', 'thinking', Role.ROLE_AGENT);
    const statusEvent: TaskStatusUpdateEvent = {
      taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        timestamp: undefined,
        message: statusMessage,
      },
      metadata: {},
    };
    await rm.processEvent(AgentEvent.statusUpdate(statusEvent));
    statusMessage.parts[0].content = { $case: 'text', value: 'mutated' };
    statusEvent.status.state = TaskState.TASK_STATE_FAILED;

    let snapshot = await store.load(taskId, context);
    expect(snapshot!.status?.state).toBe(TaskState.TASK_STATE_WORKING);
    const persistedAgentMsg = snapshot!.history!.find((m) => m.messageId === 'agent-1')!;
    expect((persistedAgentMsg.parts[0].content as { $case: 'text'; value: string }).value).toBe(
      'thinking'
    );

    // Artifact update — mutate after delivery and verify persisted artifact
    // is unchanged.
    const artifact = createArtifact('art-x', 'original');
    await rm.processEvent(
      AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact,
        append: false,
        lastChunk: true,
        metadata: {},
      })
    );
    artifact.parts[0].content = { $case: 'text', value: 'mutated artifact' };
    artifact.name = 'mutated';

    snapshot = await store.load(taskId, context);
    expect(snapshot!.artifacts![0].name).toBe('art-x');
    expect(
      (snapshot!.artifacts![0].parts[0].content as { $case: 'text'; value: string }).value
    ).toBe('original');
  });
});

describe('concurrent ResultManagers on the same taskId', () => {
  let store: InMemoryTaskStore;
  let context: ServerCallContext;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    context = new ServerCallContext();
  });

  it('serializes concurrent Task event writes from two RMs without losing user messages', async () => {
    // Pre-seed an INPUT_REQUIRED task — the common AUTH_REQUIRED-style
    // setup where two RMs (background drain + follow-up sendMessage) end
    // up racing on the same row.
    const taskId = 'task-concurrent-1';
    const contextId = 'ctx-concurrent-1';
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('seed-1', 'seed')],
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: undefined,
          timestamp: undefined,
        },
      }),
      context
    );

    const rmA = new ResultManager(store, context);
    rmA.setContext(createMessage('user-A', 'from A'));
    const rmB = new ResultManager(store, context);
    rmB.setContext(createMessage('user-B', 'from B'));

    const taskEvent = createTask(taskId, contextId, {
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: undefined,
      },
      history: [],
    });

    // Fire both concurrently. Without the lock, one RM's load happens
    // before the other's save, and the second merge clobbers the first
    // sibling's user message.
    await Promise.all([
      rmA.processEvent(AgentEvent.task(structuredClone(taskEvent))),
      rmB.processEvent(AgentEvent.task(structuredClone(taskEvent))),
    ]);

    const final = await store.load(taskId, context);
    const ids = (final!.history ?? []).map((m) => m.messageId);
    expect(ids).toContain('seed-1');
    expect(ids).toContain('user-A');
    expect(ids).toContain('user-B');
  });

  it('serializes interleaved status + artifact updates from two RMs', async () => {
    const taskId = 'task-concurrent-2';
    const contextId = 'ctx-concurrent-2';
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('user-1', 'go')],
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: undefined,
        },
      }),
      context
    );

    const rmA = new ResultManager(store, context);
    const rmB = new ResultManager(store, context);

    await Promise.all([
      rmA.processEvent(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: createArtifact('art-A', 'from A'),
          append: false,
          lastChunk: true,
          metadata: {},
        })
      ),
      rmB.processEvent(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: undefined,
            message: createMessage('agent-B', 'from B', Role.ROLE_AGENT),
          },
          metadata: {},
        })
      ),
    ]);

    const final = await store.load(taskId, context);
    // Both writes survived: the artifact from RM-A and the agent message
    // from RM-B's status update. Without the lock, one of the two would
    // have been overwritten by the other's save.
    expect(final!.artifacts?.map((a) => a.artifactId)).toContain('art-A');
    expect(final!.history?.map((m) => m.messageId)).toContain('agent-B');
  });

  it('end-to-end: background drain + follow-up sendMessage preserve combined state', async () => {
    // Models the AUTH_REQUIRED scenario: the original blocking call's RM is still draining events
    // in the background while the credential-injecting follow-up
    // sendMessage spins up its own RM. Both run against the same bus and
    // the same TaskStore row.
    const taskId = 'task-concurrent-3';
    const contextId = 'ctx-concurrent-3';

    // Turn 1: initial sendMessage reaches AUTH_REQUIRED.
    const rmTurn1 = new ResultManager(store, context);
    rmTurn1.setContext(createMessage('user-1', 'turn 1'));
    await rmTurn1.processEvent(
      AgentEvent.task(
        createTask(taskId, contextId, {
          status: {
            state: TaskState.TASK_STATE_AUTH_REQUIRED,
            message: undefined,
            timestamp: undefined,
          },
        })
      )
    );

    // Background drain (rmTurn1 is still alive) interleaves with a new
    // rmTurn2 from the credential-injecting follow-up sendMessage.
    const rmTurn2 = new ResultManager(store, context);
    rmTurn2.setContext(createMessage('user-2', 'with credential'));

    await Promise.all([
      // Background drain sees a working statusUpdate.
      rmTurn1.processEvent(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: undefined,
            message: createMessage('agent-1', 'resumed', Role.ROLE_AGENT),
          },
          metadata: {},
        })
      ),
      // Follow-up sendMessage's RM publishes its own task event.
      rmTurn2.processEvent(
        AgentEvent.task(
          createTask(taskId, contextId, {
            status: {
              state: TaskState.TASK_STATE_WORKING,
              message: undefined,
              timestamp: undefined,
            },
          })
        )
      ),
      // Background drain then sees an artifact.
      rmTurn1.processEvent(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: createArtifact('art-result', 'final answer'),
          append: false,
          lastChunk: true,
          metadata: {},
        })
      ),
    ]);

    const final = await store.load(taskId, context);
    const ids = (final!.history ?? []).map((m) => m.messageId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
    expect(ids).toContain('agent-1');
    expect(final!.artifacts?.map((a) => a.artifactId)).toContain('art-result');
  });

  it('warns when an executor publishes events for a different taskId on the same RM', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const rm = new ResultManager(store, context);
    rm.setContext(createMessage('user-1', 'hi'));
    await rm.processEvent(AgentEvent.task(createTask('task-X', 'ctx-X')));
    await rm.processEvent(AgentEvent.task(createTask('task-Y', 'ctx-Y')));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/switched tasks mid-stream/));
    warnSpy.mockRestore();
  });

  it('does not deadlock if a sibling RM throws inside the lock', async () => {
    const taskId = 'task-concurrent-throw';
    const contextId = 'ctx-concurrent-throw';
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('user-1', 'go')],
      }),
      context
    );

    // Stub a TaskStore that throws once on save, then succeeds, so the
    // first RM's processEvent rejects under the lock.
    let saveAttempt = 0;
    const flakyStore: InMemoryTaskStore = Object.create(store) as InMemoryTaskStore;
    flakyStore.save = async (task, ctx) => {
      saveAttempt++;
      if (saveAttempt === 1) {
        throw new Error('boom');
      }
      return store.save(task, ctx);
    };
    flakyStore.load = (id, ctx) => store.load(id, ctx);

    const rmA = new ResultManager(flakyStore, context);
    rmA.setContext(createMessage('user-A', 'from A'));
    const rmB = new ResultManager(flakyStore, context);
    rmB.setContext(createMessage('user-B', 'from B'));

    const taskEvent = createTask(taskId, contextId, {
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: undefined,
      },
    });

    const results = await Promise.allSettled([
      rmA.processEvent(AgentEvent.task(structuredClone(taskEvent))),
      rmB.processEvent(AgentEvent.task(structuredClone(taskEvent))),
    ]);

    // One should have rejected (the flaky save), the other should have
    // succeeded — the lock chain must not deadlock or swallow the
    // success.
    const rejected = results.filter((r) => r.status === 'rejected');
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(rejected).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);
  });

  it('does not serialize writes across tenants that happen to share a taskId', async () => {
    // Two tenants with the same `taskId` MUST NOT block each other. The
    // lock key is keyed by (tenant, owner, taskId) so different tenants
    // get independent chains. Verify this by holding tenant-A's lock
    // open and asserting tenant-B's write still completes promptly.
    const taskId = 'shared-task-id';
    const contextId = 'ctx';
    const ctxA = new ServerCallContext({ tenant: 'tenant-A' });
    const ctxB = new ServerCallContext({ tenant: 'tenant-B' });

    // Use a single store but with tenant-scoped isolation.
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('A-seed', 'A seed')],
      }),
      ctxA
    );
    await store.save(
      createTask(taskId, contextId, {
        history: [createMessage('B-seed', 'B seed')],
      }),
      ctxB
    );

    // Build a slow store wrapper for tenant-A that holds save() open
    // until we release a gate. Tenant-B uses the unblocked store
    // directly.
    let releaseAGate!: () => void;
    const aGate = new Promise<void>((r) => (releaseAGate = r));
    const slowStoreA: InMemoryTaskStore = Object.create(store) as InMemoryTaskStore;
    slowStoreA.save = async (task, ctx) => {
      await aGate;
      return store.save(task, ctx);
    };
    slowStoreA.load = (id, ctx) => store.load(id, ctx);

    const rmA = new ResultManager(slowStoreA, ctxA);
    rmA.setContext(createMessage('A-user', 'A user'));
    const rmB = new ResultManager(store, ctxB);
    rmB.setContext(createMessage('B-user', 'B user'));

    // Fire tenant-A first; it will block at the gated save.
    const aPromise = rmA.processEvent(AgentEvent.task(createTask(taskId, contextId)));
    // Tenant-B's write must NOT wait on tenant-A's lock. Use a small
    // timeout via Promise.race to assert B completes without A.
    const bPromise = rmB.processEvent(AgentEvent.task(createTask(taskId, contextId)));
    const bResult = await Promise.race([
      bPromise.then(() => 'B-done' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 50)),
    ]);
    expect(bResult).toBe('B-done');

    // Release tenant-A and let it finish.
    releaseAGate();
    await aPromise;

    // Both tenants ended up with their own histories preserved.
    const finalA = await store.load(taskId, ctxA);
    const finalB = await store.load(taskId, ctxB);
    expect((finalA!.history ?? []).map((m) => m.messageId)).toContain('A-seed');
    expect((finalA!.history ?? []).map((m) => m.messageId)).toContain('A-user');
    expect((finalB!.history ?? []).map((m) => m.messageId)).toContain('B-seed');
    expect((finalB!.history ?? []).map((m) => m.messageId)).toContain('B-user');
    // Cross-contamination check: A's user message must not appear in B
    // and vice versa.
    expect((finalA!.history ?? []).map((m) => m.messageId)).not.toContain('B-user');
    expect((finalB!.history ?? []).map((m) => m.messageId)).not.toContain('A-user');
  });
});
