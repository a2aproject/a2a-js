/**
 * A2A TCK System Under Test (SUT) agent.
 *
 * Implements the message-prefix-routed executor behavior expected by the
 * a2a-tck Gherkin scenarios (see https://github.com/a2aproject/a2a-tck
 * `scenarios/core_operations.feature` and `scenarios/streaming.feature`).
 *
 * The TCK probes one agent over three transports — JSON-RPC, REST
 * (HTTP+JSON) and gRPC. Each test sends a message with a well-known
 * `messageId` prefix and asserts on the resulting events. The executor
 * dispatches per-prefix, mirroring the reference a2a-python SUT at
 * `a2a-tck/sut/a2a-python/sut_agent.py`.
 */
import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { v4 as uuidv4 } from 'uuid';

import {
  AgentCard,
  AGENT_CARD_PATH,
  Artifact,
  Message,
  Part,
  Role,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
} from '../../src/index.js';
import {
  AgentEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
  TaskStore,
} from '../../src/server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '../../src/server/express/index.js';
import { A2AService, grpcService } from '../../src/server/grpc/index.js';

const REST_PATH = '/a2a/rest';

/**
 * SUT executor. Routes incoming messages by their `messageId` prefix to
 * pre-baked behaviors matching the TCK Gherkin scenarios.
 */
class TckAgentExecutor implements AgentExecutor {
  /** Track currently-running tasks so cancel() can short-circuit. */
  private readonly running = new Set<string>();

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = context.taskId;
    const contextId = context.contextId;
    const userMessage = context.userMessage;
    const messageId = userMessage?.messageId ?? '';

    // Publish initial Task event for new tasks. ResultManager requires a
    // task event before any status / artifact updates so that
    // subsequent transitions have something to apply on top of.
    if (!context.task) {
      this.publishTask(eventBus, taskId, contextId, userMessage);
    }

    this.running.add(taskId);

