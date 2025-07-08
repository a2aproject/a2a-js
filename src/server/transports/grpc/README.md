# A2A gRPC Transport

This directory contains the gRPC transport implementation for the A2A JS SDK.

## Overview

The gRPC transport provides an alternative to JSON-RPC for A2A communication, offering:
- Strongly typed protocol buffers
- Native support for streaming
- Better performance for binary data
- Language-agnostic service definitions

## Usage

```typescript
import * as grpc from '@grpc/grpc-js';
import { A2AGrpcService, a2AServiceDefinition } from './index.js';
import { DefaultRequestHandler } from '../../request_handler/default_request_handler.js';

// Create your agent card configuration
const agentCard = {
    name: 'My Agent',
    description: 'An A2A agent using gRPC',
    url: 'grpc://localhost:50051',
    version: '1.0.0',
    capabilities: {
        streaming: true,
        pushNotifications: false
    },
    skills: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text']
};

// Create a request handler with your message processing logic
const requestHandler = new DefaultRequestHandler(
    agentCard,
    async (message, context) => {
        // Your message handling logic here
        // Return a Task or Message response
    }
);

// Create the gRPC service
const grpcService = new A2AGrpcService(requestHandler);

// Create and start the gRPC server
const server = new grpc.Server();
server.addService(a2AServiceDefinition, grpcService);

server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('Failed to bind server:', err);
        return;
    }
    console.log(`A2A gRPC server listening on port ${port}`);
});
```

## Service Methods

The gRPC service implements the following methods:

- `SendMessage` - Send a message and receive a response (blocking or non-blocking)
- `SendStreamingMessage` - Send a message and stream task updates
- `GetTask` - Get the current state of a task
- `CancelTask` - Cancel an in-progress task
- `TaskSubscription` - Subscribe to task updates via streaming
- `CreateTaskPushNotificationConfig` - Configure push notifications for a task
- `GetTaskPushNotificationConfig` - Get push notification config for a task
- `ListTaskPushNotificationConfig` - List all push notification configs for a task
- `GetAgentCard` - Get the agent's capabilities and metadata
- `DeleteTaskPushNotificationConfig` - Delete a push notification config

## Authentication

The gRPC service does not handle authentication directly. You can add authentication using:
- gRPC interceptors
- TLS/mTLS
- Custom headers
- Token-based authentication

Example with TLS:
```typescript
const credentials = grpc.ServerCredentials.createSsl(
    fs.readFileSync('ca.crt'),
    [{
        cert_chain: fs.readFileSync('server.crt'),
        private_key: fs.readFileSync('server.key')
    }]
);

server.bindAsync('0.0.0.0:50051', credentials, callback);
```

## Type Conversion

The implementation handles conversion between:
- gRPC protobuf types and internal A2A types
- Protobuf `Struct` and JavaScript objects
- Protobuf `Timestamp` and JavaScript `Date`
- Binary data encoding/decoding

## Error Handling

JSON-RPC error codes are mapped to gRPC status codes:
- Parse error (-32700) → INVALID_ARGUMENT
- Invalid request (-32600) → INVALID_ARGUMENT
- Method not found (-32601) → UNIMPLEMENTED
- Invalid params (-32602) → INVALID_ARGUMENT
- Internal error (-32603) → INTERNAL
- Task not found (-32001) → NOT_FOUND
- Task not cancelable (-32002) → FAILED_PRECONDITION
- Push notification not supported (-32003) → UNIMPLEMENTED
- Unsupported operation (-32004) → UNIMPLEMENTED

## Generated Code

The protobuf definitions and TypeScript interfaces are generated from `a2a.proto`. 
Do not modify the generated files directly.