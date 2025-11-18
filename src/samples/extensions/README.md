# Extension

This configuration is using a sample agent to test the extension feature integration. It uses the sample agent executor defined in `agents/sample-agent`, with a modified agent card which includes the support for extensions.
The `extensions.ts` adds a timestamp in the metadata of the `TaskStatusUpdateEvent` Message.

To run the agent:

```bash
npm run agents:extension-agent
```

The agent will start on `http://localhost:41241`.

To test the extension:

```bash
curl -X POST http://localhost:41241/
    -H "X-A2A-Extensions: https://github.com/a2aproject/a2a-js/src/samples/extensions/v1"
    -H "Content-Type: application/json"
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "message/send",
        "params": {
            "message": {
            "role": "user",
            "parts": [
                {
                "kind": "text",
                "text": "Hello how are you?"
                }
            ],
            "messageId": "9229e770-767c-417b-a0b0-f0741243c589"
            }
        }
    }'
```

Expected simplified response:

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "kind": "task",
        "status": {
            "state": "completed",
            "message": {
                ...
                "metadata": {
                    "timestamp": "2025-11-14T15:51:36.725Z" // Timestamp added to metadata on the 'completed' TaskStatusUpdateEvent
                }
            },
        },
        "history": [
            {
                ...
            },
            {
                ...
                "metadata": {
                    "timestamp": "2025-11-14T15:51:35.722Z" // Timestamp added to metadata on the 'running' TaskStatusUpdateEvent
                }
            },
            {
                ...
                "metadata": {
                    "timestamp": "2025-11-14T15:51:36.725Z" // Timestamp added to metadata on the 'completed' TaskStatusUpdateEvent
                }
            }
        ]
    }
}
```
