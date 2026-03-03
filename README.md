# A2A JavaScript SDK

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

<!-- markdownlint-disable no-inline-html -->

<html>
   <h2 align="center">
   <img src="https://raw.githubusercontent.com/google-a2a/A2A/refs/heads/main/docs/assets/a2a-logo-black.svg" width="256" alt="A2A Logo"/>
   </h2>
   <h3 align="center">A JavaScript library that helps run agentic applications as A2AServers following the <a href="https://google-a2a.github.io/A2A">Agent2Agent (A2A) Protocol</a>.</h3>
</html>

<!-- markdownlint-enable no-inline-html -->

## Installation

You can install the A2A SDK using `npm`.

```bash
npm install @a2a-js/sdk
```

### For Server Usage

If you plan to use the Express integration (imports from `@a2a-js/sdk/server/express`) for A2A server, you'll also need to install Express as it's a peer dependency:

```bash
npm install express
```

### For gRPC Usage

If you plan to use the GRPC transport (imports from `@a2a-js/sdk/server/grpc` or `@a2a-js/sdk/client/grpc`), you must install the required peer dependencies:

```bash
npm install @grpc/grpc-js @bufbuild/protobuf
```

You can also find some samples [here](https://github.com/a2aproject/a2a-js/tree/main/src/samples).

---

## Compatibility

This SDK implements the A2A Protocol Specification [`v0.3.0`](https://a2a-protocol.org/v0.3.0/specification).

| Transport | Client | Server |
| :--- | :---: | :---: |
| **JSON-RPC** | ✅ | ✅ |
| **HTTP+JSON/REST** | ✅ | ✅ |
| **GRPC** (Node.js only) | ✅ | ✅ |

## Quickstart

This example shows how to create a simple "Hello World" agent server and a client to interact with it.

### Server: Hello World Agent

The core of an A2A server is the `AgentExecutor`, which contains your agent's logic.

```typescript
// server.ts
import express from 'express';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard, Message, AGENT_CARD_PATH } from '@a2a-js/sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, restHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { grpcService, A2AService } from '@a2a-js/sdk/server/grpc';

// 1. Define your agent's identity card.
const helloAgentCard: AgentCard = {
  name: 'Hello Agent',
  description: 'A simple agent that says hello.',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: 'http://localhost:4000/a2a/jsonrpc', // The public URL of your agent server
  skills: [{ id: 'chat', name: 'Chat', description: 'Say hello', tags: ['chat'] }],
  capabilities: {
    pushNotifications: false,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  additionalInterfaces: [
    { url: 'http://localhost:4000/a2a/jsonrpc', transport: 'JSONRPC' }, // Default JSON-RPC transport
    { url: 'http://localhost:4000/a2a/rest', transport: 'HTTP+JSON' }, // HTTP+JSON/REST transport
    { url: 'localhost:4001', transport: 'GRPC' }, // GRPC transport
  ],
};

// 2. Implement the agent's logic.
class HelloExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    // Create a direct message response.
    const responseMessage: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello, world!' }],
      // Associate the response with the incoming request's context.
      contextId: requestContext.contextId,
    };

    // Publish the message and signal that the interaction is finished.
    eventBus.publish(responseMessage);
    eventBus.finished();
  }

  // cancelTask is not needed for this simple, non-stateful agent.
  cancelTask = async (): Promise<void> => {};
}

// 3. Set up and run the server.
const agentExecutor = new HelloExecutor();
const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  agentExecutor
);

const app = express();

app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

app.listen(4000, () => {
  console.log(`🚀 Server started on http://localhost:4000`);
});

const server = new Server();
server.addService(A2AService, grpcService({
  requestHandler,
  userBuilder: UserBuilder.noAuthentication,
}));
server.bindAsync(`localhost:4001`, ServerCredentials.createInsecure(), () => {
  console.log(`🚀 Server started on localhost:4001`);
});
```

### Client: Sending a Message

The [`ClientFactory`](src/client/factory.ts) makes it easy to communicate with any A2A-compliant agent.

```typescript
// client.ts
import { ClientFactory } from '@a2a-js/sdk/client';
import { Message, MessageSendParams, SendMessageSuccessResponse } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';

