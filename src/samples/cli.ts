#!/usr/bin/env node

import readline from 'node:readline';
import crypto from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

import {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
  Task, // Added for direct Task events
  AgentCard,
  Part, // Added for explicit Part typing
  AGENT_CARD_PATH,
} from '../index.js';
import { TaskState, Role, taskStateToJSON, SendMessageRequest } from '../types/pb/a2a.js';
import { AgentExecutionEvent, AgentEvent } from '../server/index.js';

import {
  AuthenticationHandler,
  ClientFactory,
  ClientFactoryOptions,
  createAuthenticatingFetchWithRetry,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '../client/index.js';
import { GrpcTransportFactory } from '../client/transports/grpc/grpc_transport.js';

// --- ANSI Colors ---
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// --- Helper Functions ---
function colorize(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function generateId(): string {
  // Renamed for more general use
  return crypto.randomUUID();
}

// Application Default Credentials required for A2A agent running on Agent Engine.
export class ADCHandler implements AuthenticationHandler {
  private auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  async headers(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    if (token?.token) {
      return { Authorization: `Bearer ${token.token}` };
    }
    throw new Error('Failed to retrieve ADC access token.');
  }

  async shouldRetryWithHeaders(
    _req: RequestInit,
    res: Response
  ): Promise<Record<string, string> | undefined> {
    if (res.status !== 401 && res.status !== 403) return undefined;
    return this.headers();
  }
}

// --- State ---
let currentTaskId: string | undefined = undefined; // Initialize as undefined
let currentContextId: string | undefined = undefined; // Initialize as undefined

const preferredTransport = process.argv
  .find((arg) => arg.startsWith('--transport='))
  ?.split('=')[1];
const serverUrlArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const serverUrl = serverUrlArg || 'http://localhost:41241'; // Agent's base URL

let fetchImpl: typeof fetch = fetch;
let agentCardPath = AGENT_CARD_PATH;
if (process.argv.includes('--agent-engine')) {
  fetchImpl = createAuthenticatingFetchWithRetry(fetch, new ADCHandler());
  agentCardPath = 'a2a/extendedAgentCard'; // Agent Engine doesn't use well-known public agent card endpoint.
}
const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    transports: [
      new JsonRpcTransportFactory({ fetchImpl }),
      new RestTransportFactory({ fetchImpl }),
      new GrpcTransportFactory(),
    ],
    preferredTransports: preferredTransport ? [preferredTransport] : undefined,
  })
);
const client = await factory.createFromUrl(serverUrl, agentCardPath);
let agentName = 'Agent'; // Default, try to get from agent card later

// --- Readline Setup ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: colorize('cyan', 'You: '),
});

// --- Response Handling ---
// Function accepts a discriminated AgentExecutionEvent and uses `kind` to narrow the type.
function printAgentEvent(event: AgentExecutionEvent) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = colorize('magenta', `\n${agentName} [${timestamp}]:`);

  if (event.kind === 'statusUpdate') {
    const update = event.data;
    const state = update.status?.state;
    let stateEmoji = '❓';
    let stateColor: keyof typeof colors = 'yellow';

    switch (state) {
      case TaskState.TASK_STATE_WORKING:
        stateEmoji = '⏳';
        stateColor = 'blue';
        break;
      case TaskState.TASK_STATE_INPUT_REQUIRED:
        stateEmoji = '🤔';
        stateColor = 'yellow';
        break;
      case TaskState.TASK_STATE_COMPLETED:
        stateEmoji = '✅';
        stateColor = 'green';
        break;
      case TaskState.TASK_STATE_CANCELED:
        stateEmoji = '⏹️';
        stateColor = 'gray';
        break;
      case TaskState.TASK_STATE_FAILED:
        stateEmoji = '❌';
        stateColor = 'red';
        break;
      default:
        stateEmoji = 'ℹ️';
        stateColor = 'dim';
        break;
    }

    console.log(
      `${prefix} ${stateEmoji} Status: ${colorize(stateColor, taskStateToJSON(state!))} (Task: ${update.taskId}, Context: ${update.contextId})`
    );

    if (update.status?.message) {
      printMessageContent(update.status.message);
    }
  } else if (event.kind === 'artifactUpdate') {
    const update = event.data;
    console.log(
      `${prefix} 📄 Artifact Received: ${
        update.artifact?.name || '(unnamed)'
      } (ID: ${update.artifact?.artifactId}, Task: ${update.taskId}, Context: ${update.contextId})`
    );
    // Create a temporary message-like structure to reuse printMessageContent
    printMessageContent({
      messageId: generateId(),
      role: Role.ROLE_AGENT,
      parts: update.artifact?.parts || [],
      taskId: update.taskId,
      contextId: update.contextId,
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    });
  } else {
    // This case should ideally not be reached if called correctly
    console.log(
      prefix,
      colorize('yellow', 'Received unknown event type in printAgentEvent:'),
      event
    );
  }
}

