# Migration Guide: @a2a-js/sdk v0.3 to v1.0

This guide covers the breaking changes in the `@a2a-js/sdk` when upgrading from
v0.3 to v1.0. It focuses on SDK-specific API changes. For protocol-level data
model changes (renamed fields, restructured types, new operations), see:

- [What's New in v1.0](https://a2a-protocol.org/v1.0.0/whats-new-v1/)
- [A2A Protocol v1.0 Specification](https://a2a-protocol.org/v1.0.0/specification/)
- [Appendix A: Migration Guidance](https://a2a-protocol.org/v1.0.0/specification/#appendix-a-migration-legacy-compatibility)

## Prerequisites

- **Node.js >= 20** is now required (v0.3 supported Node 18).
- Install the v1.0 SDK:

  ```bash
  npm install @a2a-js/sdk@next
  ```

> Migrating all v0.3 clients to v1.0 during upgrade is not required: the v1.0 SDK
> ships an opt-in compatibility layer that lets a v1.0 server accept v0.3
> clients (and a v1.0 client talk to v0.3 servers). See
> [compatibility-v0_3.md](compatibility-v0_3.md) for end-user setup and
> caveats.

---

## 1. Data Model Changes

The JSON-Schema-generated types in `src/types.ts` have been **deleted**. All
types now come from protobuf-generated definitions. The full data model is
defined in the [Protocol Data Model](https://a2a-protocol.org/v1.0.0/specification/#4-protocol-data-model)
section of the spec. Below are the changes that affect how you write SDK code.

### 1.1 Part Types

`TextPart`, `FilePart`, and `DataPart` are replaced by a single `Part` type
with a `content` oneof discriminated by `$case`:

```typescript
// v0.3
const text: TextPart = { kind: 'text', text: 'Hello', metadata: {} };
const file: FilePart = {
  kind: 'file',
  file: { uri: '...', mimeType: 'image/png', name: 'photo.png' },
};

// v1.0
const text: Part = {
  content: { $case: 'text', value: 'Hello' },
  metadata: undefined,
  filename: '',
  mediaType: 'text/plain',
};
const file: Part = {
  content: { $case: 'url', value: '...' },
  metadata: undefined,
  filename: 'photo.png',
  mediaType: 'image/png',
};

// Discriminating:
switch (part.content?.$case) {
  case 'text':
    /* part.content.value is string */ break;
  case 'url':
    /* file by URL */ break;
  case 'raw':
    /* file by bytes (Buffer) */ break;
  case 'data':
    /* structured JSON data */ break;
}
```

| v0.3                     | v1.0                               |
| ------------------------ | ---------------------------------- |
| `FilePart.file.mimeType` | `Part.mediaType`                   |
| `FilePart.file.name`     | `Part.filename`                    |
| `FilePart.file.uri`      | `Part.content` with `$case: 'url'` |
| `FilePart.file.bytes`    | `Part.content` with `$case: 'raw'` |

### 1.2 `kind` Discriminator Removed

The `kind` field has been removed from `Message`, `Task`,
`TaskStatusUpdateEvent`, and `TaskArtifactUpdateEvent`
([spec reference](https://a2a-protocol.org/v1.0.0/specification/#a21-breaking-change-kind-discriminator-removed)).
The SDK provides typed wrappers as replacements:

- **Client side:** `StreamResponse` -- use `payload.$case` (see [Section 2.3](#23-streaming-return-type-streamresponse))
- **Server side:** `AgentExecutionEvent` -- use `event.kind` on the wrapper (see [Section 3.4](#34-executioneventbus----discriminated-event-wrapper))

```typescript
// v1.0 client -- StreamResponse.payload.$case
switch (streamResponse.payload?.$case) {
  case 'message':
    /* .value is Message */ break;
  case 'task':
    /* .value is Task */ break;
  case 'statusUpdate':
    /* .value is TaskStatusUpdateEvent */ break;
  case 'artifactUpdate':
    /* .value is TaskArtifactUpdateEvent */ break;
}

// v1.0 server -- AgentExecutionEvent.kind
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

### 1.3 Enums Are Now Numeric

All enum values are now [standardized](https://a2a-protocol.org/v1.0.0/specification/#55-json-field-naming-convention) to use `SCREAMING_SNAKE_CASE` format.
See the spec for the full
[TaskState](https://a2a-protocol.org/v1.0.0/specification/#413-taskstate) and
[Role](https://a2a-protocol.org/v1.0.0/specification/#415-role) definitions.

```typescript
// v0.3
task.status.state === 'completed';
message.role === 'user';

// v1.0
import { TaskState, Role } from '@a2a-js/sdk';
task.status.state === TaskState.TASK_STATE_COMPLETED;
message.role === Role.ROLE_USER;
```

### 1.4 Removed JSON-RPC Type Layer

All JSON-RPC envelope types from `src/types.ts` are removed (`A2ARequest`,
`A2AResponse`, `JSONRPCResponse`, `MessageSendParams`, `TaskQueryParams`,
`TaskIdParams`, all `*SuccessResponse` types, etc.). The SDK now uses
protobuf-based request types directly and returns unwrapped domain objects.

### 1.5 Other Protocol-Level Data Model Changes

The following changes are defined by the spec. See the linked sections for
details; the SDK types reflect these changes directly.

| Change                                                                                                                                                                                              | Spec reference                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AgentCard` restructured (`supportedInterfaces` replaces `url`/`preferredTransport`/`additionalInterfaces`)                                                                                         | [AgentCard](https://a2a-protocol.org/v1.0.0/specification/#441-agentcard), [AgentInterface](https://a2a-protocol.org/v1.0.0/specification/#446-agentinterface)                                   |
| `PushNotificationConfig` flattened into `TaskPushNotificationConfig`; `AuthenticationInfo.schemes` (array) changed to `.scheme` (string)                                                            | [PushNotificationConfig](https://a2a-protocol.org/v1.0.0/specification/#431-pushnotificationconfig), [AuthenticationInfo](https://a2a-protocol.org/v1.0.0/specification/#432-authenticationinfo) |
| `MessageSendConfiguration` renamed to `SendMessageConfiguration`; `blocking` replaced by `returnImmediately` (inverted semantics); `pushNotificationConfig` renamed to `taskPushNotificationConfig` | [SendMessageConfiguration](https://a2a-protocol.org/v1.0.0/specification/#322-sendmessageconfiguration)                                                                                          |
| `TaskStatusUpdateEvent.final` removed                                                                                                                                                               | [TaskStatusUpdateEvent](https://a2a-protocol.org/v1.0.0/specification/#421-taskstatusupdateevent)                                                                                                |
| `ImplicitOAuthFlow` and `PasswordOAuthFlow` deprecated; `DeviceCodeOAuthFlow` added                                                                                                                 | [OAuthFlows](https://a2a-protocol.org/v1.0.0/specification/#457-oauthflows)                                                                                                                      |
| JSON-RPC method names changed (e.g., `message/send` -> `SendMessage`)                                                                                                                               | [Method Mapping Reference](https://a2a-protocol.org/v1.0.0/specification/#53-method-mapping-reference)                                                                                           |
| REST content type changed to `application/a2a+json`                                                                                                                                                 | [IANA Media Type](https://a2a-protocol.org/v1.0.0/specification/#141-media-type-registration)                                                                                                    |
| Extension header renamed from `X-A2A-Extensions` to `A2A-Extensions`                                                                                                                                | [A2A-Extensions Header](https://a2a-protocol.org/v1.0.0/specification/#1422-a2a-extensions-header)                                                                                               |

---

## 2. Client-Side Changes

### 2.1 `A2AClient` Class Removed

`A2AClient` was deprecated in v0.3 in favor of `ClientFactory` and `Client`
(see `ClientFactory` docs). It has now been removed entirely. If you are still
using `A2AClient`, migrate to `ClientFactory`:

```typescript
// v1.0
import { ClientFactory } from '@a2a-js/sdk/client';
const factory = new ClientFactory();
const client = await factory.createFromAgentCard(agentCard);
// OR: const client = await factory.createFromUrl('https://agent.example.com');
const result = await client.sendMessage(request);
// result is directly Message | Task (no JSON-RPC envelope)
```

### 2.2 Parameter Type and Method Renames

All method parameter types changed from SDK-specific types to protobuf request
types:

| v0.3 Type                                | v1.0 Type                                 |
| ---------------------------------------- | ----------------------------------------- |
| `MessageSendParams`                      | `SendMessageRequest`                      |
| `TaskQueryParams`                        | `GetTaskRequest`                          |
| `TaskIdParams` (for cancel)              | `CancelTaskRequest`                       |
| `TaskIdParams` (for resubscribe)         | `SubscribeToTaskRequest`                  |
| `GetTaskPushNotificationConfigParams`    | `GetTaskPushNotificationConfigRequest`    |
| `ListTaskPushNotificationConfigParams`   | `ListTaskPushNotificationConfigsRequest`  |
| `DeleteTaskPushNotificationConfigParams` | `DeleteTaskPushNotificationConfigRequest` |

All v1.0 types are imported from `@a2a-js/sdk`.

Method rename: `client.setTaskPushNotificationConfig()` ->
`client.createTaskPushNotificationConfig()`

New method: `client.listTasks(params)` for paginated task listing.

### 2.3 Streaming Return Type: `StreamResponse`

Streaming methods now return `AsyncGenerator<StreamResponse>` instead of raw
event unions. Discriminate via `payload.$case`:

```typescript
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

### 2.4 Transport Interface Changes

If you implement a custom `Transport`:

- Add `get protocolName(): string` and `get protocolVersion(): string` properties.
- Rename `setTaskPushNotificationConfig` to `createTaskPushNotificationConfig`.
- Add `listTasks()` method.
- Update all parameter types per Section 2.2.
- Streaming methods must return `AsyncGenerator<StreamResponse>`.
- `getExtendedAgentCard()` now requires a `GetExtendedAgentCardRequest` as its
  first parameter.

### 2.5 Concrete Transports No Longer Exported

`JsonRpcTransport`, `RestTransport`, and their options types are no longer
public exports. Use the factory classes (`JsonRpcTransportFactory`,
`RestTransportFactory`) instead.

---

## 3. Server-Side Changes

### 3.1 `A2AExpressApp` Removed

`A2AExpressApp` was deprecated in v0.3 in favor of the individual handler
middlewares (`jsonRpcHandler`, `restHandler`, `agentCardHandler` -- see their
docs). It has now been removed entirely. If you are still using `A2AExpressApp`,
migrate to the individual handlers:

```typescript
// v1.0
import { jsonRpcHandler, restHandler, agentCardHandler } from '@a2a-js/sdk/server/express';

app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
app.use('/', jsonRpcHandler({ requestHandler, userBuilder }));
app.use('/', restHandler({ requestHandler, userBuilder }));
```

`agentCardHandler` now supports caching via `cache: { maxAge: 3600 }` (sets
`Cache-Control` and `ETag` headers). The REST handler automatically registers
tenant-prefixed routes (`/:tenant/tasks/:taskId`, etc.) and validates the
`A2A-Version` header.

### 3.2 Error Classes Replaced

The monolithic `A2AError` class with static factory methods is removed.
Use specific error classes:

```typescript
// v0.3
import { A2AError } from '@a2a-js/sdk/server';
throw A2AError.taskNotFound('task-1');
throw A2AError.invalidParams('bad input');

// v1.0
import { TaskNotFoundError, RequestMalformedError } from '@a2a-js/sdk/server';
throw new TaskNotFoundError('task-1');
throw new RequestMalformedError('bad input');
```

Available error classes from `@a2a-js/sdk/server`: `TaskNotFoundError`,
`TaskNotCancelableError`, `RequestMalformedError`, `UnsupportedOperationError`,
`PushNotificationNotSupportedError`, `ContentTypeNotSupportedError`,
`ExtendedAgentCardNotConfiguredError`, `VersionNotSupportedError`.

Error codes and gRPC/HTTP status mappings are defined in the
[spec](https://a2a-protocol.org/v1.0.0/specification/#54-error-code-mappings).

### 3.3 `ServerCallContext` -- Now Mandatory

`context` changed from optional to required on all interfaces
(`A2ARequestHandler`, `TaskStore`, `PushNotificationStore`,
`PushNotificationSender`, `RequestContext`, `ExtendedAgentCardProvider`).
Constructor now uses an options object:

```typescript
// v0.3
new ServerCallContext(requestedExtensions, user);

// v1.0
new ServerCallContext({ requestedExtensions, user, tenant: 'my-tenant', requestedVersion: '1.0' });
```

`RequestContext` now wraps the incoming `SendMessageRequest`, 
and `context` moved from last (optional) to 4th (mandatory).
The loose `userMessage` parameter is replaced by `request: SendMessageRequest`;
agent executors read the message via `ctx.userMessage` (convenience accessor
guaranteed non-null) and the full payload -- including `configuration` and
request-level `metadata` -- via `ctx.request`:

```typescript
// v0.3
new RequestContext(userMessage, taskId, contextId, task, referenceTasks, context);
// v1.0
new RequestContext(request, taskId, contextId, context, task, referenceTasks);

// Reading from an executor:
ctx.userMessage; // Message -- shorthand for ctx.request.message (non-null)
ctx.request.configuration; // SendMessageConfiguration | undefined -- newly exposed
ctx.request.metadata; // Record<string, unknown> | undefined
```

The wrapped `request` is deep-cloned on construction so mutations inside the
executor cannot leak back to the caller's `SendMessageRequest`.

### 3.4 `ExecutionEventBus` -- Discriminated Event Wrapper

Events must now be wrapped with `AgentEvent` factories:

```typescript
// v0.3 -- publish raw objects
eventBus.publish(myTask);
eventBus.publish(myMessage);

// v1.0 -- use AgentEvent factory
import { AgentEvent } from '@a2a-js/sdk/server';

eventBus.publish(AgentEvent.task(myTask));
eventBus.publish(AgentEvent.statusUpdate(myStatusUpdate));
eventBus.publish(AgentEvent.message(myMessage));
eventBus.publish(AgentEvent.artifactUpdate(myArtifact));
```

When consuming, use `event.kind` and `event.data` on the `AgentExecutionEvent`
wrapper (see [Section 1.2](#12-kind-discriminator-removed) for the pattern).

### 3.5 `TaskStore` -- New `list()` Method

```typescript
// v0.3
interface TaskStore {
  save(task: Task, context?: ServerCallContext): Promise<void>;
  load(taskId: string, context?: ServerCallContext): Promise<Task | undefined>;
}

// v1.0 -- context is mandatory, list() is new
interface TaskStore {
  save(task: Task, context: ServerCallContext): Promise<void>;
  load(taskId: string, context: ServerCallContext): Promise<Task | undefined>;
  list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse>;
}
```

`InMemoryTaskStore` is now tenant-scoped internally.

### 3.6 `PushNotificationStore` and `PushNotificationSender`

`PushNotificationStore` -- `context` added as 2nd parameter; type changed from
`PushNotificationConfig` to `TaskPushNotificationConfig`:

```typescript
// v0.3
store.save(taskId, config);
store.load(taskId);
store.delete(taskId, configId);

// v1.0 -- context inserted as 2nd parameter
store.save(taskId, context, config);
store.load(taskId, context);
store.delete(taskId, context, configId);
```

`PushNotificationSender` -- now accepts `StreamResponse` + `context` instead of
just `Task`:

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

### 3.7 `A2ARequestHandler` and `DefaultRequestHandler`

All `A2ARequestHandler` parameter types changed to protobuf request types (same
mappings as Section 2.2). Key changes:

- `setTaskPushNotificationConfig` -> `createTaskPushNotificationConfig`
- `getAuthenticatedExtendedAgentCard(context)` ->
  `getAuthenticatedExtendedAgentCard(params, context)`
- New: `listTasks(params, context)`
- Streaming methods return `AsyncGenerator<StreamResponse>`

`DefaultRequestHandler` constructor has a new optional 8th parameter
`agentCardSignatureGenerator` for agent card signing.

---

## 4. New SDK Features

### 4.1 Version Negotiation

The SDK sends `A2A-Version: 1.0` automatically on all client requests. Servers
validate the version via `DefaultRequestHandler`. New constants:
`A2A_VERSION_HEADER`, `A2A_PROTOCOL_VERSION`, `A2A_CONTENT_TYPE`.

### 4.2 Multi-Tenancy

If an `AgentInterface` has a `tenant` value, `ClientFactory` automatically wraps
the transport with `TenantTransportDecorator`. Server-side, access
`context.tenant`. All stores are tenant-scoped internally.

### 4.3 Agent Card Signatures

```typescript
import { generateAgentCardSignature, verifyAgentCardSignature } from '@a2a-js/sdk';

const sign = generateAgentCardSignature(privateKey, { alg: 'RS256' });
const signedCard = await sign(agentCard);

const verify = verifyAgentCardSignature(async (header) => publicKey);
await verify(agentCard);
```

---

## 5. Import Path Changes

| v0.3 Import                                                  | v1.0 Import                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `import { A2AClient } from '@a2a-js/sdk/client'`             | Removed -- use `ClientFactory` + `Client`                     |
| `import { TextPart, FilePart, DataPart } from '@a2a-js/sdk'` | Removed -- use `Part`                                         |
| `import { MessageSendParams } from '@a2a-js/sdk'`            | `import { SendMessageRequest } from '@a2a-js/sdk'`            |
| `import { TaskQueryParams } from '@a2a-js/sdk'`              | `import { GetTaskRequest } from '@a2a-js/sdk'`                |
| `import { TaskIdParams } from '@a2a-js/sdk'`                 | `import { CancelTaskRequest } from '@a2a-js/sdk'`             |
| `import { A2AError } from '@a2a-js/sdk/server'`              | `import { TaskNotFoundError, ... } from '@a2a-js/sdk/server'` |
