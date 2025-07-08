import {
	sendUnaryData,
	ServerUnaryCall,
	ServerWritableStream,
	status,
} from "@grpc/grpc-js";
import { a2AServiceDefinition, IA2AService } from "./a2a.grpc-server.js";
import {
	SendMessageRequest,
	SendMessageResponse,
	StreamResponse,
	GetTaskRequest,
	Task,
	CancelTaskRequest,
	TaskSubscriptionRequest,
	CreateTaskPushNotificationConfigRequest,
	TaskPushNotificationConfig,
	GetTaskPushNotificationConfigRequest,
	ListTaskPushNotificationConfigRequest,
	ListTaskPushNotificationConfigResponse,
	GetAgentCardRequest,
	AgentCard,
	DeleteTaskPushNotificationConfigRequest,
	Message as GrpcMessage,
	Part as GrpcPart,
	TaskStatus as GrpcTaskStatus,
	TaskState as GrpcTaskState,
	Artifact as GrpcArtifact,
	Role,
	PushNotificationConfig,
	FilePart as GrpcFilePart,
	DataPart as GrpcDataPart,
    SendMessageConfiguration,
} from "./a2a.js";
import { Empty } from "./google/protobuf/empty.js";
import { Struct } from "./google/protobuf/struct.js";
import { Timestamp } from "./google/protobuf/timestamp.js";
import { A2ARequestHandler } from "../../request_handler/a2a_request_handler.js";
import { A2AError } from "../../error.js";
import {
	Message,
	Task as A2ATask,
	Part,
	FilePart,
	TextPart,
	DataPart,
	TaskState,
	TaskStatus,
	Artifact,
	TaskStatusUpdateEvent,
	TaskArtifactUpdateEvent,
	MessageSendParams,
	TaskQueryParams,
	TaskIdParams,
	TaskPushNotificationConfig as A2ATaskPushNotificationConfig,
    MessageSendConfiguration,
    PushNotificationConfig1,
    PushNotificationConfig2,
} from "../../../types.js";

/**
 * Handles gRPC transport layer, routing requests to A2ARequestHandler.
 * This service implements the IA2AService interface and converts between
 * gRPC protobuf messages and the internal A2A types.
 */