function printMessageContent(message: Message) {
  message.parts.forEach((part: Part, index: number) => {
    const partPrefix = colorize('red', `  Part ${index + 1}:`);
    const p = part.content;

    if (!p) {
      return;
    }

    switch (p.$case) {
      case 'text':
        console.log(`${partPrefix} ${colorize('green', '📝 Text:')}`, p.value);
        break;
      case 'url':
        console.log(
          `${partPrefix} ${colorize('blue', '📄 URL:')} ${p.value} (Type: ${part.mediaType || 'N/A'})`
        );
        break;
      case 'raw':
        console.log(
          `${partPrefix} ${colorize('blue', '📄 Raw Bytes:')} (size: ${p.value.length}, Type: ${part.mediaType || 'N/A'})`
        );
        break;
      case 'data':
        console.log(
          `${partPrefix} ${colorize('yellow', '📊 Data:')}`,
          JSON.stringify(p.value, null, 2)
        );
        break;
      default:
        console.log(
          `${partPrefix} ${colorize('yellow', 'Unsupported part case:')}`,
          (p as any).$case
        );
        break;
    }
  });
}

// --- Agent Card Fetching ---
async function fetchAndDisplayAgentCard() {
  // Use the client's getAgentCard method.
  // The client was initialized with serverUrl, which is the agent's base URL.
  console.log(colorize('dim', `Attempting to fetch agent card from agent at: ${serverUrl}`));
  try {
    // client.getAgentCard() uses the agentBaseUrl provided during client construction
    const card: AgentCard = await client.getAgentCard();
    agentName = card.name || 'Agent'; // Update global agent name
    console.log(colorize('green', `✓ Agent Card Found:`));
    console.log(`  Name:        ${colorize('bright', agentName)}`);
    if (card.description) {
      console.log(`  Description: ${card.description}`);
    }
    console.log(`  Version:     ${card.version || 'N/A'}`);
    if (card.capabilities?.streaming) {
      console.log(`  Streaming:   ${colorize('green', 'Supported')}`);
    } else {
      console.log(`  Streaming:   ${colorize('yellow', 'Not Supported (or not specified)')}`);
    }

    const supportedTransports = new Set<string>();
    if (card.supportedInterfaces) {
      for (const iface of card.supportedInterfaces) {
        supportedTransports.add(iface.protocolBinding);
      }
    }
    console.log(`  Supported Transports: ${Array.from(supportedTransports).join(', ')}`);

    // TODO (https://github.com/a2aproject/a2a-js/issues/179): Add a way to get the protocol name from the transport.
    console.log(
      colorize(
        'green',
        `\n✓ Connected via ${Object.getPrototypeOf(client.transport).constructor.name}`
      )
    );
    // Update prompt prefix to use the fetched name
    // The prompt is set dynamically before each rl.prompt() call in the main loop
    // to reflect the current agentName if it changes (though unlikely after initial fetch).
  } catch (error: any) {
    console.log(colorize('yellow', `⚠️ Error fetching or parsing agent card`));
    throw error;
  }
}

