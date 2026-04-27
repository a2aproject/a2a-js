import express from 'express';
import {
  Message,
  AgentCard,
  AGENT_CARD_PATH,
  TaskState,
  Role,
  TaskPushNotificationConfig,
  Task,
} from '../src/index.js';
import { StreamResponse } from '../src/types/pb/a2a.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  DefaultRequestHandler,
  RequestContext,
  ExecutionEventBus,
  AgentEvent,
} from '../src/server/index.js';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
  restHandler,
} from '../src/server/express/index.js';
import { Instruction, CallAgent } from './a2a-samples/itk/agents/ts/v10/pb/instruction.js';
import { ClientFactory, ClientFactoryOptions } from '../src/client/index.js';
import { GrpcTransportFactory } from '../src/client/transports/grpc/grpc_transport.js';
import process from 'process';
import * as grpc from '@grpc/grpc-js';
import {
  grpcService,
  A2AService,
  UserBuilder as GrpcUserBuilder,
} from '../src/server/grpc/index.js';

export class ItkAgentExecutor implements AgentExecutor {
  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Executing task ${context.taskId}`);

    // Publish initial task to satisfy ResultManager
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

    const message = context.userMessage;
    const instruction = this.extractInstruction(message);
    if (!instruction) {
      const errorMsg = 'No valid instruction found in request';
      console.error(errorMsg);
      this.publishStatus(eventBus, context, TaskState.TASK_STATE_FAILED, errorMsg);
      return;
    }

    try {
      console.log('Instruction:', JSON.stringify(Instruction.toJSON(instruction)));
      const results = await this.handleInstruction(instruction);
      const responseText = results.join('\n');
      console.log('Response:', responseText);
      this.publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, responseText);
      console.log(`Task ${context.taskId} completed`);
    } catch (error) {
      console.error('Error handling instruction:', error);
      this.publishStatus(eventBus, context, TaskState.TASK_STATE_FAILED, String(error));
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Cancel requested for task ${taskId}`);
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

  private publishStatus(
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
          message: {
            messageId: state === TaskState.TASK_STATE_COMPLETED ? 'done' : 'fail',
            parts: [
              {
                content: { $case: 'text', value: text },
                mediaType: 'text/plain',
                filename: '',
                metadata: {},
              },
            ],
            role: Role.ROLE_AGENT,
            metadata: {},
            contextId: context.contextId,
            taskId: context.taskId,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      })
    );
  }

  private extractInstruction(message: Message): Instruction | null {
    console.log('[ITK Agent] Extracting instruction from message:', JSON.stringify(message));
    if (!message || !message.parts) return null;

    for (const part of message.parts) {
      // 1. Handle binary protobuf part
      if (part.mediaType === 'application/x-protobuf' || part.filename === 'instruction.bin') {
        if (part.content?.$case === 'raw') {
          try {
            return Instruction.decode(part.content.value);
          } catch (e) {
            console.debug('Failed to parse instruction from binary part', e);
          }
        } else if (part.content?.$case === 'text') {
          try {
            return Instruction.decode(Buffer.from(part.content.value, 'base64'));
          } catch (e) {
            console.debug('Failed to parse instruction from text part as base64', e);
          }
        }
      }

      // 2. Handle base64 encoded instruction in any text part
      if (part.content?.$case === 'text') {
        try {
          return Instruction.decode(Buffer.from(part.content.value, 'base64'));
        } catch (e) {
          console.debug('Failed to parse instruction from text part', e);
        }
      }
    }
    return null;
  }

  private async handleInstruction(inst: Instruction): Promise<string[]> {
    if (!inst.step) throw new Error('Unknown instruction type');

    switch (inst.step.$case) {
      case 'returnResponse':
        return [inst.step.value.response];
      case 'callAgent':
        return await this.handleCallAgent(inst.step.value);
      case 'steps': {
        const allResults: string[] = [];
        for (const step of inst.step.value.instructions) {
          const results = await this.handleInstruction(step);
          allResults.push(...results);
        }
        return allResults;
      }
      default:
        throw new Error('Unknown instruction type');
    }
  }

  private async handleCallAgent(call: CallAgent): Promise<string[]> {
    console.log(`Calling agent ${call.agentCardUri} via ${call.transport}`);

    const transportMap: Record<string, string> = {
      JSONRPC: 'JSONRPC',
      'HTTP+JSON': 'HTTP+JSON',
      HTTP_JSON: 'HTTP+JSON',
      REST: 'HTTP+JSON',
      GRPC: 'GRPC',
    };

    const selectedTransport = transportMap[call.transport.toUpperCase()];
    if (!selectedTransport) {
      throw new Error(`Unsupported transport: ${call.transport}`);
    }

    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new GrpcTransportFactory()],
        preferredTransports: [selectedTransport as 'JSONRPC' | 'HTTP+JSON' | 'GRPC'],
      })
    );

    // Build push notification config if the instruction specifies push_notification behavior
    let pushNotificationConfig: TaskPushNotificationConfig | undefined;
    if (call.behavior?.$case === 'pushNotification') {
      let url = call.behavior.value.url;
      if (!url) {
        throw new Error('URL not specified in push_notification behavior');
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`;
      }
      pushNotificationConfig = {
        url: `${url}/notifications`,
        token: 'itk-token',
        id: '',
        taskId: '',
        tenant: '',
        authentication: undefined,
      };
    }

    try {
      // Ensure trailing slash so URL resolution correctly appends the agent card path
      // e.g. http://host:port/jsonrpc/ + .well-known/agent-card.json = http://host:port/jsonrpc/.well-known/agent-card.json
      const baseUri = call.agentCardUri.endsWith('/') ? call.agentCardUri : call.agentCardUri + '/';
      const client = await factory.createFromUrl(baseUri);
      console.log('[ItkAgent] Created client for', call.agentCardUri);

      if (!call.instruction) {
        throw new Error('Instruction missing in callAgent step');
      }
      const instBytes = Instruction.encode(call.instruction).finish();
      const nestedMsg: Message = {
        messageId: Math.random().toString(36).substring(2),
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: 'raw', value: instBytes },
            filename: 'instruction.bin',
            mediaType: 'application/x-protobuf',
            metadata: {},
          },
        ],
        extensions: [],
        referenceTaskIds: [],
        metadata: {},
      };

      const results: string[] = [];

      const processMessage = (msg: Message | undefined) => {
        if (!msg?.parts) return;
        for (const part of msg.parts) {
          if (part.content?.$case === 'text' && part.content.value) {
            results.push(part.content.value);
          }
        }
      };

      const request = {
        tenant: '',
        message: nestedMsg,
        configuration: pushNotificationConfig
          ? { acceptedOutputModes: [], taskPushNotificationConfig: pushNotificationConfig }
          : undefined,
        metadata: {},
      };

      if (call.streaming) {
        for await (const event of client.sendMessageStream(request)) {
          console.log('Stream event:', JSON.stringify(event));
          const msg = this.extractMessageFromStreamResponse(event);
          processMessage(msg);
        }
      } else {
        const response = await client.sendMessage(request);
        console.log('Response:', JSON.stringify(response));

        // Response can be Message or Task
        if ('parts' in response) {
          processMessage(response as Message);
        } else if ('status' in response) {
          const task = response as Task;
          processMessage(task.status?.message);
          task.history?.forEach(processMessage);
        }
      }

      return results;
    } catch (e) {
      console.error('Failed to call outbound agent', e);
      throw new Error(`Outbound call to ${call.agentCardUri} failed: ${e}`);
    }
  }

  private extractMessageFromStreamResponse(event: StreamResponse): Message | undefined {
    if (!event.payload) return undefined;
    switch (event.payload.$case) {
      case 'message':
        return event.payload.value;
      case 'statusUpdate':
        return event.payload.value.status?.message;
      case 'task':
        return event.payload.value.status?.message;
      default:
        return undefined;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let httpPort = 10102;
  let grpcPort = 11002;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--httpPort' && i + 1 < args.length) {
      httpPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith('--httpPort=')) {
      httpPort = parseInt(args[i].split('=')[1], 10);
    } else if (args[i] === '--grpcPort' && i + 1 < args.length) {
      grpcPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith('--grpcPort=')) {
      grpcPort = parseInt(args[i].split('=')[1], 10);
    }
  }

  console.log(`Starting ITK TS Agent on HTTP port ${httpPort} and gRPC port ${grpcPort}`);

  const agentCard: AgentCard = {
    name: 'ITK TS Agent',
    description: 'TypeScript agent using SDK for ITK tests.',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
      extendedAgentCard: true,
    },
    supportedInterfaces: [
      {
        url: `http://127.0.0.1:${httpPort}/jsonrpc`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `127.0.0.1:${grpcPort}`,
        protocolBinding: 'GRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
      {
        url: `http://127.0.0.1:${httpPort}/rest`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    provider: {
      organization: 'A2A Samples',
      url: 'https://example.com/a2a-samples',
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain', 'application/x-protobuf'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };

  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new ItkAgentExecutor();
  // DefaultRequestHandler auto-creates push notification store and sender
  // when agentCard.capabilities.pushNotifications is true.
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  const app = express();

  const jsonRpcPath = '/jsonrpc';
  const restPath = '/rest';

  app.use(
    `${jsonRpcPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(
    `${restPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(jsonRpcPath, express.json());
  app.use(
    jsonRpcPath,
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication })
  );
  app.use(restPath, restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(httpPort, () => {
    console.log(`[ItkAgent] Server started on http://localhost:${httpPort}`);
    console.log(
      `[ItkAgent] Agent Card: http://localhost:${httpPort}${jsonRpcPath}/${AGENT_CARD_PATH}`
    );
  });

  // Start gRPC server
  const grpcServer = new grpc.Server();
  grpcServer.addService(
    A2AService,
    grpcService({
      requestHandler,
      userBuilder: GrpcUserBuilder.noAuthentication,
    })
  );

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`Failed to bind gRPC server: ${err.message}`);
        return;
      }
      console.log(`gRPC server listening on port ${port}`);
    }
  );
}

main().catch(console.error);
