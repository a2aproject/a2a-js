# Single Agent Server

A simple A2A agent that demonstrates the basic agent pattern by responding "Hello World!" to any user message.

## Features

- **Simple Response**: Always responds with "Hello World!" regardless of user input
- **Basic A2A Protocol**: Demonstrates core A2A agent structure
- **No Dependencies**: Minimal setup with no external API keys or services required
- **Single Agent**: Uses `DefaultRequestHandler` for straightforward single-agent routing

## Running the Agent

1. **Install dependencies** (from project root):
   ```bash
   npm install
   ```

2. **Start the agent**:
   ```bash
   npx tsx src/samples/agents/hello-world-agent/index.ts
   ```

3. **View the agent card**:
   ```
   http://localhost:3001/.well-known/agent-card.json
   ```

## Testing the Agent

You can test the agent using any A2A client or curl:

```bash
# Send a message to the agent
curl -X POST http://localhost:3001/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-1",
    "method": "agents/chat",
    "params": {
      "message": {
        "kind": "message",
        "role": "user", 
        "messageId": "msg-1",
        "parts": [{"kind": "text", "text": "What is your name?"}],
        "contextId": "ctx-1"
      }
    }
  }'
```

No matter what you send, the agent will always respond with "Hello World!"

## Testing the Agents

### Using the CLI Client

The easiest way to test the agents is using the built-in CLI client:

```bash
# Test the hello world agent
npm run sample:cli -- http://localhost:3000/
# Try typing anything
```

## Code Structure

- **HelloWorldAgentExecutor**: Implements the core agent logic
- **Agent Card**: Defines the agent's capabilities and metadata
- **Express Server**: Sets up HTTP endpoints using A2AExpressApp

This sample is perfect for understanding the basic A2A agent structure before building more complex agents.