async function run() {
  const factory = new ClientFactory();

  // createFromUrl accepts baseUrl and optional path,
  // (the default path is /.well-known/agent-card.json)
  const client = await factory.createFromUrl('http://localhost:4000');

  const sendParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'Hi there!' }],
      kind: 'message',
    },
  };

  try {
    const response = await client.sendMessage(sendParams);
    const result = response as Message;
    console.log('Agent response:', result.parts[0].text); // "Hello, world!"
  } catch(e) {
    console.error('Error:', e);
  }
}

await run();
```

### gRPC Client: Sending a Message

The [`ClientFactory`](src/client/factory.ts) has to be created explicitly passing the [`GrpcTransportFactory`](src/client/transports/grpc/grpc_transport.ts).

```typescript
// client.ts
import { ClientFactory, ClientFactoryOptions } from '@a2a-js/sdk/client';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';
import { Message, MessageSendParams, SendMessageSuccessResponse } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';

async function run() {
  const factory = new ClientFactory({
    transports: [new GrpcTransportFactory()]
  });

  // createFromUrl accepts baseUrl and optional path,
  // (the default path is /.well-known/agent-card.json)
  const client = await factory.createFromUrl('http://localhost:4000');

  const sendParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'Hi there!' }],
      kind: 'message',
    },
  };

  try {
    const response = await client.sendMessage(sendParams);
    const result = response as Message;
    console.log('Agent response:', result.parts[0].text); // "Hello, world!"
  } catch(e) {
    console.error('Error:', e);
  }
}

await run();
```
---

## A2A `Task` Support

For operations that are stateful or long-running, agents create a `Task`. A task has a state (e.g., `working`, `completed`) and can produce `Artifacts` (e.g., files, data).

### Server: Creating a Task

This agent creates a task, attaches a file artifact to it, and marks it as complete.

```typescript
// server.ts
import { Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@a2a-js/sdk';
// ... other imports from the quickstart server ...

class TaskExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage, task } = requestContext;

    // 1. Create and publish the initial task object if it doesn't exist.
    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
      };
      eventBus.publish(initialTask);
    }

    // 2. Create and publish an artifact.
    const artifactUpdate: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId: taskId,
      contextId: contextId,
      artifact: {
        artifactId: 'report-1',
        name: 'analysis_report.txt',
        parts: [{ kind: 'text', text: `This is the analysis for task ${taskId}.` }],
      },
    };
    eventBus.publish(artifactUpdate);

    // 3. Publish the final status and mark the event as 'final'.
    const finalUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() },
      final: true,
    };
    eventBus.publish(finalUpdate);
    eventBus.finished();
  }

  cancelTask = async (): Promise<void> => {};
}
```

### Client: Receiving a Task

The client sends a message and receives a `Task` object as the result.

```typescript
// client.ts
import { ClientFactory } from '@a2a-js/sdk/client';
import { Message, MessageSendParams, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';
// ... other imports ...

const factory = new ClientFactory();

// createFromUrl accepts baseUrl and optional path,
// (the default path is /.well-known/agent-card.json)
const client = await factory.createFromUrl('http://localhost:4000');

try {
  const result = await client.sendMessage({
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'Do something.' }],
      kind: 'message',
    },
  });

  // Check if the agent's response is a Task or a direct Message.
  if (result.kind === 'task') {
    const task = result as Task;
    console.log(`Task [${task.id}] completed with status: ${task.status.state}`);

    if (task.artifacts && task.artifacts.length > 0) {
      console.log(`Artifact found: ${task.artifacts[0].name}`);
      console.log(`Content: ${task.artifacts[0].parts[0].text}`);
    }
  } else {
    const message = result as Message;
    console.log('Received direct message:', message.parts[0].text);
  }
} catch (e) {
  console.error('Error:', e);
}
```

---

## Client Customization

Client can be customized via [`CallInterceptor`'s](src/client/interceptors.ts) which is a recommended way as it's transport-agnostic.

Common use cases include:

- **Request Interception**: Log outgoing requests or collect metrics.
- **Header Injection**: Add custom headers for authentication, tracing, or routing.
- **A2A Extensions**: Modifying payloads to include protocol extension data.

### Example: Injecting a Custom Header

This example defines a `CallInterceptor` to update `serviceParameters` which are passed as HTTP headers.

```typescript
import { v4 as uuidv4 } from 'uuid';
import { AfterArgs, BeforeArgs, CallInterceptor, ClientFactory, ClientFactoryOptions } from '@a2a-js/sdk/client';

