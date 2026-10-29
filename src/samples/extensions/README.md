# Extension

This sample demonstrates the A2A protocol extension mechanism. The
[`SampleAgentExecutor`](../agents/sample-agent/agent_executor.ts) is wrapped
with [`TimestampingAgentExecutor`](./extensions.ts), which intercepts every
`TaskStatusUpdateEvent` whose `status.message` is non-empty and writes a
`metadata.timestamp` into that message before it is forwarded to the SDK
event bus.

The agent card declares the extension via `capabilities.extensions`. Clients
opt in per request with the `A2A-Extensions` HTTP header.

To run the agent:

```bash
npm run agents:extension-agent
```

The agent will start on `http://localhost:41241`.

## Calling the agent

```bash
curl -X POST http://localhost:41241/ \
  -H "A2A-Extensions: https://github.com/a2aproject/a2a-js/src/samples/extensions/v1" \
  -H "A2A-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "9229e770-767c-417b-a0b0-f0741243c589",
        "role": "ROLE_USER",
        "parts": [
          { "text": "Hello how are you?", "mediaType": "text/plain" }
        ]
      }
    }
  }'
```

## Expected (simplified) response

The result is wrapped as `{result: {task: {...}}}`. The
`SampleAgentExecutor` publishes only one intermediate status update with a
message (the `TASK_STATE_WORKING` state); the extension stamps that message
with a timestamp. The final `TASK_STATE_COMPLETED` event has no inline
message, so no timestamp appears there.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "<server-generated-uuid>",
      "contextId": "<server-generated-uuid>",
      "status": {
        "state": "TASK_STATE_COMPLETED",
        "timestamp": "2025-11-14T15:51:36.725Z"
      },
      "artifacts": [
        {
          "artifactId": "<server-generated-uuid>",
          "name": "Result",
          "description": "The final result from the agent.",
          "parts": [
            { "text": "Hello World! Nice to meet you!", "mediaType": "text/plain" }
          ]
        }
      ],
      "history": [
        {
          "messageId": "9229e770-767c-417b-a0b0-f0741243c589",
          "role": "ROLE_USER",
          "parts": [{ "text": "Hello how are you?", "mediaType": "text/plain" }]
        },
        {
          "messageId": "<server-generated-uuid>",
          "role": "ROLE_AGENT",
          "parts": [{ "text": "Processing your question", "mediaType": "text/plain" }],
          "metadata": {
            "timestamp": "2025-11-14T15:51:35.722Z"
          }
        }
      ]
    }
  }
}
```

If the `A2A-Extensions` header is omitted, the extension does not activate
(`TimeStampExtension.activate` returns `false`) and no `timestamp` metadata
is added.
