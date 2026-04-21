import express from 'express';
import { Message, AgentCard, AGENT_CARD_PATH, TaskState, Role } from '../src/index.js';
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
import { Instruction } from './a2a-samples/itk/agents/ts/v10/pb/instruction.js';
import {
  ClientFactory,
  ClientFactoryOptions,
  AgentCardResolver,
  JsonRpcTransportFactory,
} from '../src/client/index.js';
import { GrpcTransportFactory } from '../src/client/transports/grpc/grpc_transport.js';
import process from 'process';
import * as grpc from '@grpc/grpc-js';
import {
  grpcService,
  A2AService,
  UserBuilder as GrpcUserBuilder,
} from '../src/server/grpc/index.js';

// This middle layer is required as current Python orchestrator uses v0.3 protocol spec to send and receive messages.
// Once ITK is updated to transport-agnostic orchestrator, this conversion middle layer will become obsolete.

export class ItkAgentExecutor implements AgentExecutor {
  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Executing task ${context.taskId}`);

    // Publish initial task state to satisfy ResultManager
    eventBus.publish(
      AgentEvent.task({
        id: context.taskId,
        contextId: context.contextId,
        status: { state: 1, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [],
        history: [context.userMessage],
        metadata: {},
      })
    );

    // Publish submitted and working states
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: context.taskId,
        contextId: context.contextId,
        status: { state: 1, message: undefined, timestamp: new Date().toISOString() },
        metadata: undefined,
      })
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: context.taskId,
        contextId: context.contextId,
        status: { state: 2, message: undefined, timestamp: new Date().toISOString() },
        metadata: undefined,
      })
    );

    const message = context.userMessage;
    const instruction = this.extractInstruction(message);
    if (!instruction) {
      const errorMsg = 'No valid instruction found in request';
      console.error(errorMsg);
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 4, // FAILED
            message: {
              messageId: 'fail',
              parts: [
                {
                  content: { $case: 'text', value: errorMsg },
                  mediaType: 'text/plain',
                  filename: '',
                  metadata: {},
                },
              ],
              role: 2, // ROLE_AGENT
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
      return;
    }

    try {
      console.log('Instruction:', JSON.stringify(Instruction.toJSON(instruction)));
      const results = await this.handleInstruction(instruction);
      const responseText = results.join('\n');
      console.log('Response:', responseText);

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 3, // COMPLETED
            message: {
              messageId: 'done',
              parts: [
                {
                  content: { $case: 'text', value: responseText },
                  mediaType: 'text/plain',
                  filename: '',
                  metadata: {},
                },
              ],
              role: 2, // ROLE_AGENT
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
      console.log(`Task ${context.taskId} completed`);
    } catch (error) {
      console.error('Error handling instruction:', error);
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 4, // FAILED
            message: {
              messageId: 'fail',
              parts: [
                {
                  content: { $case: 'text', value: String(error) },
                  mediaType: 'text/plain',
                  filename: '',
                  metadata: {},
                },
              ],
              role: 2, // ROLE_AGENT
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
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`Cancel requested for task ${taskId}`);
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: taskId,
        contextId: '',
        status: { state: 5, message: undefined, timestamp: new Date().toISOString() }, // CANCELED
        metadata: undefined,
      })
    );
  }

  private extractInstruction(message: Message): Instruction | null {
    console.log(
      `[ITK Agent] Extracting instruction from message:`,
      JSON.stringify(message, null, 2)
    );
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
            const raw = Buffer.from(part.content.value, 'base64');
            return Instruction.decode(raw);
          } catch (e) {
            console.debug('Failed to parse instruction from text part as base64', e);
          }
        }
      }

      // 2. Handle base64 encoded instruction in any text part
      if (part.content?.$case === 'text') {
        try {
          const raw = Buffer.from(part.content.value, 'base64');
          const inst = Instruction.decode(raw);
          return inst;
        } catch (e) {
          // Ignore, might not be base64 or not an instruction
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

  private async handleCallAgent(call: Record<string, unknown>): Promise<string[]> {
    console.log(`Calling agent ${call.agentCardUri} via ${call.transport}`);

    // Mapping transport string to TransportProtocolName
    const transportMap: { [key: string]: string } = {
      jsonrpc: 'JSONRPC',
      JSONRPC: 'JSONRPC',

      'HTTP+JSON': 'HTTP+JSON',
      HTTP_JSON: 'HTTP+JSON',
      REST: 'HTTP+JSON',
      GRPC: 'GRPC',
    };

    const transportStr = call.transport as string;
    const selectedTransport = transportMap[transportStr.toUpperCase()];
    if (!selectedTransport) {
      throw new Error(`Unsupported transport: ${transportStr}`);
    }

    const factory = new ClientFactory({
      transports: [
        new JsonRpcTransportFactory({
          fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
            const response = await fetch(input, init);
            const contentType = response.headers.get('Content-Type');
            console.log(
              `[ItkAgent fetchImpl] URL: ${input.toString()}, Status: ${response.status}, Content-Type: ${contentType}`
            );
            if (response.ok) {
              const text = await response.text();
              console.log(`[ItkAgent fetchImpl] Raw response text: ${text}`);
              return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
            return response;
          },
        }),
        new GrpcTransportFactory(),
        ...ClientFactoryOptions.default.transports.filter((t) => t.protocolName !== 'JSONRPC'),
      ],
      preferredTransports: [selectedTransport as 'JSONRPC' | 'HTTP+JSON' | 'GRPC'], // Keep for now, will revisit if needed
    });

    try {
      const resolver = AgentCardResolver.default;
      const baseUri = call.agentCardUri as string;
      let card: AgentCard | undefined;

      // Try standard path first (with slash)
      try {
        const response = await fetch(baseUri + '/.well-known/agent-card.json');
        if (response.ok) {
          card = await response.json();
          console.log('[ItkAgent] Fetched card from standard path');
        }
      } catch (_e) {
        /* ignore */
      }

      // Try path without slash (Go agent bug fallback)
      if (!card) {
        try {
          const response = await fetch(baseUri + '.well-known/agent-card.json');
          if (response.ok) {
            card = await response.json();
            console.log('[ItkAgent] Fetched card from Go fallback path');
          }
        } catch (_e) {
          /* ignore */
        }
      }

      // Fallback to resolver if both failed
      if (!card) {
        let uri = baseUri;
        if (uri.endsWith('/jsonrpc')) {
          uri = uri.substring(0, uri.length - 8);
        }
        card = await resolver.resolve(uri);
        console.log('[ItkAgent] Fetched card via resolver');
      }

      console.log('[ItkAgent] Fetched outbound agent card:', JSON.stringify(card, null, 2));

      // Ensure case-insensitivity matching works by normalising protocolBinding if needed
      // or just let createFromAgentCard do it (it uses CaseInsensitiveMap).
      // Let's just log it for now.

      const client = await factory.createFromAgentCard(card);

      // Wrap nested instruction
      const instBytes = Instruction.encode(call.instruction).finish();
      const nestedMsg: Message = {
        messageId: Math.random().toString(36).substring(2),
        contextId: '',
        taskId: '',
        role: 1, // ROLE_USER
        parts: [
          {
            content: { $case: 'text', value: Buffer.from(instBytes).toString('base64') },
            filename: '',
            mediaType: '',
            metadata: {},
          },
        ],
        extensions: [],
        referenceTaskIds: [],
        metadata: {},
      };

      const results: string[] = [];

      const processMessage = (msg: Message) => {
        for (const part of msg.parts) {
          let textValue = '';
          if (part.content?.$case === 'text') {
            textValue = part.content.value;
          }

          if (textValue) {
            // Check if it looks like base64 encoded binary data
            if (
              textValue.length > 50 &&
              !textValue.includes(' ') &&
              /^[A-Za-z0-9+/]+=*$/.test(textValue)
            ) {
              try {
                const buf = Buffer.from(textValue, 'base64');
                const matches = buf.toString('binary').match(/[ -~]{5,}/g);
                if (matches) {
                  textValue = matches.join('\n');
                }
              } catch (_e) {
                /* ignore */
              }
            }
            results.push(textValue);
          }

          let rawBuf: Buffer | undefined;
          if (part.content?.$case === 'raw') {
            if (part.content.value) {
              rawBuf = Buffer.from(part.content.value);
            }
          }

          if (rawBuf) {
            try {
              const matches = rawBuf.toString('binary').match(/[ -~]{5,}/g);
              if (matches) {
                results.push(matches.join('\n'));
              } else {
                results.push(rawBuf.toString('utf8'));
              }
            } catch (_e) {
              /* ignore */
            }
          }
        }
      };

      if (call.streaming) {
        for await (const event of client.sendMessageStream({
          tenant: '',
          message: nestedMsg,
          configuration: undefined,
          metadata: {},
        })) {
          console.log('Event received from called agent:', JSON.stringify(event));
          let message: Message | undefined;

          const streamResponse = event as StreamResponse;
          if (streamResponse.payload) {
            const payload = streamResponse.payload;
            if (payload.$case === 'message') {
              message = payload.value;
            } else if (payload.$case === 'statusUpdate') {
              message = payload.value.status?.message;
            } else if (payload.$case === 'task') {
              message = payload.value.status?.message;
            }
          }

          if (message) {
            processMessage(message);
          }
        }
      } else {
        const response = await client.sendMessage({
          tenant: '',
          message: nestedMsg,
          configuration: undefined,
          metadata: {},
        });
        console.log('Response received from called agent:', JSON.stringify(response));

        const respObj = response as unknown as Record<string, unknown>;
        if ('parts' in respObj) {
          processMessage(response as unknown as Message);
        }
        if ('history' in respObj && Array.isArray(respObj.history)) {
          for (const msg of respObj.history) {
            processMessage(msg as unknown as Message);
          }
        }
        const status = respObj.status as Record<string, unknown> | undefined;
        if (status && status.message) {
          processMessage(status.message as unknown as Message);
        }
      }
      return results;
    } catch (e) {
      console.error('Failed to call outbound agent', e);
      throw new Error(`Outbound call to ${call.agentCardUri} failed: ${e}`);
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

  const agentCard: AgentCard & { url?: string } = {
    url: `http://127.0.0.1:${httpPort}/jsonrpc`,
    name: 'ITK TS Agent',

