# Restricted Agent Server

This sample demonstrates how to create an A2A agent server that requires authorization via a special Authorization header. The agent will only respond to requests that include the correct Bearer token.

## Features

- **Authorization Required**: All requests must include a valid `Authorization: Bearer <token>` header
- **Security**: Returns 401 for missing auth headers and 403 for invalid tokens
- **Custom Request Handler**: Extends the default request handler to add authentication middleware
- **Clear Error Messages**: Provides helpful error responses for unauthorized requests

## Running the Server

```bash
npx tsx src/samples/servers/restricted_agent/index.ts
```

The server will start on `http://localhost:3000` and display the required authorization token.

## Testing

### With Valid Authorization (Success)
```bash
curl -H "Authorization: Bearer secret-auth-token-12345" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/agent/tasks \
     -d '{
       "message": {
         "kind": "message",
         "messageId": "test-msg-1",
         "role": "user",
         "parts": [{"kind": "text", "text": "Hello restricted agent!"}],
         "contextId": "test-context"
       }
     }'
```

### Without Authorization (Should Fail with 401)
```bash
curl -X POST http://localhost:3000/agent/tasks \
     -H "Content-Type: application/json" \
     -d '{
       "message": {
         "kind": "message",
         "messageId": "test-msg-1",
         "role": "user", 
         "parts": [{"kind": "text", "text": "Hello!"}],
         "contextId": "test-context"
       }
     }'
```

### With Invalid Token (Should Fail with 403)
```bash
curl -H "Authorization: Bearer wrong-token" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/agent/tasks \
     -d '{
       "message": {
         "kind": "message",
         "messageId": "test-msg-1",
         "role": "user",
         "parts": [{"kind": "text", "text": "Hello!"}],
         "contextId": "test-context"
       }
     }'
```

## Implementation Details

The sample creates a custom `AuthorizedRequestHandler` that extends the default `DefaultRequestHandler` and overrides the `handleRequest` method to check for proper authorization before allowing access to the agent.

The required token is: `secret-auth-token-12345`

## Security Notes

- In production, use proper JWT tokens or OAuth2 flows
- Store secrets securely (environment variables, secret managers)
- Consider rate limiting and other security measures
- Use HTTPS in production environments