/**
 * The ACTS SUT behaviour contract (ACTS spec §11) for the ITK agent.
 *
 * ACTS tests are declarative — they say what to send and what to expect — so
 * the agent under test has to produce a *deterministic* reply for each case.
 * §11 does that with a message-prefix convention rather than a side-channel
 * API: the text of the first user message part names the behaviour.
 *
 * `itk_agent.ts` routes here when the first user message starts with `tck-`,
 * and otherwise falls through to the existing ITK instruction path, so one
 * agent binary serves both suites.
 *
 * **`acts/sut-behaviors.yaml` is the list; this module is the
 * implementation.** They are separate on purpose — the YAML is what the SDK
 * *claims*, the code is what it *does*, and the runner checks one against the
 * other by running tests. So nothing here re-states the names: the behaviour
 * is read out of the message with a regex, and one that reaches `run` without
 * a branch fails the task loudly. A second copy of the list would only add a
 * way for the claim and the behaviour to drift silently.
 *
 * The regex is greedy to the word boundary, which gives longest-match for
 * free: `tck-artifact-file-url` beats `tck-artifact-file` with no ordered
 * table, and a typo like `tck-complet-task` is reported as unimplemented
 * rather than falling through to the traversal decoder and failing there with
 * "no valid instruction".
 *
 * **The behaviour belongs to the task, not the message.** A multi-turn test
 * opens with `tck-multi-turn start` and then sends plain `here is more input`
 * and `done`; only the first message names the contract, so a continuation
 * recovers it from the task history.
 */

import { Message, TaskState, Role, Task } from '../src/index.js';
import { Part } from '../src/types/pb/a2a.js';
import { RequestContext, ExecutionEventBus, AgentEvent } from '../src/server/index.js';
import * as clientParse from './acts_client_parse.js';

/** A behaviour name: `tck-` plus one or more hyphen-joined lowercase words. */
const NAME = /^(tck-[a-z0-9]+(?:-[a-z0-9]+)*)/;

/**
 * The word a multi-turn conversation ends on. Fixed by the corpus, which
 * sends exactly this to close `CORE-MULTI-001`, `CORE-MULTI-005` and
 * `CORE-HIST-002`.
 */
const MULTI_TURN_DONE = 'done';

/**
 * How long `tck-long-running` stays in WORKING before completing. Short
 * enough not to dominate a run, long enough that a test polling for a
 * non-terminal state sees one: the corpus polls with `delay_ms: 2000`.
 */
const LONG_RUNNING_DELAY_MS = 1000;

function textPart(value: string): Part {
  return {
    content: { $case: 'text', value },
    mediaType: 'text/plain',
    filename: '',
    metadata: {},
  };
}

function dataPart(value: unknown): Part {
  return {
    content: { $case: 'data', value },
    mediaType: 'application/json',
    filename: '',
    metadata: {},
  };
}

function filePart(): Part {
  return {
    content: { $case: 'raw', value: Buffer.from('file bytes') },
    mediaType: 'text/plain',
    filename: 'document.txt',
    metadata: {},
  };
}

function fileUrlPart(): Part {
  return {
    content: { $case: 'url', value: 'https://example.com/document.txt' },
    mediaType: 'text/plain',
    filename: 'document.txt',
    metadata: {},
  };
}

/** The first text part of a message, or `''`. */
function firstText(message: Message | undefined): string {
  if (!message) return '';
  for (const part of message.parts) {
    if (part.content?.$case === 'text') return part.content.value;
  }
  return '';
}

/**
 * The behaviour named by `text`, or `undefined`.
 *
 * Names an *asserted* behaviour, not necessarily an implemented one: an
 * unknown `tck-*` still routes here and is reported as unimplemented. That is
 * the honest outcome — the alternative is a message plainly meant for ACTS
 * being handed to the traversal decoder.
 */
export function behaviorIn(text: string): string | undefined {
  const match = NAME.exec(text.trim());
  return match ? match[1] : undefined;
}

