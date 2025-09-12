import express from "express";
import { v4 as uuidv4 } from "uuid";
import type { AgentCard, Message } from "@a2a-js/sdk";
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";

// 1. Define your agent's identity card.
const helloAgentCard: AgentCard = {
  name: "Hello Agent",
  description: "A simple agent that says hello.",
  protocolVersion: "0.3.0",
  version: "0.1.0",
  url: "http://localhost:3000/", // The public URL of your agent server
  skills: [ { id: "chat", name: "Chat", description: "Say hello", tags: ["chat"] } ],
  defaultInputModes: [],
  defaultOutputModes: [],
  capabilities: {
    streaming: true
  }
};

// 2. Implement the agent's logic.
class HelloExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    // Create a direct message response.
    const responseMessage: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      parts: [{ kind: "text", text: "Hello, world!" }],
      // Associate the response with the incoming request's context.
      contextId: requestContext.contextId,
    };

    // Publish the message and signal that the interaction is finished.
    eventBus.publish(responseMessage);
    eventBus.finished();
  }
  
  // cancelTask is not needed for this simple, non-stateful agent.
  cancelTask = async (): Promise<void> => {};
}

// 3. Set up and run the server.
const agentExecutor = new HelloExecutor();
const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  agentExecutor
);

const appBuilder = new A2AExpressApp(requestHandler);
const expressApp = appBuilder.setupRoutes(express());

expressApp.listen(3000, () => {
  console.log(`🚀 Server started on http://localhost:3000`);
});