    description: 'TypeScript agent using SDK for ITK tests.',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
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
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  const app = express();

  // The sample agent used specific paths, let's match them if needed, or just use standard
  // Python used:
  // app.mount('/jsonrpc', FastAPI(routes=jsonrpc_routes + agent_card_routes))
  // So it served jsonrpc at /jsonrpc and agent card at /jsonrpc/.well-known/agent-card.json

  const jsonRpcPath = '/jsonrpc';
  const restPath = '/rest';

  app.use(
    `${jsonRpcPath}/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler })
  );
  app.use(jsonRpcPath, express.json());
  app.use(jsonRpcPath, (req, res, next) => {
    console.log('[ItkAgent] Request headers:', req.headers);
    console.log('[ItkAgent] Raw JSON-RPC request:', JSON.stringify(req.body, null, 2));

    if (req.body?.params?.message) {
      const msg = req.body.params.message;
      if (msg.role === 'user') {
        msg.role = 1; // ROLE_USER
      }
      if (msg.parts) {
        msg.parts = msg.parts.map((part: Record<string, unknown>) => {
          if (part.kind === 'file' && part.file) {
            const file = part.file as Record<string, unknown>;
            return {
              mediaType: file.mimeType,
              filename: file.name,
              text: file.bytes,
            };
          }
          return part;
        });
      }
    }
    next();
  });
  // Middleware to rewrite outgoing SSE events to match expected format
  app.use(jsonRpcPath, (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const isGoAgent = userAgent.includes('Go-http-client');

    const rewriteMessage = (msg: Record<string, unknown>) => {
      if (!msg) return;
      if (msg.role === 1 || msg.role === 'user') msg.role = 'user';
      if (msg.role === 2 || msg.role === 'agent') msg.role = 'agent';
      if (msg.parts && Array.isArray(msg.parts)) {
        msg.parts = msg.parts.map((partItem: unknown) => {
          const part = partItem as Record<string, unknown>;
          if (part.content) {
            const content = part.content as Record<string, unknown>;
            if (content.$case === 'text') {
              let textValue = content.value as string;
              // Check if it looks like base64 encoded binary data (no spaces, valid base64 chars, length > 50)
              if (
                textValue &&
                textValue.length > 50 &&
                !textValue.includes(' ') &&
                /^[A-Za-z0-9+/]+=*$/.test(textValue)
              ) {
                try {
                  const buf = Buffer.from(textValue, 'base64');
                  // Extract printable ASCII strings (length >= 5)
                  const matches = buf.toString('binary').match(/[ -~]{5,}/g);
                  if (matches) {
                    textValue = matches.join('\n');
                  }
                } catch (_e) {
                  // ignore and use original
                }
              }
              const newPart = { ...part, text: textValue };
              delete (newPart as Record<string, unknown>).content;
              return newPart;
            } else if (content.$case === 'raw') {
              // Map raw to text for 0.3 compatibility
              const newPart = { ...part, text: '[binary data]' };
              const contentValue = content.value as Record<string, unknown> | undefined;
              if (contentValue && contentValue.data) {
                try {
                  const buf = Buffer.from(contentValue.data as unknown as string);
                  // Extract printable ASCII strings (length >= 5) to catch tokens in protobuf data
                  const matches = buf.toString('binary').match(/[ -~]{5,}/g);
                  if (matches) {
                    newPart.text = matches.join('\n');
                  } else {
                    newPart.text = buf.toString('utf8');
                  }
                } catch (_e) {
                  // use fallback
                }
              }
              delete (newPart as Record<string, unknown>).content; // Clean up content if needed
              return newPart;
            }
          }
          return part;
        });
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rewriteResponse = (data: any) => {
      const stateMap: { [key: number]: string } = {
        0: 'unknown',
        1: 'submitted',
        2: 'working',
        3: 'completed',
        4: 'failed',
        5: 'canceled',
        6: 'input-required',
        7: 'rejected',
      };

      if (isGoAgent) {
        // Go agent expects {"task": {...}} or {"statusUpdate": {...}}
        // Handle stream event (payload at root)
        if (data && data.payload && data.payload.$case) {
          const caseName = data.payload.$case;
          const value = data.payload.value;

          if (caseName === 'message') {
            rewriteMessage(value);
          } else if (caseName === 'statusUpdate' || caseName === 'task') {
            if (value.status && typeof value.status.state === 'number') {
              value.status.state = stateMap[value.status.state] || 'unknown';
            }
            if (value.status && value.status.message) {
              rewriteMessage(value.status.message);
            }
            if (value.history && Array.isArray(value.history)) {
              value.history.forEach((msg: Record<string, unknown>) => rewriteMessage(msg));
            }
          }

          delete data.payload;
          data[caseName] = value;
          return data;
        }

        // Handle regular response (payload inside result)
        if (data && data.result && data.result.payload && data.result.payload.$case) {
          const caseName = data.result.payload.$case;
          const value = data.result.payload.value;

          if (caseName === 'message') {
            rewriteMessage(value);
          } else if (caseName === 'statusUpdate' || caseName === 'task') {
            if (value.status && typeof value.status.state === 'number') {
              value.status.state = stateMap[value.status.state] || 'unknown';
            }
            if (value.status && value.status.message) {
              rewriteMessage(value.status.message);
            }
            if (value.history && Array.isArray(value.history)) {
              value.history.forEach((msg: Record<string, unknown>) => rewriteMessage(msg));
            }
          }

          delete data.result.payload;
          data.result[caseName] = value;
          return data;
        }
        return data;
      }

      // Non-Go agent (Python orchestrator expecting 0.3-like flat structure)
      if (data && data.result && data.result.payload) {
        const payload = data.result.payload;
        if (payload.$case && payload.value !== undefined) {
          const caseName = payload.$case;
          const value = payload.value;

          if (caseName === 'message') {
            rewriteMessage(value);
          } else if (caseName === 'statusUpdate' || caseName === 'task') {
            if (caseName === 'task') {
              value.kind = 'task';
            } else if (caseName === 'statusUpdate') {
              value.kind = 'status-update';
            }

            if (value.status && typeof value.status.state === 'number') {
              value.status.state = stateMap[value.status.state] || 'unknown';
            }

            if (value.status && value.status.message) {
              rewriteMessage(value.status.message);
            }

            if (value.history && Array.isArray(value.history)) {
              value.history.forEach((msg: Record<string, unknown>) => rewriteMessage(msg));
            }

            if (caseName === 'statusUpdate') {
              value.final = false;
              if (
                value.status &&
                (value.status.state === 'completed' || value.status.state === 'failed')
              ) {
                value.final = true;
              }
            }
          }

          // Flatten: set result directly to the value
          data.result = value;
        }
      }
      return data;
    };

    const originalWrite = res.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.write = function (chunk: any, encoding?: any, callback?: any) {
      let chunkStr = chunk.toString();
      if (chunkStr.startsWith('data: ')) {
        try {
          const dataStr = chunkStr.substring(6).trim();
          const data = JSON.parse(dataStr);
          rewriteResponse(data);
          chunkStr = `data: ${JSON.stringify(data)}\n\n`;
          return originalWrite.call(this, Buffer.from(chunkStr), encoding, callback);
        } catch (_e) {
          return originalWrite.call(this, chunk, encoding, callback);
        }
      }
      return originalWrite.call(this, chunk, encoding, callback);
    };

    const originalSend = res.send;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.send = function (body: any) {
      if (typeof body === 'string') {
        try {
          const data = JSON.parse(body);
          rewriteResponse(data);
          body = JSON.stringify(data);
        } catch (_e) {
          // not json
        }
      } else if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
        rewriteResponse(body);
      }
      return originalSend.call(this, body);
    };

    next();
  });

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
      grpcServer.start();
      console.log(`gRPC server listening on port ${port}`);
    }
  );
}

main().catch(console.error);