/**
 * The behaviour this request belongs to, from the current message or, for a
 * continuation turn that carries no prefix, from the task's own history.
 */
export function behaviorFor(context: RequestContext): string | undefined {
  const named = behaviorIn(firstText(context.userMessage));
  if (named) return named;

  const task: Task | undefined = context.task;
  if (!task) return undefined;
  for (const historical of task.history ?? []) {
    const found = behaviorIn(firstText(historical));
    if (found) return found;
  }
  return undefined;
}

function agentMessage(context: RequestContext, text: string, id: string): Message {
  return {
    messageId: id,
    parts: [textPart(text)],
    role: Role.ROLE_AGENT,
    metadata: {},
    contextId: context.contextId,
    taskId: context.taskId,
    extensions: [],
    referenceTaskIds: [],
  };
}

function publishStatus(
  eventBus: ExecutionEventBus,
  context: RequestContext,
  state: TaskState,
  text: string
): void {
  eventBus.publish(
    AgentEvent.statusUpdate({
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state,
        message: agentMessage(context, text, `acts-${state}`),
        timestamp: new Date().toISOString(),
      },
      metadata: undefined,
    })
  );
}

function publishArtifact(
  eventBus: ExecutionEventBus,
  context: RequestContext,
  parts: Part[],
  name: string,
  opts: { artifactId?: string; append?: boolean; lastChunk?: boolean } = {}
): void {
  eventBus.publish(
    AgentEvent.artifactUpdate({
      taskId: context.taskId,
      contextId: context.contextId,
      artifact: {
        artifactId: opts.artifactId ?? `${context.taskId}-${name}`,
        name,
        description: '',
        parts,
        metadata: {},
        extensions: [],
      },
      append: opts.append ?? false,
      lastChunk: opts.lastChunk ?? true,
      metadata: undefined,
    })
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Serve one ACTS request, start to finish.
 *
 * Owns the task lifecycle rather than being handed a live task, because
 * `tck-message-response` must produce **no** task at all — A2A lets an agent
 * answer with a bare `Message`, and a server that opened a task first would
 * make the response a task update instead, which is the opposite of what
 * `CORE-SEND-003` checks.
 */
export async function run(
  behavior: string,
  context: RequestContext,
  eventBus: ExecutionEventBus
): Promise<void> {
  console.log(`[acts] behaviour ${behavior} on task ${context.taskId}`);

  if (behavior === 'tck-message-response') {
    eventBus.publish(
      AgentEvent.message(agentMessage(context, 'tck message response', `acts-msg-${context.taskId}`))
    );
    return;
  }

  // A continuation turn already has a task; re-announcing it would emit a
  // second submitted event for the same id.
  if (!context.task) {
    eventBus.publish(
      AgentEvent.task({
        id: context.taskId,
        contextId: context.contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [context.userMessage],
        metadata: {},
      })
    );
  }

  eventBus.publish(
    AgentEvent.statusUpdate({
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        message: undefined,
        timestamp: new Date().toISOString(),
      },
      metadata: undefined,
    })
  );

  await dispatch(behavior, context, eventBus);
}

/**
 * ACTS §10: run a canonical wire payload through this SDK's own client.
 *
 * The request carries `{operation, wire_payload}` in a data part; the reply
 * carries whatever the client parsed, in the same data-part shape, so the
 * runner can assert `expect_parsed` against it exactly as it would
 * `expect.body`.
 */
async function clientParseBehavior(
  context: RequestContext,
  eventBus: ExecutionEventBus
): Promise<void> {
  let request: { operation: string; payload: unknown } | undefined;
  for (const part of context.userMessage?.parts ?? []) {
    if (part.content?.$case === 'data') {
      request = clientParse.requestFrom(part.content.value);
      if (request) break;
    }
  }

  if (!request) {
    publishStatus(
      eventBus,
      context,
      TaskState.TASK_STATE_FAILED,
      'tck-client-parse needs {operation, wire_payload}'
    );
    return;
  }

  const parsed = await clientParse.parse(request.operation, request.payload);
  publishArtifact(eventBus, context, [dataPart(parsed)], clientParse.BEHAVIOR);
  publishStatus(
    eventBus,
    context,
    TaskState.TASK_STATE_COMPLETED,
    `${request.operation} parsed`
  );
}

/**
 * Take an already-working task to wherever the behaviour ends.
 *
 * An unknown behaviour fails the task loudly rather than completing it — a
 * silent success would report conformance the agent never demonstrated.
 */
async function dispatch(
  behavior: string,
  context: RequestContext,
  eventBus: ExecutionEventBus
): Promise<void> {
  switch (behavior) {
    case clientParse.BEHAVIOR:
      await clientParseBehavior(context, eventBus);
      return;

    case 'tck-multi-turn': {
      // INPUT_REQUIRED until the user says `done`.
      const said = firstText(context.userMessage).trim().toLowerCase();
      if (said.startsWith(MULTI_TURN_DONE)) {
        publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, 'multi-turn complete');
      } else {
        publishStatus(eventBus, context, TaskState.TASK_STATE_INPUT_REQUIRED, 'more input please');
      }
      return;
    }

    case 'tck-cancel':
      // Hold in WORKING. `cancelTask` on the executor publishes CANCELED, so
      // nothing terminal is emitted here.
      return;

    case 'tck-long-running': {
      await sleep(LONG_RUNNING_DELAY_MS);
      // `CORE-EXEC-001` polls to completion and then asserts the finished
      // task carries at least one artifact, so the work has to leave one
      // behind even though §11.2 describes this behaviour only as "delayed
      // completion".
      publishArtifact(eventBus, context, [textPart('long running result')], 'long-running');
      publishStatus(
        eventBus,
        context,
        TaskState.TASK_STATE_COMPLETED,
        'long running work finished'
      );
      return;
    }

    case 'tck-stream-basic': {
      publishStatus(eventBus, context, TaskState.TASK_STATE_WORKING, 'streaming started');
      publishArtifact(eventBus, context, [textPart('streamed content')], 'streamed');
      publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, `${behavior} ok`);
      return;
    }

    case 'tck-stream-chunked': {
      publishStatus(eventBus, context, TaskState.TASK_STATE_WORKING, 'streaming started');
      const artifactId = `${context.taskId}-chunked`;
      const chunks = ['chunk one ', 'chunk two ', 'chunk three'];
      chunks.forEach((chunk, index) => {
        publishArtifact(eventBus, context, [textPart(chunk)], 'chunked', {
          artifactId,
          append: index > 0,
          lastChunk: index === chunks.length - 1,
        });
      });
      publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, `${behavior} ok`);
      return;
    }

    case 'tck-artifact-text':
    case 'tck-artifact-data':
    case 'tck-artifact-file':
    case 'tck-artifact-file-url': {
      const parts: Record<string, Part[]> = {
        'tck-artifact-text': [textPart('generated text content')],
        'tck-artifact-data': [dataPart({ key: 'value', count: 1 })],
        'tck-artifact-file': [filePart()],
        'tck-artifact-file-url': [fileUrlPart()],
      };
      publishArtifact(eventBus, context, parts[behavior], behavior);
      publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, `${behavior} ok`);
      return;
    }

    default: {
      const terminal: Record<string, TaskState> = {
        'tck-complete-task': TaskState.TASK_STATE_COMPLETED,
        'tck-task-failure': TaskState.TASK_STATE_FAILED,
        'tck-reject-task': TaskState.TASK_STATE_REJECTED,
        'tck-input-required': TaskState.TASK_STATE_INPUT_REQUIRED,
        'tck-auth-required': TaskState.TASK_STATE_AUTH_REQUIRED,
      };
      const state = terminal[behavior];
      if (state === undefined) {
        publishStatus(
          eventBus,
          context,
          TaskState.TASK_STATE_FAILED,
          `unimplemented ACTS behaviour '${behavior}'`
        );
        return;
      }
      publishStatus(eventBus, context, state, `${behavior} ok`);
    }
  }
}
