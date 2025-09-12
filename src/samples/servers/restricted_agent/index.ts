import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AgentCard, Message } from '@a2a-js/sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import { 
  DynamicAgentRequestHandler, 
  RouteContext 
} from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';
import { A2AError } from '@a2a-js/sdk/server';

const REQUIRED_AUTH_TOKEN = "secret-auth-token-12345";

const restrictedAgentCard: AgentCard = {
  name: "Restricted Agent",
  description: "A secure agent that requires proper authorization.",
  protocolVersion: "0.3.0",
  version: "0.1.0",
  url: "http://localhost:3000/",
  skills: [ { id: "secure-chat", name: "Secure Chat", description: "Chat with authorization", tags: ["secure", "chat"] } ],
  defaultInputModes: [],
  defaultOutputModes: [],
  capabilities: {
    streaming: true
  }
};

class RestrictedExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const responseMessage: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      parts: [{ 
        kind: "text", 
        text: "🔐 Access granted! You have successfully authenticated with the restricted agent. This is a secure response only visible to authorized users." 
      }],
      contextId: requestContext.contextId,
    };

    eventBus.publish(responseMessage);
    eventBus.finished();
  }
  
  cancelTask = async (): Promise<void> => {};
}

function checkAuthorization(route: RouteContext): void {
  const authHeader = route.headers?.authorization;
  
  if (!authHeader) {
    throw A2AError.invalidRequest("Authorization header required");
  }

  if (authHeader !== `Bearer ${REQUIRED_AUTH_TOKEN}`) {
    throw A2AError.invalidRequest("Invalid authorization token");
  }
}

const taskStore = new InMemoryTaskStore();
const agentExecutor = new RestrictedExecutor();

const dynamicHandler = new DynamicAgentRequestHandler(
  async (route: RouteContext) => {
    checkAuthorization(route);
    return restrictedAgentCard;
  },
  
  async (route: RouteContext) => {
    checkAuthorization(route);
    return taskStore;
  },
  
  async (route: RouteContext) => {
    checkAuthorization(route);
    return agentExecutor;
  }
);

const appBuilder = new A2AExpressApp(dynamicHandler);
const expressApp = appBuilder.setupRoutes(express());

expressApp.listen(3000, () => {
  console.log(`🚀 Restricted Agent Server started on http://localhost:3000`);
  console.log(`🔐 Authorization required: Bearer ${REQUIRED_AUTH_TOKEN}`);
  console.log(`\nTo test the agent card (should require auth):`);
  console.log(`curl -H "Authorization: Bearer ${REQUIRED_AUTH_TOKEN}" http://localhost:3000/.well-known/agent-card.json`);
  console.log(`\nTo send a message (should require auth):`);
  console.log(`curl -X POST -H "Authorization: Bearer ${REQUIRED_AUTH_TOKEN}" -H "Content-Type: application/json" http://localhost:3000/ -d '{"jsonrpc":"2.0","id":"1","method":"create_task","params":{"message":{"kind":"message","messageId":"test-1","role":"user","parts":[{"kind":"text","text":"Hello!"}],"contextId":"test"}}}'`);
  console.log(`\nWithout auth (should fail):`);
  console.log(`curl http://localhost:3000/.well-known/agent-card.json`);
});