// 1. Define an interceptor
class RequestIdInterceptor implements CallInterceptor {
  before(args: BeforeArgs): Promise<void> {
    args.options = {
      ...args.options,
      serviceParameters: {
        ...args.options.serviceParameters,
        ['X-Request-ID']: uuidv4(),
      },
    };
    return Promise.resolve();
  }

  after(): Promise<void> {
    return Promise.resolve();
  }
}

// 2. Register the interceptor in the client factory
const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  clientConfig: {
    interceptors: [new RequestIdInterceptor()]
  }
}))
const client = await factory.createFromAgentCardUrl('http://localhost:4000');

// Now, all requests made by clients created by this factory will include the X-Request-ID header.
await client.sendMessage({
  message: {
    messageId: uuidv4(),
    role: 'user',
    parts: [{ kind: 'text', text: 'A message requiring custom headers.' }],
    kind: 'message',
  },
});
```

### Example: Specifying a Timeout

Each client method can be configured with an optional `signal` field.

```typescript
import { ClientFactory } from '@a2a-js/sdk/client';

const factory = new ClientFactory();

// createFromUrl accepts baseUrl and optional path,
// (the default path is /.well-known/agent-card.json)
const client = await factory.createFromUrl('http://localhost:4000');

await client.sendMessage(
  {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'A long-running message.' }],
      kind: 'message',
    },
  },
  {
    signal: AbortSignal.timeout(5000), // 5 seconds timeout
  }
);
```

### Customizing Transports: Using the Provided `AuthenticationHandler`

For advanced authentication scenarios, the SDK includes a higher-order function `createAuthenticatingFetchWithRetry` and an `AuthenticationHandler` interface. This utility automatically adds authorization headers and can retry requests that fail with authentication errors (e.g., 401 Unauthorized).

Here's how to use it to manage a Bearer token:

```typescript
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
  AuthenticationHandler,
  createAuthenticatingFetchWithRetry,
} from '@a2a-js/sdk/client';

// A simple token provider that simulates fetching a new token.
const tokenProvider = {
  token: 'initial-stale-token',
  getNewToken: async () => {
    console.log('Refreshing auth token...');
    tokenProvider.token = `new-token-${Date.now()}`;
    return tokenProvider.token;
  },
};

// 1. Implement the AuthenticationHandler interface.
const handler: AuthenticationHandler = {
  // headers() is called on every request to get the current auth headers.
  headers: async () => ({
    Authorization: `Bearer ${tokenProvider.token}`,
  }),

  // shouldRetryWithHeaders() is called after a request fails.
  // It decides if a retry is needed and provides new headers.
  shouldRetryWithHeaders: async (req: RequestInit, res: Response) => {
    if (res.status === 401) {
      // Unauthorized
      const newToken = await tokenProvider.getNewToken();
      // Return new headers to trigger a single retry.
      return { Authorization: `Bearer ${newToken}` };
    }

    // Return undefined to not retry for other errors.
    return undefined;
  },
};

// 2. Create the authenticated fetch function.
const authFetch = createAuthenticatingFetchWithRetry(fetch, handler);

// 3. Inject new fetch implementation into a client factory.
const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  transports: [
    new JsonRpcTransportFactory({ fetchImpl: authFetch })
  ]
}))

// 4. Clients created from the factory are going to have custom fetch attached.
const client = await factory.createFromUrl('http://localhost:4000');
```

---

## Streaming

For real-time updates, A2A supports streaming responses over Server-Sent Events (SSE).

### Server: Streaming Task Updates

The agent publishes events as it works on the task. The client receives these events in real-time.

```typescript
// server.ts
// ... imports ...

class StreamingExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage, task } = requestContext;

    // 1. Create and publish the initial task object if it doesn't exist.
    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish 'working' state.
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      final: false,
    });

    // 3. Simulate work and publish an artifact.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    eventBus.publish({
      kind: 'artifact-update',
      taskId,
      contextId,
      artifact: { artifactId: 'result.txt', parts: [{ kind: 'text', text: 'First result.' }] },
    });

    // 4. Publish final 'completed' state.
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() },
      final: true,
    });
    eventBus.finished();
  }
  cancelTask = async (): Promise<void> => {};
}
```

### Client: Consuming a Stream

The `sendMessageStream` method returns an `AsyncGenerator` that yields events as they arrive from the server.

```typescript
// client.ts
import { ClientFactory } from '@a2a-js/sdk/client';
import { MessageSendParams } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';
// ... other imports ...

const factory = new ClientFactory();

// createFromUrl accepts baseUrl and optional path,
// (the default path is /.well-known/agent-card.json)
const client = await factory.createFromUrl('http://localhost:4000');

async function streamTask() {
  const streamParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: 'Stream me some updates!' }],
      kind: 'message',
    },
  };

  try {
    const stream = client.sendMessageStream(streamParams);

    for await (const event of stream) {
      if (event.kind === 'task') {
        console.log(`[${event.id}] Task created. Status: ${event.status.state}`);
      } else if (event.kind === 'status-update') {
        console.log(`[${event.taskId}] Status Updated: ${event.status.state}`);
      } else if (event.kind === 'artifact-update') {
        console.log(`[${event.taskId}] Artifact Received: ${event.artifact.artifactId}`);
      }
    }
    console.log('--- Stream finished ---');
  } catch (error) {
    console.error('Error during streaming:', error);
  }
}

await streamTask();
```

## Handling Task Cancellation

To support user-initiated cancellations, you must implement the `cancelTask` method in your **`AgentExecutor`**. The executor is responsible for gracefully stopping the ongoing work and publishing a final `canceled` status event.

A straightforward way to manage this is by maintaining an in-memory set of canceled task IDs. The `execute` method can then periodically check this set to see if it should terminate its process.

### Server: Implementing a Cancellable Executor

This example demonstrates an agent that simulates a multi-step process. In each step of its work, it checks if a cancellation has been requested. If so, it stops the work and updates the task's state accordingly.

```typescript
// server.ts
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk/server';
// ... other imports ...

class CancellableExecutor implements AgentExecutor {
  // Use a Set to track the IDs of tasks that have been requested to be canceled.
  private cancelledTasks = new Set<string>();

