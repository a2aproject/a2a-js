# JavaScript Samples

The provided samples demonstrate how to use A2A-js.

## Agents

- [Sample Agent](agents/sample-agent/README.md): Basic sample to show task flow updates.
- [Movie Agent](agents/movie-agent/README.md): Uses TMDB API to search for movie information and answer questions.

## Testing the Agents

First, follow the instructions in the agent's README file, to check details on specific agents (you may need to manually change the `serverUrl` address used in the `cli.ts`, based on the agent you are testing).
Example:

1. Navigate to the `a2a-js` directory:
2. Run npm install:
    ```bash
    npm install
    ```
3. Run an agent:
```bash
npm run agents:sample-agent

# in a separate terminal
npm run a2a:cli
```

## Note

This is sample code and not production-quality libraries.

## Disclaimer
Important: The sample code provided is for demonstration purposes and illustrates the
mechanics of the Agent-to-Agent (A2A) protocol. When building production applications,
it is critical to treat any agent operating outside of your direct control as a
potentially untrusted entity.