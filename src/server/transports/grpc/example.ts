import * as grpc from "@grpc/grpc-js";
import { constructGrpcService, a2AServiceDefinition } from "./index.js";
import { DefaultRequestHandler } from "../../request_handler/default_request_handler.js";
import { InMemoryTaskStore } from "../../store.js";
import { AgentExecutor } from "../../agent_execution/agent_executor.js";
import { RequestContext } from "../../agent_execution/request_context.js";
import { ExecutionEventBus } from "../../events/execution_event_bus.js";
import { TaskStatusUpdateEvent } from "../../../types.js";

/**
 * Example of how to use the A2A gRPC service
 */

// Create your request handler
const agentCard = {
	name: "Example Agent",
	description: "An example A2A agent using gRPC",
	url: "grpc://localhost:50051",
	version: "1.0.0",
	capabilities: {
		streaming: true,
		pushNotifications: false,
	},
	skills: [],
	defaultInputModes: ["text"],
	defaultOutputModes: ["text"],
};

// Create task store
const taskStore = new InMemoryTaskStore();

// Create a custom agent executor
const agentExecutor: AgentExecutor = {
	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus) {
		// Your message handling logic here
		console.log("Received message:", requestContext.userMessage);

		// Emit task status update
		const statusUpdate: TaskStatusUpdateEvent = {
			kind: 'status-update',
			taskId: requestContext.taskId,
			contextId: requestContext.contextId,
			status: {
				state: "completed",
				message: {
					kind: "message" as const,
					messageId: "msg-456",
					role: "agent" as const,
					parts: [
						{
							kind: "text" as const,
							text: "Hello from gRPC agent!",
						},
					],
				},
				timestamp: new Date().toISOString(),
			},
			final: true,
		};

		eventBus.publish(statusUpdate);
		eventBus.finished();
	},

	async cancelTask(taskId: string, eventBus: ExecutionEventBus) {
		// Handle task cancellation
		const cancelUpdate: TaskStatusUpdateEvent = {
			kind: 'status-update',
			taskId,
			contextId: "",
			status: {
				state: "canceled",
				timestamp: new Date().toISOString(),
			},
			final: true,
		};

		eventBus.publish(cancelUpdate);
		eventBus.finished();
	},
};

const requestHandler = new DefaultRequestHandler(
	agentCard,
	taskStore,
	agentExecutor,
);

// Create the gRPC service using the constructor function
const grpcService = constructGrpcService(requestHandler);

// Create and start the gRPC server
const server = new grpc.Server();
server.addService(a2AServiceDefinition, grpcService);

server.bindAsync(
	"0.0.0.0:50051",
	grpc.ServerCredentials.createInsecure(),
	(err, port) => {
		if (err) {
			console.error("Failed to bind server:", err);
			return;
		}
		console.log(`A2A gRPC server listening on port ${port}`);
	},
);