  /**
   * When a cancellation is requested, add the taskId to our tracking set.
   * The `execute` loop will handle the rest.
   */
  public async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`[Executor] Received cancellation request for task: ${taskId}`);
    this.cancelledTasks.add(taskId);
  }

  public async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;

    // Start the task
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      final: false,
    });

    // Simulate a multi-step, long-running process
    for (let i = 0; i < 5; i++) {
      // **Cancellation Checkpoint**
      // Before each step, check if the task has been canceled.
      if (this.cancelledTasks.has(taskId)) {
        console.log(`[Executor] Aborting task ${taskId} due to cancellation.`);

        // Publish the final 'canceled' status.
        const cancelledUpdate: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: taskId,
          contextId: contextId,
          status: { state: 'canceled', timestamp: new Date().toISOString() },
          final: true,
        };
        eventBus.publish(cancelledUpdate);
        eventBus.finished();

        // Clean up and exit.
        this.cancelledTasks.delete(taskId);
        return;
      }

      // Simulate one step of work.
      console.log(`[Executor] Working on step ${i + 1} for task ${taskId}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`[Executor] Task ${taskId} finished all steps without cancellation.`);

    // If not canceled, finish the work and publish the completed state.
    const finalUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() },
      final: true,
    };
    eventBus.publish(finalUpdate);
    eventBus.finished();
  }
}
```

## A2A Push Notifications

For very long-running tasks (e.g., lasting minutes, hours, or even days) or when clients cannot or prefer not to maintain persistent connections (like mobile clients or serverless functions), A2A supports asynchronous updates via push notifications. This mechanism allows the A2A Server to actively notify a client-provided webhook when a significant task update occurs.

### Server-Side Configuration

To enable push notifications, your agent card must declare support:

```typescript
const movieAgentCard: AgentCard = {
  // ... other properties
  capabilities: {
    streaming: true,
    pushNotifications: true, // Enable push notifications
    stateTransitionHistory: true,
  },
  // ... rest of agent card
};
```

When creating the `DefaultRequestHandler`, you can optionally provide custom push notification components:

```typescript
import {
  DefaultRequestHandler,
  InMemoryPushNotificationStore,
  DefaultPushNotificationSender,
} from '@a2a-js/sdk/server';

// Optional: Custom push notification store and sender
const pushNotificationStore = new InMemoryPushNotificationStore();
const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore, {
  timeout: 5000, // 5 second timeout
  tokenHeaderName: 'X-A2A-Notification-Token', // Custom header name
});

const requestHandler = new DefaultRequestHandler(
  movieAgentCard,
  taskStore,
  agentExecutor,
  undefined, // eventBusManager (optional)
  pushNotificationStore, // custom store
  pushNotificationSender, // custom sender
  undefined // extendedAgentCard (optional)
);
```

### Client-Side Usage

Configure push notifications when sending messages:

```typescript
// Configure push notification for a message
const pushConfig: PushNotificationConfig = {
  id: 'my-notification-config', // Optional, defaults to task ID
  url: 'https://my-app.com/webhook/task-updates',
  token: 'your-auth-token', // Optional authentication token
};

const sendParams: MessageSendParams = {
  message: {
    messageId: uuidv4(),
    role: 'user',
    parts: [{ kind: 'text', text: 'Hello, agent!' }],
    kind: 'message',
  },
  configuration: {
    blocking: true,
    acceptedOutputModes: ['text/plain'],
    pushNotificationConfig: pushConfig, // Add push notification config
  },
};
```

### Webhook Endpoint Implementation

Your webhook endpoint should expect POST requests with the task data:

```typescript
// Example Express.js webhook endpoint
app.post('/webhook/task-updates', (req, res) => {
  const task = req.body; // The complete task object

  // Verify the token if provided
  const token = req.headers['x-a2a-notification-token'];
  if (token !== 'your-auth-token') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`Task ${task.id} status: ${task.status.state}`);

  // Process the task update
  // ...

  res.status(200).json({ received: true });
});
```

---

## Production-Grade: Persistent Store & Distributed Event Bus

By default the SDK ships with `InMemoryTaskStore` and `DefaultExecutionEventBusManager`, which are perfect for a single-process server. In a production deployment with multiple server instances behind a load balancer you need:

- **Persistent task state** — so any instance can serve a `tasks/get` request regardless of which instance originally handled the task.
- **Distributed SSE fan-out** — so a client that opens an SSE stream on Instance B receives events published by the executor running on Instance A.

The SDK ships three drop-in implementations for these scenarios.

### Installation

The distributed components are exported from the `@a2a-js/sdk/server/distributed` sub-path. The AWS SDK packages are declared as **optional peer dependencies** — they are not installed automatically with the base SDK so that single-instance deployments remain lightweight. Install them explicitly when using this sub-path:

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-sns @aws-sdk/client-sqs
```

### Infrastructure requirements

| Resource | Purpose |
| :--- | :--- |
| **DynamoDB table** | Persistent task storage. Partition key: `taskId` (String). Enable TTL on the `ttl` attribute (optional). Encrypt with a KMS CMK. |
| **SNS topic** | Cross-instance event fan-out. One topic shared by all instances. |
| **SQS queue per instance** | Created automatically by `QueueLifecycleManager` on instance boot; deleted on shutdown. No pre-provisioning required — the ECS task role needs the permissions listed below. |
| **Dead-letter queue (optional)** | Pre-created SQS queue for undeliverable messages. Pass its ARN as `dlqArn` to `QueueLifecycleManager`. |

#### Required IAM permissions for the ECS task role

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:CreateQueue",
    "sqs:DeleteQueue",
    "sqs:GetQueueAttributes",
    "sqs:SetQueueAttributes",
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sns:Subscribe",
    "sns:Unsubscribe",
    "sns:Publish"
  ],
  "Resource": "*"
}
```

> **Principle of least privilege**: scope `sqs:CreateQueue` / `sqs:DeleteQueue` to a resource pattern such as `arn:aws:sqs:*:*:a2a-*` and `sns:Publish` to your specific topic ARN.

### Queue lifecycle in ECS auto-scaling

The core operational challenge is that the auto-scaler controls how many ECS tasks are running at any moment. Pre-provisioning a fixed set of SQS queues does not work because:

- **Scale-out**: new tasks have no queue to receive SNS fan-out messages.
- **Scale-in**: terminated tasks leave queues permanently subscribed to SNS, wasting throughput and requiring manual cleanup.
- **Rolling update**: old task's queue is deleted, new task's queue is not created yet — there is a delivery gap.

`QueueLifecycleManager` solves this by treating the SQS queue as ephemeral process-local state:

```
ECS Task boot
     │
     ▼
QueueLifecycleManager.provision()
     ├─ SQS.CreateQueue("{prefix}-{instanceId}")
     ├─ SQS.GetQueueAttributes  → queueArn
     ├─ SQS.SetQueueAttributes  → SNS→SQS allow policy
     └─ SNS.Subscribe(protocol=sqs, endpoint=queueArn)
                │
                ▼
         SnsEventBusManager(instanceId, queueUrl)  ← start polling
                │
                ▼
         DefaultRequestHandler  ← ready to serve requests

ECS Task SIGTERM (graceful shutdown)
     │
     ▼
SnsEventBusManager.stop()         ← drain in-flight SQS messages
QueueLifecycleManager.teardown()
     ├─ SNS.Unsubscribe(subscriptionArn)
     └─ SQS.DeleteQueue(queueUrl)
```

**Crash / OOM / SIGKILL safety** — if the process exits without calling `teardown()`, the orphaned queue's messages expire after `messageRetentionPeriod` seconds (default 5 min). AWS auto-disables the SNS subscription once it detects the queue is unreachable. For production, schedule a periodic Lambda to sweep queues tagged `ManagedBy=a2a-server` whose heartbeat is stale.

### Server: Distributed Hello World Agent

This example wires `QueueLifecycleManager`, `DynamoDBTaskStore` and `SnsEventBusManager` into the standard `DefaultRequestHandler`, replacing the in-memory defaults with no changes required to the `AgentExecutor` logic.

```typescript
// server.ts
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard, Message, AGENT_CARD_PATH } from '@a2a-js/sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

// ── Distributed components (part of @a2a-js/sdk — optional peer deps required) ──
import {
  DynamoDBTaskStore,
  QueueLifecycleManager,
  SnsEventBusManager,
} from '@a2a-js/sdk/server/distributed';

// ── 1. Agent card ─────────────────────────────────────────────────────────────
const agentCard: AgentCard = {
  name: 'Hello Agent (Distributed)',
  description: 'A simple agent backed by DynamoDB + SNS/SQS for multi-instance deployments.',
  protocolVersion: '0.3.0',
  version: '1.0.0',
  url: 'http://localhost:4000/a2a/jsonrpc',
  skills: [{ id: 'chat', name: 'Chat', description: 'Say hello', tags: ['chat'] }],
  capabilities: { streaming: true, pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};

// ── 2. Agent logic (unchanged from the single-instance version) ───────────────
class HelloExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const response: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello from a distributed agent!' }],
      contextId: requestContext.contextId,
    };
    eventBus.publish(response);
    eventBus.finished();
  }
  cancelTask = async (): Promise<void> => {};
}

// ── 3. AWS clients ─────────────────────────────────────────────────────────────
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const snsClient = new SNSClient({});
const sqsClient = new SQSClient({});

// ── 4. Persistent task store ──────────────────────────────────────────────────
const taskStore = new DynamoDBTaskStore({
  client: dynamoClient,
  tableName: process.env.DYNAMODB_TABLE_NAME ?? 'a2a-tasks',
  taskTtlSeconds: 86_400,
  maxConflictRetries: 3,
});

// ── 5. Per-instance queue lifecycle ──────────────────────────────────────────
// QueueLifecycleManager creates a dedicated SQS queue on boot and destroys it
// on shutdown.  No pre-provisioned queues are required.
const queueLifecycle = new QueueLifecycleManager({
  snsTopicArn: process.env.SNS_TOPIC_ARN!,
  queueNamePrefix: process.env.QUEUE_NAME_PREFIX ?? 'a2a',
  messageRetentionPeriod: 300,  // 5 min crash-safety window
  visibilityTimeout: 30,
  dlqArn: process.env.SQS_DLQ_ARN,          // optional
  serviceName: process.env.SERVICE_NAME ?? 'a2a-server',
  sqsClient,
  snsClient,
});

// ── 6. Bootstrap: provision queue BEFORE initialising the request handler ────
// provision() is async — await it before constructing DefaultRequestHandler.
// The returned instanceId is the single source of truth for this process's
// identity and MUST be passed to SnsEventBusManager.
const { queueUrl, instanceId } = await queueLifecycle.provision();

// ── 7. Distributed event bus manager ─────────────────────────────────────────
const eventBusManager = new SnsEventBusManager({
  snsTopicArn: process.env.SNS_TOPIC_ARN!,
  sqsQueueUrl: queueUrl,  // ← URL of the queue just created above
  instanceId,             // ← same identity as QueueLifecycleManager (critical for dedup)
  snsClient,
  sqsClient,
  pollIntervalMs: 500,
  waitTimeSeconds: 5,
  maxMessages: 10,
});
eventBusManager.start();

// ── 8. Request handler ────────────────────────────────────────────────────────
const requestHandler = new DefaultRequestHandler(
  agentCard,
  taskStore,
  new HelloExecutor(),
  eventBusManager,
);

// ── 9. Express server ─────────────────────────────────────────────────────────
const app = express();
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
app.use('/a2a/rest',    restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

const httpServer = app.listen(4000, () => {
  console.log(`Agent started | instanceId=${instanceId} | queue=${queueUrl}`);
});

// ── 10. Graceful shutdown ─────────────────────────────────────────────────────
// ECS sends SIGTERM and waits `stopTimeout` seconds before SIGKILL.
// Use that window to drain in-flight events and clean up AWS resources.
process.on('SIGTERM', async () => {
  eventBusManager.stop();          // stop polling; in-flight messages re-queue
  await queueLifecycle.teardown(); // unsubscribe from SNS + delete SQS queue
  httpServer.close(() => process.exit(0));
});
```

### How the pieces connect

```
ECS Task (boot)
      │
      ▼
QueueLifecycleManager.provision()
      │  CreateQueue("{prefix}-{instanceId}") + SetQueueAttributes + Subscribe
      ▼
SnsEventBusManager(instanceId, queueUrl)  ← start() begins long-polling
      │
      ▼
DefaultRequestHandler
   ├── DynamoDBTaskStore    ← persists Task objects (survives instance restarts)
   ├── HelloExecutor        ← your AgentExecutor, no changes required
   └── SnsEventBusManager
            │
            ├─ createOrGetByTaskId(taskId)
            │       └─ DistributedExecutionEventBus
            │              ├─ publish(event)  → local SSE   (synchronous)
            │              └─ publish(event)  → SNS.publish (fire-and-forget)
            │                                       │ fan-out
            │                          ┌────────────┴────────────┐
            │               SQS Queue (Instance A)     SQS Queue (Instance B)
            │               auto-created by A           auto-created by B
            │                          │                         │
            └─ SqsPoller A             │             SqsPoller B
                 (skips own instanceId)│                   │
                 discards ─────────────┘           publishLocal(event)
                                                         │
                                                 SSE clients on B

ECS Task (SIGTERM)
      │
      ├─ SnsEventBusManager.stop()
      └─ QueueLifecycleManager.teardown()
               │  Unsubscribe + DeleteQueue
               ▼
          (no orphaned queues or subscriptions)
```

### Environment variables

| Variable | Description |
| :--- | :--- |
| `DYNAMODB_TABLE_NAME` | DynamoDB table name (default: `a2a-tasks`). |
| `SNS_TOPIC_ARN` | ARN of the SNS topic used for cross-instance fan-out. |
| `QUEUE_NAME_PREFIX` | Prefix for the auto-created SQS queue (default: `a2a`). Final name: `{prefix}-{instanceId}`. |
| `SQS_DLQ_ARN` | *(Optional)* ARN of a pre-created dead-letter queue for undeliverable messages. |
| `SERVICE_NAME` | *(Optional)* Service name added as a `ServiceName` tag to the queue for cost-allocation and cleanup automation. |

### DynamoDBTaskStore — key behaviours

`DynamoDBTaskStore` implements the `TaskStore` interface identically to `InMemoryTaskStore`, so it is a transparent drop-in replacement.

**Optimistic locking** — every `save()` reads the current `version` attribute, then issues a conditional `PutItem`. If another instance updated the same task concurrently the condition fails and the write is retried with exponential back-off and full jitter up to `maxConflictRetries` times. On persistent conflict a `TaskConflictError` is thrown (non-retryable); on infrastructure failures a `StoreUnavailableError` is thrown (retryable).

**Consistent reads** — `load()` always uses `ConsistentRead: true` so the latest committed state is always visible, which is important when a `getTask` request follows a `sendMessage` request to the same instance.

**TTL** — when `taskTtlSeconds` is configured each item's `ttl` attribute is set to `now + taskTtlSeconds`. Enable the DynamoDB TTL feature on the `ttl` attribute via your CDK/CloudFormation stack to automatically purge expired tasks without application-level cleanup.

### QueueLifecycleManager — key behaviours

`QueueLifecycleManager` is responsible for the entire lifecycle of the per-instance SQS queue. It is intentionally separated from `SnsEventBusManager` so that the two concerns — *queue existence* and *message routing* — are independently testable and replaceable.

**Idempotent provision** — calling `provision()` a second time returns the cached `QueueProvisionResult` without contacting AWS, making it safe to call in retried bootstrap sequences.

**Atomic instanceId** — `QueueLifecycleManager` generates a single `instanceId` UUID on construction. This same ID is embedded in the queue name (`{prefix}-{instanceId}`) and must be passed as `instanceId` to `SnsEventBusManager`. Sharing one UUID is what makes the deduplication logic in `SqsEventPoller` correct.

**Rollback on partial failure** — if `SNS.Subscribe` fails after the queue is already created, `provision()` deletes the queue before re-throwing the error, leaving no orphaned resources.

**Best-effort unsubscribe** — `teardown()` attempts `SNS.Unsubscribe` first but continues to `SQS.DeleteQueue` even if the call fails. Once the queue is deleted the subscription becomes unreachable and AWS auto-disables it.

**Crash safety** — set `messageRetentionPeriod` to cover your worst-case rolling deployment window (default: 300 s). Tag-based garbage collection (`ManagedBy=a2a-server`, `ServiceName`) can be implemented as a periodic Lambda sweep.

### SnsEventBusManager — key behaviours

`SnsEventBusManager` implements the `ExecutionEventBusManager` interface, making it a drop-in replacement for `DefaultExecutionEventBusManager`.

**Immediate local delivery** — `publish()` calls the parent `DefaultExecutionEventBus.publish()` first, so SSE clients on the same instance receive events with zero additional latency.

**Fire-and-forget SNS** — the SNS publish is asynchronous and does not block the executor. A failed SNS publish is logged as a structured error but does not crash the executor. Configure an SNS dead-letter queue at the infrastructure level for guaranteed delivery.

**Instance deduplication** — the `instanceId` injected from `QueueLifecycleManager` is embedded in every SNS message. The `SqsEventPoller` discards messages whose `instanceId` matches the local instance, preventing same-instance double-delivery. Passing a mismatched `instanceId` would cause every message to be delivered twice locally.

**SSE client on a different instance** — when a client connects for `tasks/resubscribe` on Instance B before any events arrive, `createOrGetByTaskId` creates a local `DistributedExecutionEventBus`. As events arrive via SQS the poller calls `publishLocal()` on that bus, delivering them directly to the waiting SSE generator.

## License

This project is licensed under the terms of the [Apache 2.0 License](https://raw.githubusercontent.com/google-a2a/a2a-python/refs/heads/main/LICENSE).

## Contributing

See [CONTRIBUTING.md](https://github.com/google-a2a/a2a-js/blob/main/CONTRIBUTING.md) for contribution guidelines.
