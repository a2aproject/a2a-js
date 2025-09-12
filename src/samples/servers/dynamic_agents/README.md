# Dynamic Agent Server

This sample demonstrates how to use `DynamicAgentRequestHandler` to create a server that can dynamically route to different agents based on the URL path.

The server provides two working example agents:
- **Calculator Agent**: Performs basic math operations like "2 + 2" or "10 * 5"  
- **Weather Agent**: Provides fake weather data for major cities (London, Paris, Tokyo, New York, Sydney)

## Running the Sample

```bash
npm run sample:dynamic-agents
```

The server will start on `http://localhost:3000`.

## Available Endpoints

- `GET /agents/calculator/.well-known/agent-card.json` - Calculator agent card
- `POST /agents/calculator/` - Calculator agent messages
- `GET /agents/weather/.well-known/agent-card.json` - Weather agent card  
- `POST /agents/weather/` - Weather agent messages

## How It Works

The `DynamicAgentRequestHandler` inspects the incoming URL and dynamically determines:
1. Which agent card to return
2. Which task store to use
3. Which agent executor to run

This allows a single route setup (`/agents`) to handle multiple different agent behaviors without needing separate route configurations for each agent.

## Testing the Agents

### Using the CLI Client

The easiest way to test the agents is using the built-in CLI client:

```bash
# Test the calculator agent
npm run sample:cli -- http://localhost:3000/agents/calculator/
# Try typing: 1 + 1

# Test the weather agent  
npm run sample:cli -- http://localhost:3000/agents/weather/
# Try typing: whats weather in tokyo
```

### Using curl or HTTP clients

You can also test the agents using curl or any HTTP client:

```bash
# Get calculator agent card
curl http://localhost:3000/agents/calculator/.well-known/agent-card.json

# Send a math problem to calculator
curl -X POST http://localhost:3000/agents/calculator/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "sendMessage",
    "params": {
      "message": {
        "messageId": "test-1",
        "role": "user",
        "parts": [{"kind": "text", "text": "What is 15 * 7?"}],
        "kind": "message"
      }
    },
    "id": 1
  }'

# Ask weather agent about a city
curl -X POST http://localhost:3000/agents/weather/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "sendMessage",
    "params": {
      "message": {
        "messageId": "test-2",
        "role": "user",
        "parts": [{"kind": "text", "text": "What is the weather in Tokyo?"}],
        "kind": "message"
      }
    },
    "id": 2
  }'
```

## Key Benefits

- **Single Route Setup**: One `setupRoutes()` call handles all agents
- **Dynamic Routing**: URL inspection determines agent behavior  
- **Easy Extension**: Add new agents by updating resolver functions, no new routes needed
- **Working Examples**: Both agents actually respond to messages with proper A2A protocol
- **Clean API**: No need for complex route configuration