    try {
      // ----------------------------------------------------------------
      // Streaming-only scenarios first — their prefixes share a
      // namespace with the non-streaming "tck-artifact-*" set so
      // ordering matters.
      // ----------------------------------------------------------------

      if (messageId.startsWith('tck-stream-artifact-chunked')) {
        this.publishWorking(eventBus, taskId, contextId);
        this.publishArtifact(eventBus, taskId, contextId, [textPart('chunk-1 ')], {
          append: true,
        });
        this.publishArtifact(eventBus, taskId, contextId, [textPart('chunk-2')], {
          append: true,
          lastChunk: true,
        });
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('test-resubscribe-message-id')) {
        this.publishWorking(eventBus, taskId, contextId);
        // Reference SUT sleeps 2x the streaming timeout (2s * 2 = 4s)
        // to give resubscription tests a window to disconnect and
        // reattach before the task completes.
        await this.sleep(4000, taskId);
        if (!this.running.has(taskId)) {
          return;
        }
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-stream-artifact-text')) {
        this.publishWorking(eventBus, taskId, contextId);
        this.publishArtifact(eventBus, taskId, contextId, [textPart('Streamed text content')]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-stream-artifact-file')) {
        this.publishWorking(eventBus, taskId, contextId);
        this.publishArtifact(eventBus, taskId, contextId, [filePart('output.txt', 'text/plain')]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (
        messageId.startsWith('tck-stream-001') ||
        messageId.startsWith('tck-stream-003') ||
        messageId.startsWith('tck-stream-ordering-001')
      ) {
        const text = messageId.startsWith('tck-stream-ordering-001')
          ? 'Ordered output'
          : messageId.startsWith('tck-stream-001')
            ? 'Stream hello from TCK'
            : 'Stream task lifecycle';
        this.publishWorking(eventBus, taskId, contextId);
        this.publishArtifact(eventBus, taskId, contextId, [textPart(text)]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-stream-002')) {
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      // ----------------------------------------------------------------
      // Non-streaming behaviours.
      // ----------------------------------------------------------------

      if (messageId.startsWith('tck-artifact-file-url')) {
        this.publishArtifact(eventBus, taskId, contextId, [
          fileUrlPart('https://example.com/output.txt', 'output.txt', 'text/plain'),
        ]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-message-response')) {
        // Bare message response — no task lifecycle. The SDK turns any
        // `message` event into the final result regardless of task
        // state; we still emitted the initial Task event above, but
        // the message takes precedence in the response.
        eventBus.publish(
          AgentEvent.message(
            this.makeAgentMessage(taskId, contextId, [textPart('Direct message response')])
          )
        );
        return;
      }

      if (messageId.startsWith('tck-input-required')) {
        const inputMsg = this.makeAgentMessage(taskId, contextId, [
          textPart('Please provide input'),
        ]);
        this.publishStatus(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_INPUT_REQUIRED,
          inputMsg
        );
        return;
      }

      if (messageId.startsWith('tck-complete-task')) {
        const doneMsg = this.makeAgentMessage(taskId, contextId, [textPart('Hello from TCK')]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED, doneMsg);
        return;
      }

      if (messageId.startsWith('tck-artifact-text')) {
        this.publishArtifact(eventBus, taskId, contextId, [textPart('Generated text content')]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-artifact-file')) {
        this.publishArtifact(eventBus, taskId, contextId, [filePart('output.txt', 'text/plain')]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-artifact-data')) {
        this.publishArtifact(eventBus, taskId, contextId, [dataPart({ key: 'value', count: 42 })]);
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
        return;
      }

      if (messageId.startsWith('tck-reject-task')) {
        // The reference Python SUT raises an A2AError("rejected") which
        // the SDK surfaces as a REJECTED terminal state.
        this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_REJECTED);
        return;
      }

      // Default: echo the prefix back in a completion message. Mirrors
      // the reference SUT's fallthrough so unknown messageIds don't
      // hang or hard-fail.
      const echoMsg = this.makeAgentMessage(taskId, contextId, [
        textPart(`Unhandled messageId prefix: ${messageId}`),
      ]);
      this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED, echoMsg);
    } finally {
      this.running.delete(taskId);
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.running.delete(taskId);
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: '',
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );
  }

  // ---------------------------------------------------------------------
  // Event publishing helpers
  // ---------------------------------------------------------------------

  private publishTask(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    userMessage: Message | undefined
  ): void {
    const initial: Task = {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        message: undefined,
        timestamp: new Date().toISOString(),
      },
      artifacts: [],
      history: userMessage ? [userMessage] : [],
      metadata: userMessage?.metadata,
    };
    eventBus.publish(AgentEvent.task(initial));
  }

  private publishWorking(eventBus: ExecutionEventBus, taskId: string, contextId: string): void {
    this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_WORKING);
  }

  private publishStatus(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState,
    message?: Message
  ): void {
    const evt: TaskStatusUpdateEvent = {
      taskId,
      contextId,
      status: {
        state,
        message,
        timestamp: new Date().toISOString(),
      },
      metadata: undefined,
    };
    eventBus.publish(AgentEvent.statusUpdate(evt));
  }

  private publishArtifact(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    parts: Part[],
    options: { append?: boolean; lastChunk?: boolean } = {}
  ): void {
    const artifact: Artifact = {
      artifactId: uuidv4(),
      name: '',
      description: '',
      parts,
      metadata: undefined,
      extensions: [],
    };
    const evt: TaskArtifactUpdateEvent = {
      taskId,
      contextId,
      artifact,
      append: options.append ?? false,
      lastChunk: options.lastChunk ?? false,
      metadata: undefined,
    };
    eventBus.publish(AgentEvent.artifactUpdate(evt));
  }

  private makeAgentMessage(taskId: string, contextId: string, parts: Part[]): Message {
    return {
      messageId: uuidv4(),
      contextId,
      taskId,
      role: Role.ROLE_AGENT,
      parts,
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };
  }

  private async sleep(ms: number, taskId: string): Promise<void> {
    const step = 200;
    let elapsed = 0;
    while (elapsed < ms) {
      if (!this.running.has(taskId)) {
        return;
      }
      const next = Math.min(step, ms - elapsed);
      await new Promise((resolve) => setTimeout(resolve, next));
      elapsed += next;
    }
  }
}

// -------------------------------------------------------------------------
// Part construction helpers (mirror reference SUT shapes).
// -------------------------------------------------------------------------

function textPart(text: string): Part {
  return {
    content: { $case: 'text', value: text },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function filePart(filename: string, mediaType: string): Part {
  return {
    content: { $case: 'raw', value: Buffer.from('tck') },
    metadata: undefined,
    filename,
    mediaType,
  };
}

function fileUrlPart(url: string, filename: string, mediaType: string): Part {
  return {
    content: { $case: 'url', value: url },
    metadata: undefined,
    filename,
    mediaType,
  };
}

function dataPart(data: unknown): Part {
  return {
    content: { $case: 'data', value: data },
    metadata: undefined,
    filename: '',
    mediaType: 'application/json',
  };
}

// -------------------------------------------------------------------------
// Server bootstrap
// -------------------------------------------------------------------------

function buildAgentCard(httpPort: number, grpcPort: number): AgentCard {
  const httpHost = `http://localhost:${httpPort}`;
  return {
    name: 'A2A JS SDK System Under Test (SUT)',
    description: 'SUT agent for the a2a-tck conformance suite.',
    version: '1.0.0',
    provider: {
      organization: 'A2A Project',
      url: 'https://github.com/a2aproject',
    },
    documentationUrl: '',
    iconUrl: '',
    // The TCK uses `supportedInterfaces[].protocolBinding` to discover
    // which transports to test. The binding strings MUST be
    // `JSONRPC`, `HTTP+JSON`, or `GRPC` — the TCK ignores any other
    // value (see `tck.transport.manager._TRANSPORT_FACTORIES`).
    supportedInterfaces: [
      {
        url: httpHost,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `${httpHost}${REST_PATH}`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `localhost:${grpcPort}`,
        protocolBinding: 'GRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        id: 'tck',
        name: 'TCK Conformance',
        description: 'Handles TCK conformance test messages.',
        tags: ['tck'],
        examples: [],
        inputModes: ['text'],
        outputModes: ['text'],
        securityRequirements: [],
      },
    ],
  };
}

async function main(): Promise<void> {
  const httpPort = Number(process.env.HTTP_PORT ?? 41241);
  const grpcPort = Number(process.env.GRPC_PORT ?? 41242);

  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new TckAgentExecutor();
  const agentCard = buildAgentCard(httpPort, grpcPort);
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  const app = express();

  // Per §8.2 the agent card MUST be served at `/.well-known/agent-card.json`.
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));

  // REST under /a2a/rest. The TCK derives `/message:send`, `/tasks/:id`
  // etc. from this base URL. Mount REST first so its routes are not
  // shadowed by the root-mounted JSON-RPC handler.
  app.use(REST_PATH, restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // JSON-RPC at the HTTP server root — the TCK `JsonRpcClient` posts
  // to `/` of the URL declared in the agent card.
  app.use('/', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(httpPort, () => {
    console.log(`[TckSut] HTTP server on http://localhost:${httpPort}`);
    console.log(`[TckSut] Agent card at http://localhost:${httpPort}/${AGENT_CARD_PATH}`);
  });

  const grpcServer = new Server();
  grpcServer.addService(
    A2AService,
    grpcService({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  grpcServer.bindAsync(`0.0.0.0:${grpcPort}`, ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error(`[TckSut] gRPC bind failed: ${err.message}`);
      return;
    }
    console.log(`[TckSut] gRPC server on localhost:${grpcPort}`);
  });
}

main().catch((err) => {
  console.error('[TckSut] Fatal:', err);
  process.exit(1);
});