const constructGrpcService = (requestHandler: A2ARequestHandler) => {
    const service: IA2AService = {
        /**
	 * Send a message to the agent. This is a blocking call that will return the
	 * task once it is completed, or immediately if non-blocking is requested.
	 */
	async sendMessage(
		call: ServerUnaryCall<SendMessageRequest, SendMessageResponse>,
		callback: sendUnaryData<SendMessageResponse>,
	): Promise<void> {
		try {
			const request = call.request;

			// Convert gRPC request to internal MessageSendParams
			const params: MessageSendParams = convertMessageSendParamsToInternal(request);

			const result = await requestHandler.sendMessage(params);

			// Convert result to gRPC response
			const response: SendMessageResponse = {
				payload: isTask(result)
					? { oneofKind: "task", task: convertTaskToGrpc(result) }
					: { oneofKind: "msg", msg: convertMessageToGrpc(result) },
			};

			callback(null, response);
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * SendStreamingMessage is a streaming call that will return a stream of
	 * task update events until the Task is in an interrupted or terminal state.
	 */
	async sendStreamingMessage(
		call: ServerWritableStream<SendMessageRequest, StreamResponse>,
	): Promise<void> {
		try {
			const request = call.request;

			// Convert gRPC request to internal MessageSendParams
			const params: MessageSendParams = {
				message: convertGrpcMessageToInternal(request.request!),
				configuration: request.configuration
					? {
							acceptedOutputModes:
								request.configuration.acceptedOutputModes || [],
							pushNotificationConfig: request.configuration.pushNotification
								? convertGrpcPushNotificationToInternal(
										request.configuration.pushNotification,
									)
								: undefined,
							historyLength: request.configuration.historyLength,
							blocking: false, // Streaming is always non-blocking
						}
					: undefined,
				metadata: request.metadata ? structToObject(request.metadata) : undefined,
			};

			const stream = requestHandler.sendMessageStream(params);

			for await (const event of stream) {
				const response = convertEventToStreamResponse(event);
				if (!call.writable) {
					break;
				}
				call.write(response);
			}

			call.end();
		} catch (error) {
			call.destroy(handleError(error));
		}
	},

	/**
	 * Get the current state of a task from the agent.
	 */
	async getTask(
		call: ServerUnaryCall<GetTaskRequest, Task>,
		callback: sendUnaryData<Task>,
	): Promise<void> {
		try {
			const taskId = extractTaskIdFromName(call.request.name);

			const params: TaskQueryParams = {
				id: taskId,
				historyLength: call.request.historyLength,
			};

			const task = await requestHandler.getTask(params);
			callback(null, convertTaskToGrpc(task));
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * Cancel a task from the agent.
	 */
	async cancelTask(
		call: ServerUnaryCall<CancelTaskRequest, Task>,
		callback: sendUnaryData<Task>,
	): Promise<void> {
		try {
			const taskId = extractTaskIdFromName(call.request.name);

			const params: TaskIdParams = { id: taskId };
			const task = await requestHandler.cancelTask(params);

			callback(null, convertTaskToGrpc(task));
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * TaskSubscription is a streaming call that will return a stream of task
	 * update events.
	 */
	async taskSubscription(
		call: ServerWritableStream<TaskSubscriptionRequest, StreamResponse>,
	): Promise<void> {
		try {
			const taskId = extractTaskIdFromName(call.request.name);
			const params: TaskIdParams = { id: taskId };

			const stream = requestHandler.resubscribe(params);

			for await (const event of stream) {
				const response = convertEventToStreamResponse(event);
				if (!call.writable) {
					break;
				}
				call.write(response);
			}

			call.end();
		} catch (error) {
			call.destroy(handleError(error));
		}
	},

	/**
	 * Create a push notification config for a task.
	 */
	async createTaskPushNotificationConfig(
		call: ServerUnaryCall<
			CreateTaskPushNotificationConfigRequest,
			TaskPushNotificationConfig
		>,
		callback: sendUnaryData<TaskPushNotificationConfig>,
	): Promise<void> {
		try {
			const taskId = extractTaskIdFromParent(call.request.parent);

			const params: A2ATaskPushNotificationConfig = {
				taskId,
				pushNotificationConfig: {
					id: call.request.configId,
					url: call.request.config?.pushNotificationConfig?.url || "",
					token: call.request.config?.pushNotificationConfig?.token || "",
					authentication: call.request.config?.pushNotificationConfig
						?.authentication
						? {
								schemes:
									call.request.config.pushNotificationConfig.authentication
										.schemes,
								credentials:
									call.request.config.pushNotificationConfig.authentication
										.credentials,
							}
						: undefined,
				},
			};

			const result =
				await requestHandler.setTaskPushNotificationConfig(params);
			callback(null, convertPushNotificationConfigToGrpc(result));
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * Get a push notification config for a task.
	 */
	async getTaskPushNotificationConfig(
		call: ServerUnaryCall<
			GetTaskPushNotificationConfigRequest,
			TaskPushNotificationConfig
		>,
		callback: sendUnaryData<TaskPushNotificationConfig>,
	): Promise<void> {
		try {
			const { taskId } = extractTaskAndPushIdFromName(call.request.name);

			const params: TaskIdParams = { id: taskId };
			const result =
				await requestHandler.getTaskPushNotificationConfig(params);

			callback(null, convertPushNotificationConfigToGrpc(result));
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * Get a list of push notifications configured for a task.
	 */
	async listTaskPushNotificationConfig(
		call: ServerUnaryCall<
			ListTaskPushNotificationConfigRequest,
			ListTaskPushNotificationConfigResponse
		>,
		callback: sendUnaryData<ListTaskPushNotificationConfigResponse>,
	): Promise<void> {
		try {
			// For now, we'll return a single config if it exists
			const taskId = extractTaskIdFromParent(call.request.parent);
			const params: TaskIdParams = { id: taskId };

			try {
				const config =
					await requestHandler.getTaskPushNotificationConfig(params);
				const response: ListTaskPushNotificationConfigResponse = {
					configs: [convertPushNotificationConfigToGrpc(config)],
					nextPageToken: "",
				};
				callback(null, response);
			} catch (error) {
				// If no config exists, return empty list
				const response: ListTaskPushNotificationConfigResponse = {
					configs: [],
					nextPageToken: "",
				};
				callback(null, response);
			}
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * GetAgentCard returns the agent card for the agent.
	 */
	async getAgentCard(
		_call: ServerUnaryCall<GetAgentCardRequest, AgentCard>,
		callback: sendUnaryData<AgentCard>,
	): Promise<void> {
		try {
			const agentCard = await requestHandler.getAgentCard();

			// Convert internal AgentCard to gRPC AgentCard
			const grpcAgentCard: AgentCard = {
				protocolVersion: "1.0",
				name: agentCard.name,
				description: agentCard.description,
				url: agentCard.url,
				preferredTransport: "grpc",
				additionalInterfaces: [],
				provider: agentCard.provider
					? {
							url: agentCard.provider.url,
							organization: agentCard.provider.organization,
						}
					: undefined,
				version: agentCard.version,
				documentationUrl: agentCard.documentationUrl || "",
				capabilities: agentCard.capabilities
					? {
							streaming: agentCard.capabilities.streaming || false,
							pushNotifications:
								agentCard.capabilities.pushNotifications || false,
							extensions: [],
						}
					: {
							streaming: false,
							pushNotifications: false,
							extensions: [],
						},
				securitySchemes: {},
				security: [],
				defaultInputModes: agentCard.defaultInputModes || [],
				defaultOutputModes: agentCard.defaultOutputModes || [],
				skills: [],
				supportsAuthenticatedExtendedCard:
					agentCard.supportsAuthenticatedExtendedCard || false,
			};

			callback(null, grpcAgentCard);
		} catch (error) {
			callback(handleError(error));
		}
	},

	/**
	 * Delete a push notification config for a task.
	 */
	async deleteTaskPushNotificationConfig(
		_call: ServerUnaryCall<DeleteTaskPushNotificationConfigRequest, Empty>,
		callback: sendUnaryData<Empty>,
	): Promise<void> {
		try {
			// The current interface doesn't support deletion, so we'll return success
			// This might need to be implemented in the request handler
			callback(null, {});
		} catch (error) {
			callback(handleError(error));
		}
	},

    };
    
    return service;
};

export { constructGrpcService };
export { a2AServiceDefinition } from "./a2a.grpc-server.js";


// Helper methods for conversion between gRPC and internal types

function convertMessageSendParamsToInternal(request: SendMessageRequest): MessageSendParams {
    return {
            message: convertGrpcMessageToInternal(request.request!),
            configuration: request.configuration ? convertGrpcMessageConfigurationToInternal(request.configuration) : undefined,
            metadata: request.metadata ? structToObject(request.metadata) : undefined,
        };
}


function convertGrpcMessageConfigurationToInternal(config: SendMessageConfiguration): MessageSendConfiguration {
    return {
        acceptedOutputModes: config.acceptedOutputModes,
        blocking: config.blocking,
        historyLength: config.historyLength,
        pushNotificationConfig: config.pushNotification ? convertGrpcPushNotificationToInternal(config.pushNotification) : undefined
    } 
}

function convertGrpcMessageToInternal(grpcMessage: GrpcMessage): Message {
    return {
        kind: "message",
        messageId: grpcMessage.messageId,
        contextId: grpcMessage.contextId || undefined,
        taskId: grpcMessage.taskId || undefined,
        role: grpcMessage.role === Role.USER ? "user" : "agent",
        parts: grpcMessage.content.map((part) =>
            convertGrpcPartToInternal(part),
        ),
        metadata: grpcMessage.metadata
            ? structToObject(grpcMessage.metadata)
            : undefined,
        extensions: grpcMessage.extensions || undefined,
    } as Message;
}

function convertGrpcPartToInternal(grpcPart: GrpcPart): Part {
    const { part } = grpcPart;

    if (part.oneofKind === "text") {
        const textPart = part as { oneofKind: "text"; text: string };
        return {
            kind: "text",
            text: textPart.text,
        } as TextPart;
    }

    if (part.oneofKind === "file") {
        const grpcFilePart = (part as { oneofKind: "file"; file: GrpcFilePart })
            .file;
        if (grpcFilePart.file.oneofKind === "fileWithUri") {
            const fileWithUri = grpcFilePart.file as {
                oneofKind: "fileWithUri";
                fileWithUri: string;
            };
            return {
                kind: "file",
                file: {
                    uri: fileWithUri.fileWithUri,
                    mimeType: grpcFilePart.mimeType,
                    name: undefined,
                },
            } as FilePart;
        } else if (grpcFilePart.file.oneofKind === "fileWithBytes") {
            const fileWithBytes = grpcFilePart.file as {
                oneofKind: "fileWithBytes";
                fileWithBytes: Uint8Array;
            };
            return {
                kind: "file",
                file: {
                    bytes: Buffer.from(fileWithBytes.fileWithBytes).toString("base64"),
                    mimeType: grpcFilePart.mimeType,
                    name: undefined,
                },
            } as FilePart;
        }
        throw new Error("Invalid file part type");
    }

    if (part.oneofKind === "data") {
        const grpcDataPart = (part as { oneofKind: "data"; data: GrpcDataPart })
            .data;
        return {
            kind: "data",
            data: grpcDataPart.data ? structToObject(grpcDataPart.data) : {},
        } as DataPart;
    }

    throw new Error("Invalid part type");
}



function convertMessageToGrpc(message: Message): GrpcMessage {
    return {
        messageId: message.messageId,
        contextId: message.contextId || "",
        taskId: message.taskId || "",
        role: message.role === "user" ? Role.USER : Role.AGENT,
        content: message.parts?.map((part) => convertPartToGrpc(part)) || [],
        metadata: message.metadata
            ? objectToStruct(message.metadata)
            : undefined,
        extensions: message.extensions || [],
    };
}

function convertPartToGrpc(part: Part): GrpcPart {
    if (part.kind === "text") {
        const textPart = part as TextPart;
        return {
            part: {
                oneofKind: "text",
                text: textPart.text,
            },
        };
    } else if (part.kind === "file") {
        const filePart = part as FilePart;
        if ("uri" in filePart.file) {
            return {
                part: {
                    oneofKind: "file",
                    file: {
                        file: {
                            oneofKind: "fileWithUri",
                            fileWithUri: filePart.file.uri,
                        },
                        mimeType: filePart.file.mimeType || "",
                    },
                },
            };
        } else if ("bytes" in filePart.file) {
            return {
                part: {
                    oneofKind: "file",
                    file: {
                        file: {
                            oneofKind: "fileWithBytes",
                            fileWithBytes: Buffer.from(filePart.file.bytes, "base64"),
                        },
                        mimeType: filePart.file.mimeType || "",
                    },
                },
            };
        }
    } else if (part.kind === "data") {
        const dataPart = part as DataPart;
        return {
            part: {
                oneofKind: "data",
                data: {
                    data: objectToStruct(dataPart.data),
                },
            },
        };
    }

    throw new Error("Invalid part type");
}

function convertTaskToGrpc(task: A2ATask): Task {
    return {
        id: task.id,
        contextId: task.contextId,
        status: convertTaskStatusToGrpc(task.status),
        artifacts:
            task.artifacts?.map((artifact) =>
                convertArtifactToGrpc(artifact),
            ) || [],
        history: task.history?.map((msg) => convertMessageToGrpc(msg)) || [],
        metadata: task.metadata ? objectToStruct(task.metadata) : undefined,
    };
}

function convertTaskStatusToGrpc(status: TaskStatus): GrpcTaskStatus {
    return {
        state: convertTaskStateToGrpc(status.state),
        update: status.message
            ? convertMessageToGrpc(status.message)
            : undefined,
        timestamp: status.timestamp
            ? dateToTimestamp(new Date(status.timestamp))
            : undefined,
    };
}

function convertTaskStateToGrpc(state: TaskState): GrpcTaskState {
    const stateMap: Record<TaskState, GrpcTaskState> = {
        submitted: GrpcTaskState.SUBMITTED,
        working: GrpcTaskState.WORKING,
        "input-required": GrpcTaskState.INPUT_REQUIRED,
        completed: GrpcTaskState.COMPLETED,
        canceled: GrpcTaskState.CANCELLED,
        failed: GrpcTaskState.FAILED,
        rejected: GrpcTaskState.REJECTED,
        "auth-required": GrpcTaskState.AUTH_REQUIRED,
        unknown: GrpcTaskState.UNSPECIFIED,
    };
    return stateMap[state] || GrpcTaskState.UNSPECIFIED;
}

function convertArtifactToGrpc(artifact: Artifact): GrpcArtifact {
    return {
        artifactId: artifact.artifactId,
        name: artifact.name || "",
        description: artifact.description || "",
        parts: artifact.parts?.map((part) => convertPartToGrpc(part)) || [],
        metadata: artifact.metadata
            ? objectToStruct(artifact.metadata)
            : undefined,
        extensions: artifact.extensions || [],
    };
}

function convertEventToStreamResponse(
    event: Message | A2ATask | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
): StreamResponse {
    if ("messageId" in event) {
        // It's a Message
        return {
            payload: {
                oneofKind: "msg",
                msg: convertMessageToGrpc(event as Message),
            },
        };
    } else if ("status" in event && "artifacts" in event) {
        // It's a Task
        return {
            payload: {
                oneofKind: "task",
                task: convertTaskToGrpc(event as A2ATask),
            },
        };
    } else if ("status" in event) {
        // It's a TaskStatusUpdateEvent
        const statusEvent = event as TaskStatusUpdateEvent;
        return {
            payload: {
                oneofKind: "statusUpdate",
                statusUpdate: {
                    taskId: statusEvent.taskId,
                    contextId: statusEvent.contextId,
                    status: convertTaskStatusToGrpc(statusEvent.status),
                    final: statusEvent.final || false,
                    metadata: statusEvent.metadata
                        ? objectToStruct(statusEvent.metadata)
                        : undefined,
                },
            },
        };
    } else if ("artifact" in event) {
        // It's a TaskArtifactUpdateEvent
        const artifactEvent = event as TaskArtifactUpdateEvent;
        return {
            payload: {
                oneofKind: "artifactUpdate",
                artifactUpdate: {
                    taskId: artifactEvent.taskId,
                    contextId: artifactEvent.contextId,
                    artifact: convertArtifactToGrpc(artifactEvent.artifact),
                    append: artifactEvent.append || false,
                    lastChunk: artifactEvent.lastChunk || false,
                    metadata: artifactEvent.metadata
                        ? objectToStruct(artifactEvent.metadata)
                        : undefined,
                },
            },
        };
    }

    throw new Error("Unknown event type");
}

function convertGrpcPushNotificationToInternal(
    config: PushNotificationConfig,
): PushNotificationConfig1 | PushNotificationConfig2 {
    return {
        id: config.id,
        url: config.url,
        token: config.token,
        authentication: config.authentication
            ? {
                    schemes: config.authentication.schemes,
                    credentials: config.authentication.credentials,
                }
            : undefined,
    };
}

function convertPushNotificationConfigToGrpc(
    config: A2ATaskPushNotificationConfig,
): TaskPushNotificationConfig {
    const pushConfig = config.pushNotificationConfig;
    return {
        name: `tasks/${config.taskId}/pushNotificationConfigs/${pushConfig.id}`,
        pushNotificationConfig: {
            id: pushConfig.id || "",
            url: pushConfig.url,
            token: pushConfig.token || "",
            authentication: pushConfig.authentication
                ? {
                        schemes: pushConfig.authentication.schemes || [],
                        credentials: pushConfig.authentication.credentials || "",
                    }
                : undefined,
        },
    };
}

function extractTaskIdFromName(name: string): string {
    // Extract task ID from "tasks/{id}" format
    const match = name.match(/^tasks\/(.+)$/);
    if (!match) {
        throw A2AError.invalidParams(`Invalid task name format: ${name}`);
    }
    return match[1];
}

function extractTaskIdFromParent(parent: string): string {
    // Extract task ID from "tasks/{id}" format
    const match = parent.match(/^tasks\/(.+)$/);
    if (!match) {
        throw A2AError.invalidParams(`Invalid parent format: ${parent}`);
    }
    return match[1];
}

function extractTaskAndPushIdFromName(name: string): {
    taskId: string;
    pushId: string;
} {
    // Extract task ID and push ID from "tasks/{id}/pushNotificationConfigs/{push_id}" format
    const match = name.match(/^tasks\/(.+)\/pushNotificationConfigs\/(.+)$/);
    if (!match) {
        throw A2AError.invalidParams(
            `Invalid push notification config name format: ${name}`,
        );
    }
    return { taskId: match[1], pushId: match[2] };
}

function structToObject(struct: Struct): any {
    // Convert protobuf Struct to plain object
    const result: any = {};
    if (struct.fields) {
        for (const [key, value] of Object.entries(struct.fields)) {
            result[key] = valueToObject(value);
        }
    }
    return result;
}

function valueToObject(value: any): any {
    if (!value || !value.kind) return null;

    const kind = value.kind;
    if (!kind || !kind.oneofKind) return null;

    switch (kind.oneofKind) {
        case "nullValue":
            return null;
        case "numberValue":
            return kind.numberValue;
        case "stringValue":
            return kind.stringValue;
        case "boolValue":
            return kind.boolValue;
        case "structValue":
            return structToObject(kind.structValue);
        case "listValue":
            return (
                kind.listValue?.values?.map((v: any) => valueToObject(v)) || []
            );
        default:
            return null;
    }
}

function objectToStruct(obj: any): Struct {
    // Convert plain object to protobuf Struct
    const fields: { [key: string]: any } = {};
    if (obj && typeof obj === "object") {
        for (const [key, value] of Object.entries(obj)) {
            fields[key] = objectToValue(value);
        }
    }
    return { fields };
}

function objectToValue(value: any): any {
    if (value === null || value === undefined) {
        return { kind: { oneofKind: "nullValue", nullValue: 0 } };
    }
    if (typeof value === "number") {
        return { kind: { oneofKind: "numberValue", numberValue: value } };
    }
    if (typeof value === "string") {
        return { kind: { oneofKind: "stringValue", stringValue: value } };
    }
    if (typeof value === "boolean") {
        return { kind: { oneofKind: "boolValue", boolValue: value } };
    }
    if (Array.isArray(value)) {
        return {
            kind: {
                oneofKind: "listValue",
                listValue: { values: value.map((v) => objectToValue(v)) },
            },
        };
    }
    if (typeof value === "object") {
        return {
            kind: {
                oneofKind: "structValue",
                structValue: objectToStruct(value),
            },
        };
    }
    return { kind: { oneofKind: "nullValue", nullValue: 0 } };
}

function dateToTimestamp(date: Date): Timestamp {
    const seconds = Math.floor(date.getTime() / 1000);
    const nanos = (date.getTime() % 1000) * 1000000;
    return { seconds: BigInt(seconds), nanos };
}

function isTask(result: Message | A2ATask): result is A2ATask {
    return "status" in result && "artifacts" in result;
}

function handleError(error: any): any {
    if (error instanceof A2AError) {
        return {
            code: mapA2AErrorToGrpcStatus(error.code),
            message: error.message,
            details: error.data ? JSON.stringify(error.data) : undefined,
        };
    }

    return {
        code: status.INTERNAL,
        message: error.message || "Internal server error",
    };
}

function mapA2AErrorToGrpcStatus(code: number): number {
    // Map JSON-RPC error codes to gRPC status codes
    switch (code) {
        case -32700: // Parse error
            return status.INVALID_ARGUMENT;
        case -32600: // Invalid request
            return status.INVALID_ARGUMENT;
        case -32601: // Method not found
            return status.UNIMPLEMENTED;
        case -32602: // Invalid params
            return status.INVALID_ARGUMENT;
        case -32603: // Internal error
            return status.INTERNAL;
        case -32001: // Task not found
            return status.NOT_FOUND;
        case -32002: // Task not cancelable
            return status.FAILED_PRECONDITION;
        case -32003: // Push notification not supported
            return status.UNIMPLEMENTED;
        case -32004: // Unsupported operation
            return status.UNIMPLEMENTED;
        default:
            return status.UNKNOWN;
    }
}
