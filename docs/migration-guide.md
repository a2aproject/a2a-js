# Migration Guide: @a2a-js/sdk v0.3 to v1.0

This guide covers all breaking changes in the `@a2a-js/sdk` when upgrading from
v0.3 (A2A Protocol 0.3.0) to v1.0 (A2A Protocol 1.0.0). Changes are grouped by
area and ordered by impact.

For background on what changed in the protocol itself, see the official
[What's New in v1.0](https://a2a-protocol.org/latest/whats-new-v1/) document and
the [A2A Protocol v1.0 Specification](https://a2a-protocol.org/latest/specification/).

## Prerequisites

- **Node.js >= 20** is now required (v0.3 supported Node 18).
- Install the latest SDK: `npm install @a2a-js/sdk@latest`

---

## Table of Contents

1. [Data Model Changes (CRITICAL)](#1-data-model-changes-critical)
2. [Client-Side Changes (HIGH)](#2-client-side-changes-high)
3. [Server-Side Changes (HIGH)](#3-server-side-changes-high)
4. [New Features](#4-new-features)
5. [Import Path Changes](#5-quick-reference-import-path-changes)
6. [Migration Checklist](#6-migration-checklist)

---

## 1. Data Model Changes (CRITICAL)

The entire type system has been replaced. The JSON-Schema-generated types in
`src/types.ts` (60+ types) have been **deleted**. All types now come from
protobuf-generated definitions in `src/types/pb/a2a.ts`.

### 1.1 Part Types -- Complete Redesign

The separate `TextPart`, `FilePart`, and `DataPart` types with a `kind`
discriminator are gone. There is now a single unified `Part` type.

```typescript
// v0.3 -- discriminated union with kind
import { TextPart, FilePart, DataPart, Part } from '@a2a-js/sdk';

const text: TextPart = { kind: 'text', text: 'Hello', metadata: {} };
const file: FilePart = {
  kind: 'file',
  file: { uri: 'https://...', mimeType: 'image/png', name: 'photo.png' },
};
const data: DataPart = { kind: 'data', data: { key: 'value' } };

// Discriminating:
if (part.kind === 'text') {
  console.log(part.text);
} else if (part.kind === 'file') {
  /* ... */
} else if (part.kind === 'data') {
  /* ... */
}
```

```typescript
// v1.0 -- unified Part with content oneof
import { Part } from '@a2a-js/sdk';

const text: Part = {
  content: { $case: 'text', value: 'Hello' },
  metadata: undefined,
  filename: '',
  mediaType: 'text/plain',
};
const file: Part = {
  content: { $case: 'url', value: 'https://...' },
  metadata: undefined,
  filename: 'photo.png',
  mediaType: 'image/png',
};
const raw: Part = {
  content: { $case: 'raw', value: Buffer.from('...') },
  metadata: undefined,
  filename: 'file.bin',
  mediaType: 'application/octet-stream',
};
const data: Part = {
  content: { $case: 'data', value: { key: 'value' } },
  metadata: undefined,
  filename: '',
  mediaType: 'application/json',
};

// Discriminating:
switch (part.content?.$case) {
  case 'text':
    console.log(part.content.value);
    break;
  case 'url' /* file by URL */:
    break;
  case 'raw' /* file by bytes */:
    break;
  case 'data' /* structured data */:
    break;
}
```

**Key field renames:**

| v0.3                     | v1.0                               |
| ------------------------ | ---------------------------------- |
| `FilePart.file.mimeType` | `Part.mediaType`                   |
| `FilePart.file.name`     | `Part.filename`                    |
| `FilePart.file.uri`      | `Part.content` with `$case: 'url'` |
| `FilePart.file.bytes`    | `Part.content` with `$case: 'raw'` |

### 1.2 `kind` Discriminator Removed from All Types

The `kind` field has been removed from the raw `Message`, `Task`,
`TaskStatusUpdateEvent`, and `TaskArtifactUpdateEvent` types. The SDK provides
two typed wrappers that replace `kind`-based discrimination:

- **Client side:** `StreamResponse` -- use `payload.$case` (see [Section 2.4](#24-streaming-return-type-streamresponse))
- **Server side:** `AgentExecutionEvent` -- use `event.kind` on the wrapper (see [Section 3.5](#35-executioneventbus----discriminated-event-wrapper))

```typescript
// v0.3 -- kind was on the raw object itself
if (event.kind === 'message') {
  /* Message */
}
if (event.kind === 'task') {
  /* Task */
}
if (event.kind === 'status-update') {
  /* TaskStatusUpdateEvent */
}
if (event.kind === 'artifact-update') {
  /* TaskArtifactUpdateEvent */
}

// v1.0 client -- use StreamResponse.payload.$case
switch (streamResponse.payload?.$case) {
  case 'message':
    /* streamResponse.payload.value is Message */ break;
  case 'task':
    /* streamResponse.payload.value is Task */ break;
  case 'statusUpdate':
    /* streamResponse.payload.value is TaskStatusUpdateEvent */ break;
  case 'artifactUpdate':
    /* streamResponse.payload.value is TaskArtifactUpdateEvent */ break;
}

// v1.0 server -- use AgentExecutionEvent.kind (on the wrapper, not the raw object)
import { AgentEvent, type AgentExecutionEvent } from '@a2a-js/sdk/server';

switch (event.kind) {
  case 'message':
    /* event.data is Message */ break;
  case 'task':
    /* event.data is Task */ break;
  case 'statusUpdate':
    /* event.data is TaskStatusUpdateEvent */ break;
  case 'artifactUpdate':
    /* event.data is TaskArtifactUpdateEvent */ break;
}
```

### 1.3 Enum Changes

All enums changed from lowercase/kebab-case strings to `SCREAMING_SNAKE_CASE`
numeric enums:

```typescript
// v0.3 -- string values
task.status.state === 'completed';
task.status.state === 'input-required';
message.role === 'user';

// v1.0 -- numeric enum values
import { TaskState, Role } from '@a2a-js/sdk';

task.status.state === TaskState.TASK_STATE_COMPLETED; // numeric 3
task.status.state === TaskState.TASK_STATE_INPUT_REQUIRED; // numeric 6
message.role === Role.ROLE_USER; // numeric 1
```

**Full TaskState mapping:**

| v0.3 string        | v1.0 enum                             |
| ------------------ | ------------------------------------- |
| `"submitted"`      | `TaskState.TASK_STATE_SUBMITTED`      |
| `"working"`        | `TaskState.TASK_STATE_WORKING`        |
| `"completed"`      | `TaskState.TASK_STATE_COMPLETED`      |
| `"failed"`         | `TaskState.TASK_STATE_FAILED`         |
| `"canceled"`       | `TaskState.TASK_STATE_CANCELED`       |
| `"rejected"`       | `TaskState.TASK_STATE_REJECTED`       |
| `"input-required"` | `TaskState.TASK_STATE_INPUT_REQUIRED` |
| `"auth-required"`  | `TaskState.TASK_STATE_AUTH_REQUIRED`  |

**Role mapping:**

| v0.3 string | v1.0 enum         |
| ----------- | ----------------- |
| `"user"`    | `Role.ROLE_USER`  |
| `"agent"`   | `Role.ROLE_AGENT` |

### 1.4 Message Type Changes

```typescript
// v0.3
const msg: Message = {
  kind: 'message', // REMOVED in v1.0
  messageId: 'abc',
  role: 'user', // now Role.ROLE_USER
  parts: [{ kind: 'text', text: 'Hello' }],
  contextId: undefined, // was optional, now defaults to ''
  taskId: undefined, // was optional, now defaults to ''
  extensions: undefined, // was optional, now defaults to []
};

// v1.0
const msg: Message = {
  messageId: 'abc',
  role: Role.ROLE_USER,
  parts: [
    {
      content: { $case: 'text', value: 'Hello' },
      mediaType: 'text/plain',
      filename: '',
      metadata: undefined,
    },
  ],
  contextId: '',
  taskId: '',
  extensions: [],
  referenceTaskIds: [],
  metadata: undefined,
};
```

### 1.5 AgentCard Structure Overhaul

```typescript
// v0.3
const card: AgentCard = {
  url: 'https://agent.example.com/a2a',
  preferredTransport: 'JSONRPC',
  protocolVersion: '0.3',
  additionalInterfaces: [{ transport: 'HTTP+JSON', url: 'https://agent.example.com/rest' }],
  supportsAuthenticatedExtendedCard: true,
  security: [{ myScheme: ['read'] }],
  capabilities: {
    streaming: true,
    pushNotifications: true,
    stateTransitionHistory: true,
    extensions: [],
  },
  // ...
};

// v1.0 -- url, preferredTransport, additionalInterfaces, protocolVersion
// are all replaced by supportedInterfaces
const card: AgentCard = {
  supportedInterfaces: [
    {
      url: 'https://agent.example.com/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
      tenant: '',
    },
    {
      url: 'https://agent.example.com/rest',
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
      tenant: '',
    },
  ],
  capabilities: {
    streaming: true,
    pushNotifications: true,
    extendedAgentCard: true, // replaces supportsAuthenticatedExtendedCard
    extensions: [],
  },
  securityRequirements: [
    /* replaces security */
  ],
  // ...
};
```

**Removed fields:** `url`, `preferredTransport`, `additionalInterfaces`,
`protocolVersion`, `supportsAuthenticatedExtendedCard`, `security`,
`AgentCapabilities.stateTransitionHistory`

**Added fields:** `supportedInterfaces`, `capabilities.extendedAgentCard`

**Renamed:**

| v0.3                                          | v1.0                                       |
| --------------------------------------------- | ------------------------------------------ |
| `AgentInterface.transport`                    | `AgentInterface.protocolBinding`           |
| `AgentCard.security`                          | `AgentCard.securityRequirements`           |
| `AgentCard.supportsAuthenticatedExtendedCard` | `AgentCard.capabilities.extendedAgentCard` |

### 1.6 PushNotificationConfig -- Flattened

```typescript
// v0.3 -- nested structure
const config: TaskPushNotificationConfig = {
  taskId: 'task-1',
  pushNotificationConfig: {
    url: 'https://webhook.example.com',
    token: 'secret-token',
    authentication: {
      schemes: ['bearer'], // plural array
      credentials: 'my-token',
    },
  },
};

// v1.0 -- flat structure
const config: TaskPushNotificationConfig = {
  taskId: 'task-1',
  id: 'config-1',
  url: 'https://webhook.example.com',
  token: 'secret-token',
  tenant: '',
  authentication: {
    scheme: 'bearer', // singular string
    credentials: 'my-token',
  },
};
```

Key changes:

- `PushNotificationConfig` as a separate type is **removed** -- all fields are
  inlined into `TaskPushNotificationConfig`.
- `AuthenticationInfo.schemes: string[]` changed to `AuthenticationInfo.scheme: string`
  (plural array to singular string).
- The `name` field (resource name pattern `tasks/{id}/pushNotificationConfigs/{id}`)
  is **removed** -- replaced with explicit `taskId` and `id` fields.
- `tenant` field **added**.

### 1.7 SendMessageConfiguration Changes

```typescript
// v0.3
const config: MessageSendConfiguration = {
  blocking: true, // renamed + inverted
  pushNotificationConfig: {
    /* ... */
  }, // renamed
  historyLength: 0, // 0 meant "unlimited"
};

// v1.0
const config: SendMessageConfiguration = {
  returnImmediately: false, // inverted: blocking=true => returnImmediately=false
  taskPushNotificationConfig: {
    /* ... */
  }, // renamed
  historyLength: undefined, // undefined = "no limit"; 0 = "no history"
  acceptedOutputModes: [],
};
```

> **Semantic inversion:** `blocking: true` (wait for result) is equivalent to
> `returnImmediately: false`. The boolean meaning is flipped.

### 1.8 Streaming Event Changes

- `TaskStatusUpdateEvent.final` has been **removed**. Stream closure now
  indicates completion.

### 1.9 Removed JSON-RPC Type Layer

All JSON-RPC envelope types from `src/types.ts` are removed:

- `A2ARequest`, `A2AResponse`, `JSONRPCResponse`, `JSONRPCErrorResponse`
- `SendMessageRequest`, `SendMessageSuccessResponse` (JSON-RPC versions)
- `GetTaskRequest`, `GetTaskSuccessResponse` (JSON-RPC versions)
- `MessageSendParams`, `TaskQueryParams`, `TaskIdParams`
- All `*SuccessResponse` types
- Individual error types (`JSONParseError`, `InvalidRequestError`, etc.)
- `TransportProtocol` type alias

The SDK now uses protobuf-based request types directly and returns unwrapped
domain objects.

### 1.10 OAuth 2.0 Security Updates

- `ImplicitOAuthFlow` and `PasswordOAuthFlow` are **deprecated**.
- `DeviceCodeOAuthFlow` is **added** (for CLI tools, IoT devices).
- `AuthorizationCodeOAuthFlow` gains a `pkceRequired: boolean` field.

---

## 2. Client-Side Changes (HIGH)

### 2.1 `A2AClient` Class Removed

The legacy `A2AClient` class (JSON-RPC only, returning JSON-RPC envelopes) is
fully removed.

```typescript
// v0.3
import { A2AClient } from '@a2a-js/sdk/client';
const client = new A2AClient(agentCard);
const response = await client.sendMessage(params);
// response is { jsonrpc: '2.0', id: 1, result: { ... } }

// v1.0 -- use ClientFactory + Client
import { ClientFactory } from '@a2a-js/sdk/client';
const factory = new ClientFactory();
const client = await factory.createFromAgentCard(agentCard);
// OR: const client = await factory.createFromUrl('https://agent.example.com');
const result = await client.sendMessage(request);
// result is directly Message | Task (no envelope)
```

### 2.2 Parameter Type Renames

All method parameter types changed from SDK-specific types to protobuf request
types:

| v0.3 Type                                | v1.0 Type                                 | Import from   |
| ---------------------------------------- | ----------------------------------------- | ------------- |
| `MessageSendParams`                      | `SendMessageRequest`                      | `@a2a-js/sdk` |
| `TaskQueryParams`                        | `GetTaskRequest`                          | `@a2a-js/sdk` |
| `TaskIdParams` (for cancel)              | `CancelTaskRequest`                       | `@a2a-js/sdk` |
| `TaskIdParams` (for resubscribe)         | `SubscribeToTaskRequest`                  | `@a2a-js/sdk` |
| `GetTaskPushNotificationConfigParams`    | `GetTaskPushNotificationConfigRequest`    | `@a2a-js/sdk` |
| `ListTaskPushNotificationConfigParams`   | `ListTaskPushNotificationConfigsRequest`  | `@a2a-js/sdk` |
| `DeleteTaskPushNotificationConfigParams` | `DeleteTaskPushNotificationConfigRequest` | `@a2a-js/sdk` |

### 2.3 Client Method Renames

```typescript
// v0.3
client.setTaskPushNotificationConfig(params);

// v1.0
client.createTaskPushNotificationConfig(params);
```

### 2.4 Streaming Return Type: `StreamResponse`

Streaming methods now return `AsyncGenerator<StreamResponse>` instead of
`AsyncGenerator<A2AStreamEventData>`.

```typescript
// v0.3
for await (const event of client.sendMessageStream(params)) {
  if (event.kind === 'message') {
    /* ... */
  } else if (event.kind === 'task') {
    /* ... */
  } else if (event.kind === 'status-update') {
    /* ... */
  } else if (event.kind === 'artifact-update') {
    /* ... */
  }
}

// v1.0
for await (const event of client.sendMessageStream(params)) {
  switch (event.payload?.$case) {
    case 'message':
      handleMessage(event.payload.value);
      break;
    case 'task':
      handleTask(event.payload.value);
      break;
    case 'statusUpdate':
      handleStatus(event.payload.value);
      break;
    case 'artifactUpdate':
      handleArtifact(event.payload.value);
      break;
  }
}
```

### 2.5 New `listTasks()` Method

```typescript
import { ListTasksRequest, TaskState } from '@a2a-js/sdk';

const response = await client.listTasks({
  contextId: 'my-context',
  status: TaskState.TASK_STATE_WORKING,
  pageSize: 50,
  pageToken: '',
  tenant: '',
});
// response: { tasks: Task[], nextPageToken: string, pageSize: number, totalSize: number }
```

### 2.6 Transport Interface Changes

If you implement a custom `Transport`:

- Add `get protocolName(): string` and `get protocolVersion(): string` properties.
- Rename `setTaskPushNotificationConfig` to `createTaskPushNotificationConfig`.
- Add `listTasks()` method.
- Update all parameter types per Section 2.2.
- Streaming methods must return `AsyncGenerator<StreamResponse>`.
- `getExtendedAgentCard()` now requires a `GetExtendedAgentCardRequest` as its
  first parameter.

### 2.7 Concrete Transports No Longer Exported

`JsonRpcTransport`, `RestTransport`, and their options types are no longer
public exports. Use the factory classes (`JsonRpcTransportFactory`,
`RestTransportFactory`) instead.

### 2.8 JSON-RPC Method Names (Wire Protocol)

If you interact with the wire protocol directly:

| v0.3                                  | v1.0                               |
| ------------------------------------- | ---------------------------------- |
| `message/send`                        | `SendMessage`                      |
| `message/stream`                      | `SendStreamingMessage`             |
| `tasks/get`                           | `GetTask`                          |
| `tasks/cancel`                        | `CancelTask`                       |
| `tasks/resubscribe`                   | `SubscribeToTask`                  |
| `tasks/pushNotificationConfig/set`    | `CreateTaskPushNotificationConfig` |
| `tasks/pushNotificationConfig/get`    | `GetTaskPushNotificationConfig`    |
| `tasks/pushNotificationConfig/list`   | `ListTaskPushNotificationConfigs`  |
| `tasks/pushNotificationConfig/delete` | `DeleteTaskPushNotificationConfig` |
| `agent/getAuthenticatedExtendedCard`  | `GetExtendedAgentCard`             |
| _(new)_                               | `ListTasks`                        |

### 2.9 Content-Type Change (REST)

REST requests/responses now use `application/a2a+json` instead of
`application/json`.

### 2.10 Extension Header Rename

```typescript
// v0.3: X-A2A-Extensions
// v1.0: A2A-Extensions
import { HTTP_EXTENSION_HEADER } from '@a2a-js/sdk';
// HTTP_EXTENSION_HEADER is now 'A2A-Extensions'
```

---

## 3. Server-Side Changes (HIGH)

### 3.1 `A2AExpressApp` Removed

```typescript
// v0.3
import { A2AExpressApp } from '@a2a-js/sdk/server/express';
const a2aApp = new A2AExpressApp(requestHandler, userBuilder);
a2aApp.setupRoutes(app, '/api');

// v1.0 -- use individual handler functions
import { jsonRpcHandler, restHandler, agentCardHandler } from '@a2a-js/sdk/server/express';

app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/', jsonRpcHandler({ requestHandler, userBuilder }));
app.use('/', restHandler({ requestHandler, userBuilder }));
```

### 3.2 Server-Side `A2AError` Class Removed

The monolithic `A2AError` class with static factory methods
(`A2AError.taskNotFound()`, etc.) from `src/server/error.ts` is gone.

```typescript
// v0.3
import { A2AError } from '@a2a-js/sdk/server';
throw A2AError.taskNotFound('task-1');
throw A2AError.invalidParams('bad input');
throw A2AError.internalError('unexpected');

// v1.0 -- use specific error classes
import {
  TaskNotFoundError,
  TaskNotCancelableError,
  RequestMalformedError,
  UnsupportedOperationError,
  PushNotificationNotSupportedError,
  ContentTypeNotSupportedError,
  ExtendedAgentCardNotConfiguredError,
  VersionNotSupportedError,
} from '@a2a-js/sdk/server';

throw new TaskNotFoundError('task-1');
throw new RequestMalformedError('bad input');
```

**Error rename:** `AuthenticatedExtendedCardNotConfiguredError` is now
`ExtendedAgentCardNotConfiguredError`.

### 3.3 `ServerCallContext` -- Now Mandatory + Constructor Change

`context` changed from optional (`context?: ServerCallContext`) to required
(`context: ServerCallContext`) on all interfaces: `A2ARequestHandler`,
`TaskStore`, `PushNotificationStore`, `PushNotificationSender`,
`ResultManager`, `RequestContext`, and `ExtendedAgentCardProvider`.

```typescript
// v0.3
new ServerCallContext(requestedExtensions, user);

// v1.0 -- options object pattern
new ServerCallContext({
  requestedExtensions,
  user,
  tenant: 'my-tenant', // NEW
  requestedVersion: '1.0', // NEW (defaults to '0.3' if absent)
});
```

### 3.4 `RequestContext` -- Parameter Reordering

```typescript
// v0.3
new RequestContext(userMessage, taskId, contextId, task, referenceTasks, context);
//                                                                       ^ last, optional

// v1.0
new RequestContext(userMessage, taskId, contextId, context, task, referenceTasks);
//                                                 ^ 4th, mandatory
```

### 3.5 `ExecutionEventBus` -- Discriminated Event Wrapper

This is the most impactful change for `AgentExecutor` implementors.

```typescript
// v0.3 -- publish raw objects
eventBus.publish(myTask);
eventBus.publish(myStatusUpdateEvent);
eventBus.publish(myMessage);

// v1.0 -- use AgentEvent factory
import { AgentEvent, assertUnreachableEvent } from '@a2a-js/sdk/server';

eventBus.publish(AgentEvent.task(myTask));
eventBus.publish(AgentEvent.statusUpdate(myStatusUpdate));
eventBus.publish(AgentEvent.message(myMessage));
eventBus.publish(AgentEvent.artifactUpdate(myArtifact));
```

When consuming events:

```typescript
// v0.3
eventBus.on('event', (event) => {
  if (event.kind === 'status-update') {
    /* ... */
  }
});

// v1.0
eventBus.on('event', (event) => {
  switch (event.kind) {
    case 'message':
      /* event.data is Message */
      break;
    case 'task':
      /* event.data is Task */
      break;
    case 'statusUpdate':
      /* event.data is TaskStatusUpdateEvent */
      break;
    case 'artifactUpdate':
      /* event.data is TaskArtifactUpdateEvent */
      break;
    default:
      assertUnreachableEvent(event); // exhaustiveness guard
  }
});
```

### 3.6 `TaskStore` Interface -- New `list()` Method + Mandatory Context

```typescript
// v0.3
interface TaskStore {
  save(task: Task, context?: ServerCallContext): Promise<void>;
  load(taskId: string, context?: ServerCallContext): Promise<Task | undefined>;
}

// v1.0
interface TaskStore {
  save(task: Task, context: ServerCallContext): Promise<void>;
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>; // NEW
}
```

If you have a custom `TaskStore`, you must implement `list()` with support for
filtering (`contextId`, `status`, `statusTimestampAfter`) and pagination
(`pageSize`, `pageToken`).

`InMemoryTaskStore` is now tenant-scoped internally using
`Map<tenant, Map<taskId, Task>>`.

### 3.7 `PushNotificationStore` -- Context Parameter Added

```typescript
// v0.3
store.save(taskId, config);
store.load(taskId);
store.delete(taskId, configId);

// v1.0 -- context is now the 2nd parameter
store.save(taskId, context, config);
store.load(taskId, context);
store.delete(taskId, context, configId);
```

The type also changed from `PushNotificationConfig` to
`TaskPushNotificationConfig`.

### 3.8 `PushNotificationSender` -- Signature Change

```typescript
// v0.3
interface PushNotificationSender {
  send(task: Task): Promise<void>;
}

// v1.0
interface PushNotificationSender {
  send(streamResponse: StreamResponse, context: ServerCallContext): Promise<void>;
}
```

Push notifications now send the full `StreamResponse` (not just a `Task`),
enabling notifications for status updates and artifact updates.

### 3.9 `A2ARequestHandler` Interface -- Method Renames and Types

All parameter types changed to protobuf request types (same mappings as
Section 2.2). Key renames:

- `setTaskPushNotificationConfig` -> `createTaskPushNotificationConfig`
- `getAuthenticatedExtendedAgentCard(context)` ->
  `getAuthenticatedExtendedAgentCard(params, context)` (added params)
- New: `listTasks(params, context)`
- Streaming methods return `AsyncGenerator<StreamResponse>` instead of raw type
  unions

### 3.10 `DefaultRequestHandler` Constructor -- New Parameter

```typescript
// v1.0 -- optional 8th parameter for agent card signing
new DefaultRequestHandler(
  agentCard,
  taskStore,
  agentExecutor,
  eventBusManager?,                // optional
  pushNotificationStore?,          // optional
  pushNotificationSender?,         // optional
  extendedAgentCardProvider?,      // optional
  agentCardSignatureGenerator?,    // NEW, optional
);
```

### 3.11 Agent Card Handler -- Caching Headers

`agentCardHandler` now supports caching configuration:

```typescript
agentCardHandler({
  agentCardProvider: requestHandler,
  cache: { maxAge: 3600 }, // NEW -- sets Cache-Control header
});
```

The handler also adds ETag headers and supports conditional `If-None-Match`
requests (304 responses).

### 3.12 REST Handler -- Tenant Routing and Version Validation

The REST handler now registers all routes with an optional `/:tenant/` prefix
for multi-tenant support:

```
GET  /tasks/:taskId           -- no tenant
GET  /:tenant/tasks/:taskId   -- tenant from path
```

Version validation is automatic: the handler extracts the `A2A-Version` header
and validates it against the agent card's `supportedInterfaces`.

REST error responses now use the `google.rpc.Status` JSON format:

```json
{
  "error": {
    "code": 404,
    "status": "NOT_FOUND",
    "message": "Task not found",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "TASK_NOT_FOUND",
        "domain": "a2a-protocol.org"
      }
    ]
  }
}
```

---

## 4. New Features

### 4.1 Version Negotiation

The SDK now sends `A2A-Version: 1.0` automatically on all client requests.
Servers validate the version against `agentCard.supportedInterfaces` and reject
unsupported versions with `VersionNotSupportedError`.

```typescript
// Server-side: version validation is automatic in DefaultRequestHandler
// Client-side: version header is automatic in Client

// Access version:
client.protocolVersion; // '1.0'
```

New constants:

- `A2A_VERSION_HEADER` = `'A2A-Version'`
- `A2A_PROTOCOL_VERSION` = `'1.0'`

### 4.2 Multi-Tenancy

Native multi-tenant support. If an `AgentInterface` has a `tenant` value, the
`ClientFactory` automatically wraps the transport with a
`TenantTransportDecorator` that injects the tenant into every request.

```typescript
// Automatic via ClientFactory when AgentInterface.tenant is set
// Or manual:
import { TenantTransportDecorator } from '@a2a-js/sdk/client';
const tenantTransport = new TenantTransportDecorator(baseTransport, 'my-tenant');

// Server-side: access via context.tenant
execute(requestContext, eventBus) {
  const tenant = requestContext.context.tenant;
}
```

All request types now include an optional `tenant` field. All stores
(`InMemoryTaskStore`, `InMemoryPushNotificationStore`) use tenant-scoped nested
Maps for isolation.

### 4.3 Agent Card Signatures

Sign and verify agent cards using JWS (RFC 7515) and JSON Canonicalization
Scheme (RFC 8785):

```typescript
import {
  generateAgentCardSignature,
  verifyAgentCardSignature,
  canonicalizeAgentCard,
} from '@a2a-js/sdk';

// Server: sign an agent card
const sign = generateAgentCardSignature(privateKey, { alg: 'RS256' });
const signedCard = await sign(agentCard);

// Client: verify a signature
const verify = verifyAgentCardSignature(async (header) => publicKey);
await verify(agentCard); // throws on failure
```

### 4.4 `listTasks()` Operation

A new paginated task listing operation with filtering:

```typescript
// Client
const response = await client.listTasks({
  contextId: 'my-context',
  status: TaskState.TASK_STATE_WORKING,
  pageSize: 50,
  pageToken: '',
  tenant: '',
});

// Server -- TaskStore.list() must be implemented
// REST endpoint: GET /tasks?contextId=...&status=TASK_STATE_WORKING
```

### 4.5 Content-Type

A new registered IANA media type is used for REST and push notification payloads:

```typescript
import { A2A_CONTENT_TYPE } from '@a2a-js/sdk';
// A2A_CONTENT_TYPE = 'application/a2a+json'
```

---

## 5. Quick Reference: Import Path Changes

| v0.3 Import                                                         | v1.0 Import                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `import { A2AClient } from '@a2a-js/sdk/client'`                    | Removed -- use `ClientFactory` + `Client`                          |
| `import { TextPart, FilePart, DataPart } from '@a2a-js/sdk'`        | Removed -- use `Part`                                              |
| `import { MessageSendParams } from '@a2a-js/sdk'`                   | `import { SendMessageRequest } from '@a2a-js/sdk'`                 |
| `import { TaskQueryParams } from '@a2a-js/sdk'`                     | `import { GetTaskRequest } from '@a2a-js/sdk'`                     |
| `import { TaskIdParams } from '@a2a-js/sdk'`                        | `import { CancelTaskRequest } from '@a2a-js/sdk'`                  |
| `import { A2AError } from '@a2a-js/sdk/server'`                     | `import { TaskNotFoundError, ... } from '@a2a-js/sdk/server'`      |
| `import { A2AExpressApp } from '@a2a-js/sdk/server/express'`        | Removed -- use `jsonRpcHandler`, `restHandler`, `agentCardHandler` |
| `import { AuthenticatedExtendedCardNotConfiguredError } from '...'` | `import { ExtendedAgentCardNotConfiguredError } from '...'`        |

---

## 6. Migration Checklist

Use this checklist to track your migration progress:

### Prerequisites

- [ ] Update Node.js to >= 20
- [ ] Install `@a2a-js/sdk@latest`

### Data Model (Critical)

- [ ] Replace all `Part` type usage with unified `Part` using `content.$case`
- [ ] Replace string enums (`'completed'`, `'user'`) with numeric enums
      (`TaskState.TASK_STATE_COMPLETED`, `Role.ROLE_USER`)
- [ ] Remove `kind` checks from Message, Task, and streaming event handling
- [ ] Update `AgentCard` to use `supportedInterfaces` instead of
      `url`/`preferredTransport`/`additionalInterfaces`
- [ ] Replace `configuration.blocking` with `configuration.returnImmediately`
      (inverted semantics)
- [ ] Flatten `PushNotificationConfig` into `TaskPushNotificationConfig`
- [ ] Update `AuthenticationInfo.schemes` (array) to `.scheme` (string)

### Client

- [ ] Replace `A2AClient` with `ClientFactory` + `Client`
- [ ] Update all parameter types (`MessageSendParams` -> `SendMessageRequest`, etc.)
- [ ] Update streaming code to use `StreamResponse.payload.$case` pattern
- [ ] Rename `setTaskPushNotificationConfig` to `createTaskPushNotificationConfig`
- [ ] Adopt `listTasks()` if needed

### Server

- [ ] Replace `A2AExpressApp` with individual handler functions
- [ ] Replace `A2AError` static factories with specific error classes
- [ ] Update `ServerCallContext` constructor to use options object
- [ ] Make `context` non-optional everywhere
- [ ] Update `ExecutionEventBus` usage to use `AgentEvent.*` factories
- [ ] Add `list()` to custom `TaskStore` implementations
- [ ] Update `PushNotificationStore` signatures (add `context` parameter)
- [ ] Update `PushNotificationSender` to accept `StreamResponse` + `context`
- [ ] Update `RequestContext` constructor (parameter reordering)
- [ ] Rename `setTaskPushNotificationConfig` to `createTaskPushNotificationConfig`
      in custom `A2ARequestHandler` implementations
