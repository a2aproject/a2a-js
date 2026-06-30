# SUT Agent (v0.3 compat)

A v1.0-native SUT for the [a2a-tck](https://github.com/a2aproject/a2a-tck) v0.3 suite. Built on the same v1.0 SDK as the production server samples but with the v0.3 backward-compatibility layer (`@a2a-js/sdk/compat/v0_3/...`) enabled on every transport, so the TCK can drive this agent unchanged while the SDK runs in its modern shape.

To run:

```bash
npm run tck:compat-sut-agent
```

Endpoints (defaults — override with `HTTP_PORT` / `GRPC_PORT` env vars):

| Transport  | URL                                                  | Versions accepted                              |
| ---------- | ---------------------------------------------------- | ---------------------------------------------- |
| JSON-RPC   | `http://localhost:41241/a2a/jsonrpc`                 | v1.0 + v0.3                                    |
| REST v1.0  | `http://localhost:41241/a2a/rest`                    | v1.0                                           |
| REST v0.3  | `http://localhost:41241/a2a/rest/v1`                 | v0.3                                           |
| Agent card | `http://localhost:41241/.well-known/agent-card.json` | shape depends on `A2A-Version` header          |
| gRPC       | `localhost:41242`                                    | v1.0 + v0.3 (services registered side-by-side) |