// --- Main Loop ---
async function main() {
  console.log(colorize('bright', `A2A Terminal Client`));
  console.log(colorize('dim', `Agent Base URL: ${serverUrl}`));

  await fetchAndDisplayAgentCard(); // Fetch the card before starting the loop

  console.log(
    colorize(
      'dim',
      `No active task or context initially. Use '/new' to start a fresh session or send a message.`
    )
  );
  console.log(
    colorize('green', `Enter messages, or use '/new' to start a new session. '/exit' to quit.`)
  );

  rl.setPrompt(colorize('cyan', `${agentName} > You: `)); // Set initial prompt
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    rl.setPrompt(colorize('cyan', `${agentName} > You: `)); // Ensure prompt reflects current agentName

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === '/new') {
      currentTaskId = undefined;
      currentContextId = undefined; // Reset contextId on /new
      console.log(colorize('bright', `✨ Starting new session. Task and Context IDs are cleared.`));
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === '/exit') {
      rl.close();
      return;
    }

    // Construct params for sendMessageStream
    const messageId = generateId(); // Generate a unique message ID

    const messagePayload: Message = {
      messageId: messageId,
      role: Role.ROLE_USER,
      parts: [
        {
          content: {
            $case: 'text',
            value: input,
          },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    };

    // Conditionally add taskId to the message payload
    if (currentTaskId) {
      messagePayload.taskId = currentTaskId;
    }
    // Conditionally add contextId to the message payload
    if (currentContextId) {
      messagePayload.contextId = currentContextId;
    }

    const params: SendMessageRequest = {
      tenant: '',
      message: messagePayload,
      configuration: undefined,
      metadata: {},
      // Optional: configuration for streaming, blocking, etc.
      // configuration: {
      //   acceptedOutputModes: ['text/plain', 'application/json'], // Example
      //   blocking: false // Default for streaming is usually non-blocking
      // }
    };

    try {
      console.log(colorize('red', 'Sending message...'));
      // Use sendMessageStream
      const stream = client.sendMessageStream(params);

      // Iterate over the events from the stream
      for await (const event of stream) {
        const timestamp = new Date().toLocaleTimeString(); // Get fresh timestamp for each event
        const prefix = colorize('magenta', `\n${agentName} [${timestamp}]:`);

        const payload = (event as any).payload;
        if (!payload || !payload.$case) {
          continue;
        }

        switch (payload.$case) {
          case 'statusUpdate': {
            const typedEvent = payload.value as TaskStatusUpdateEvent;
            printAgentEvent(AgentEvent.statusUpdate(typedEvent));

            if (
              typedEvent.status?.state === TaskState.TASK_STATE_COMPLETED ||
              typedEvent.status?.state === TaskState.TASK_STATE_FAILED ||
              typedEvent.status?.state === TaskState.TASK_STATE_CANCELED ||
              typedEvent.status?.state === TaskState.TASK_STATE_REJECTED
            ) {
              console.log(
                colorize(
                  'yellow',
                  `   Task ${typedEvent.taskId} is final. Clearing current task ID.`
                )
              );
              currentTaskId = undefined;
            }
            break;
          }
          case 'artifactUpdate': {
            const typedEvent = payload.value as TaskArtifactUpdateEvent;
            printAgentEvent(AgentEvent.artifactUpdate(typedEvent));
            break;
          }
          case 'msg': {
            const msg = payload.value as Message;
            console.log(`${prefix} ${colorize('green', '✉️ Message Stream Event:')}`);
            printMessageContent(msg);
            if (msg.taskId && msg.taskId !== currentTaskId) {
              console.log(
                colorize(
                  'dim',
                  `   Task ID context updated to ${msg.taskId} based on message event.`
                )
              );
              currentTaskId = msg.taskId;
            }
            if (msg.contextId && msg.contextId !== currentContextId) {
              console.log(
                colorize('dim', `   Context ID updated to ${msg.contextId} based on message event.`)
              );
              currentContextId = msg.contextId;
            }
            break;
          }
          case 'task': {
            const task = payload.value as Task;
            console.log(
              `${prefix} ${colorize('blue', 'ℹ️ Task Stream Event:')} ID: ${task.id}, Context: ${task.contextId}, Status: ${taskStateToJSON(task.status!.state)}`
            );
            if (task.id !== currentTaskId) {
              console.log(
                colorize('dim', `   Task ID updated from ${currentTaskId || 'N/A'} to ${task.id}`)
              );
              currentTaskId = task.id;
            }
            if (task.contextId && task.contextId !== currentContextId) {
              console.log(
                colorize(
                  'dim',
                  `   Context ID updated from ${currentContextId || 'N/A'} to ${task.contextId}`
                )
              );
              currentContextId = task.contextId;
            }
            if (task.status?.message) {
              console.log(colorize('gray', '   Task includes message:'));
              printMessageContent(task.status.message);
            }
            if (task.artifacts && task.artifacts.length > 0) {
              console.log(
                colorize('gray', `   Task includes ${task.artifacts.length} artifact(s).`)
              );
            }
            break;
          }
          default:
            console.log(
              prefix,
              colorize('yellow', 'Received unknown event structure from stream:'),
              event
            );
            break;
        }
      }
      console.log(colorize('dim', `--- End of response stream for this input ---`));
    } catch (error: any) {
      const timestamp = new Date().toLocaleTimeString();
      const prefix = colorize('red', `\n${agentName} [${timestamp}] ERROR:`);
      console.error(prefix, `Error communicating with agent:`, error.message || error);
      if (error.code) {
        console.error(colorize('gray', `   Code: ${error.code}`));
      }
      if (error.data) {
        console.error(colorize('gray', `   Data: ${JSON.stringify(error.data)}`));
      }
      if (!(error.code || error.data) && error.stack) {
        console.error(colorize('gray', error.stack.split('\n').slice(1, 3).join('\n')));
      }
    } finally {
      rl.prompt();
    }
  }).on('close', () => {
    console.log(colorize('yellow', '\nExiting A2A Terminal Client. Goodbye!'));
    process.exit(0);
  });
}

// --- Start ---
main().catch((err) => {
  console.error(colorize('red', 'Unhandled error in main:'), err);
  process.exit(1);
});
