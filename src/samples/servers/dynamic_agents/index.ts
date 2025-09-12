import express from 'express';
import { 
    DynamicAgentRequestHandler, 
    RouteContext
} from '../../../server/index.js';
import { AgentCard, Message, TextPart } from '../../../types.js';
import { InMemoryTaskStore } from '../../../server/store.js';
import { AgentExecutor } from '../../../server/agent_execution/agent_executor.js';
import { A2AExpressApp } from '../../../server/express/a2a_express_app.js';
import { RequestContext } from '../../../server/agent_execution/request_context.js';
import { ExecutionEventBus } from '../../../server/events/execution_event_bus.js';
import { v4 as uuidv4 } from 'uuid';

// Simple agent cards for calculator and weather
const calculatorAgentCard: AgentCard = {
    name: 'Calculator Agent',
    description: 'Performs mathematical calculations',
    version: '1.0.0', 
    protocolVersion: '2024-11-05',
    capabilities: {
        streaming: true,
        pushNotifications: false,
    },
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    url: "http://localhost:3000/agents/calculator"
};

const weatherAgentCard: AgentCard = {
    name: 'Weather Agent',
    description: 'Provides weather information and forecasts',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    capabilities: {
        streaming: true,
        pushNotifications: false,
    },
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    url: "http://localhost:3000/agents/weather"
};

// Calculator agent that performs basic math operations
class CalculatorAgentExecutor implements AgentExecutor {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        const userMessage = requestContext.userMessage;
        console.log(`Calculator processing: ${JSON.stringify(userMessage.parts)}`);
        
        // Extract text from user message
        const textParts = userMessage.parts.filter(part => part.kind === 'text');
        const userText = textParts.map(part => (part as TextPart).text).join(' ');
        
        // Simple calculation logic
        let result: string;
        try {
            // Look for basic math expressions
            const mathMatch = userText.match(/(\d+\.?\d*)\s*([\+\-\*\/])\s*(\d+\.?\d*)/);
            if (mathMatch) {
                const [, num1, operator, num2] = mathMatch;
                const a = parseFloat(num1);
                const b = parseFloat(num2);
                
                switch (operator) {
                    case '+': result = `${a} + ${b} = ${a + b}`; break;
                    case '-': result = `${a} - ${b} = ${a - b}`; break;
                    case '*': result = `${a} × ${b} = ${a * b}`; break;
                    case '/': result = b !== 0 ? `${a} ÷ ${b} = ${a / b}` : 'Error: Division by zero'; break;
                    default: result = 'Unknown operation';
                }
            } else {
                result = "I can help you with basic math! Try asking me something like '2 + 2' or '10 * 5'.";
            }
        } catch (error) {
            result = 'Sorry, I had trouble understanding that math expression.';
        }
        
        // Create response message
        const responseMessage: Message = {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: result }],
            taskId: requestContext.taskId,
            contextId: userMessage.contextId,
        };
        
        // Publish the response
        eventBus.publish(responseMessage);
        eventBus.finished();
    }
    
    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
        console.log(`Canceling calculation task: ${taskId}`);
        eventBus.finished();
    }
}

// Weather agent that provides fake weather information
class WeatherAgentExecutor implements AgentExecutor {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        const userMessage = requestContext.userMessage;
        console.log(`Weather agent processing: ${JSON.stringify(userMessage.parts)}`);
        
        // Extract text from user message
        const textParts = userMessage.parts.filter(part => part.kind === 'text');
        const userText = textParts.map(part => (part as TextPart).text).join(' ').toLowerCase();
        
        // Simple weather response logic
        let result: string;
        const cities = ['london', 'paris', 'tokyo', 'new york', 'sydney'];
        const foundCity = cities.find(city => userText.includes(city));
        
        if (foundCity) {
            const temp = Math.floor(Math.random() * 30) + 5; // Random temp between 5-35°C
            const conditions = ['sunny', 'cloudy', 'rainy', 'partly cloudy'][Math.floor(Math.random() * 4)];
            result = `The weather in ${foundCity.charAt(0).toUpperCase() + foundCity.slice(1)} is currently ${temp}°C and ${conditions}. (This is fake data for demonstration purposes!)`;
        } else {
            result = "I can provide weather information! Try asking about the weather in London, Paris, Tokyo, New York, or Sydney.";
        }
        
        // Create response message
        const responseMessage: Message = {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: result }],
            taskId: requestContext.taskId,
            contextId: userMessage.contextId,
        };
        
        // Publish the response
        eventBus.publish(responseMessage);
        eventBus.finished();
    }
    
    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
        console.log(`Canceling weather task: ${taskId}`);
        eventBus.finished();
    }
}

// Create shared instances for persistence across requests
const taskStore = new InMemoryTaskStore();
const calculatorExecutor = new CalculatorAgentExecutor();
const weatherExecutor = new WeatherAgentExecutor();

// Create the dynamic request handler
const dynamicHandler = new DynamicAgentRequestHandler(
    // Agent card resolver - determines which agent card to use based on route
    async (route: RouteContext) => {
        console.log(`Resolving agent card for route: ${route.url}`);
        
        // For other requests, check path segments
        if (route.url.includes('calculator')) {
            return calculatorAgentCard;
        } else if (route.url.includes('weather')) {
            return weatherAgentCard;
        }
        
        throw new Error("request for invalid agent");
    },
    
    // Task store resolver - same store instance for all agents to ensure persistence  
    async (route: RouteContext) => {
        return taskStore;
    },
    
    // Agent executor resolver - returns singleton instances for efficiency
    async (route: RouteContext) => {
        console.log(`Resolving agent executor for route: ${route.url}`);
        
        if (route.url.includes('calculator')) {
            return calculatorExecutor;
        } else if (route.url.includes('weather')) {
            return weatherExecutor;
        }
        
        throw new Error("request for invalid agent");
    }
);

// Create the A2A Express app - dynamic routing is auto-detected from the handler
const appBuilder = new A2AExpressApp(dynamicHandler);
const app = appBuilder.setupRoutes(express(), '/agents');

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server started on http://localhost:${PORT}`);
    console.log('\nThe dynamic handler will route based on URL context.');
    console.log('Try accessing different URLs to see dynamic routing in action!');
});

// That's it! Simple and clean - just like the original A2A pattern.
// The dynamic handler inspects the request context to determine routing.