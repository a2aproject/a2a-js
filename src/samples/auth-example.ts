#!/usr/bin/env node

import { A2AClient, A2AClientConfig, CustomHeaders } from "../client/index.js";
import { MessageSendParams } from "../index.js";

/**
 * Example demonstrating custom headers usage including bearer token authentication
 */

async function main() {
  // Example 1: Client with bearer token via custom headers
  console.log("=== Example 1: Client with Bearer Token via Custom Headers ===");
  
  const configWithToken: A2AClientConfig = {
    customHeaders: {
      "Authorization": "Bearer your-bearer-token-here",
      "X-Custom-Header": "custom-value",
      "User-Agent": "A2A-Client-Example/1.0"
    }
  };

  const clientWithAuth = new A2AClient(
    "https://your-agent.example.com",
    ".well-known/agent-card.json",
    configWithToken
  );

  // Example 2: Client without initial token, then setting it later
  console.log("\n=== Example 2: Setting Token After Creation ===");
  
  const clientWithoutAuth = new A2AClient("https://your-agent.example.com");
  
  // Set bearer token via custom headers after creation
  clientWithoutAuth.setCustomHeader("Authorization", "Bearer new-bearer-token");
  
  // Add other custom headers
  clientWithoutAuth.setCustomHeaders({
    "X-API-Version": "2.0",
    "X-Client-ID": "example-client"
  });
  
  // Or set individual headers
  clientWithoutAuth.setCustomHeader("X-Request-ID", "req-123");

  // Example 3: Token rotation via custom headers
  console.log("\n=== Example 3: Token Rotation ===");
  
  const clientForRotation = new A2AClient(
    "https://your-agent.example.com",
    ".well-known/agent-card.json",
    { 
      customHeaders: {
        "Authorization": "Bearer initial-token"
      }
    }
  );

  // Simulate token rotation
  console.log("Initial token:", clientForRotation.getCustomHeaders()["Authorization"]);
  
  // Rotate token
  clientForRotation.setCustomHeader("Authorization", "Bearer rotated-token");
  console.log("Rotated token:", clientForRotation.getCustomHeaders()["Authorization"]);

  // Example 4: Using the client with authentication
  console.log("\n=== Example 4: Making Authenticated Requests ===");
  
  try {
    // Get agent card (will include Authorization header)
    const agentCard = await clientWithAuth.getAgentCard();
    console.log("Agent name:", agentCard.name);
    console.log("Agent capabilities:", agentCard.capabilities);

    // Send a message (will include Authorization header)
    const messageParams: MessageSendParams = {
      message: {
        messageId: "msg-123",
        role: "user",
        parts: [
          {
            kind: "text",
            text: "Hello, this is an authenticated request!"
          }
        ],
        kind: "message"
      },
      configuration: {
        blocking: true
      }
    };

    const response = await clientWithAuth.sendMessage(messageParams);
    console.log("Message sent successfully:", response);

  } catch (error) {
    console.error("Error making authenticated request:", error);
  }

  // Example 5: Managing custom headers
  console.log("\n=== Example 5: Custom Headers Management ===");
  
  const clientWithHeaders = new A2AClient("https://your-agent.example.com");
  
  // Set initial custom headers
  clientWithHeaders.setCustomHeaders({
    "X-Trace-ID": "trace-123",
    "X-Environment": "production",
    "Authorization": "Bearer my-token"
  });
  
  console.log("Initial custom headers:", clientWithHeaders.getCustomHeaders());
  
  // Add more headers
  clientWithHeaders.setCustomHeader("X-User-ID", "user-456");
  clientWithHeaders.setCustomHeader("X-Session-ID", "session-789");
  
  console.log("Updated custom headers:", clientWithHeaders.getCustomHeaders());
  
  // Override all headers
  clientWithHeaders.setCustomHeaders({
    "X-New-Header": "new-value",
    "X-Another-Header": "another-value",
    "Authorization": "Bearer new-token"
  });
  
  console.log("Replaced custom headers:", clientWithHeaders.getCustomHeaders());
}

// Run the example
main().catch(console.error);
