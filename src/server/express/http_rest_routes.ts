import express, { Request, Response, Router, RequestHandler } from "express";
import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { A2AError } from "../error.js";
import { TaskQueryParams, TaskIdParams } from "../../types.js";

export interface HttpRestHandlerOptions {
    requestHandler: A2ARequestHandler;
}

/**
 * HTTP status codes used in REST responses.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
} as const;

/**
 * A2A JSON-RPC error codes mapped to their semantic meaning.
 * @see A2A Protocol specification
 */
const A2A_ERROR_CODE = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    TASK_NOT_FOUND: -32001,
    TASK_NOT_CANCELABLE: -32002,
    PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
    UNSUPPORTED_OPERATION: -32004,
    UNAUTHORIZED: -32005,
} as const;

/**
 * Server-Sent Events (SSE) headers configuration.
 */
const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering (nginx)
} as const;

/**
 * Route patterns for A2A REST API.
 * Using regex for routes with colon-suffixed actions (e.g., /message:send)
 * because Express interprets colons as parameter markers.
 */
const ROUTE_PATTERN = {
    MESSAGE_ACTION: /^\/v1\/message:(send|stream)$/i,
    TASK_ACTION: /^\/v1\/tasks\/([^\/\:]+):([a-z]+)$/i,
} as const;

/**
 * Valid action names for message and task operations.
 */
const ACTION = {
    SEND: 'send',
    STREAM: 'stream',
    CANCEL: 'cancel',
    SUBSCRIBE: 'subscribe',
} as const;

/**
 * Parsed action from a route path.
 */
interface ParsedAction {
    action: string;
    taskId?: string;
}

/**
 * Route handler function signature with proper error handling.
 */
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Creates Express.js middleware to handle A2A HTTP+REST requests.
 * 
 * This handler implements the A2A REST API specification, providing
 * endpoints for agent card retrieval, message sending (with optional streaming),
 * task management, and push notification configuration.
 * 
 * @param options - Configuration options including the request handler
 * @returns An Express router configured with all A2A REST endpoints
 * 
 * @example
 * ```typescript
 * // With an existing A2ARequestHandler instance:
 * app.use('/a2a/api', httpRestHandler({ requestHandler: a2aRequestHandler }));
 * ```
 */
export function httpRestHandler(
    options: HttpRestHandlerOptions
): RequestHandler {
    const router = express.Router();
    const { requestHandler } = options;
    
    // Parse JSON bodies for REST endpoints
    router.use(express.json());

    /**
     * Sends a JSON response with the specified status code.
     * Handles the special case of 204 No Content by omitting the response body.
     * 
     * @param res - Express response object
     * @param statusCode - HTTP status code
     * @param body - Response body (omitted for 204 responses)
     */
    const sendResponse = (res: Response, statusCode: number, body?: unknown): void => {
        res.status(statusCode);
        if (statusCode === HTTP_STATUS.NO_CONTENT) {
            res.end();
        } else {
            res.json(body);
        }
    };

    /**
     * Sends a Server-Sent Events (SSE) stream response.
     * 
     * SSE is used for real-time streaming of agent responses and task updates.
     * Each event is formatted according to the SSE specification with an ID and data field.
     * 
     * **Error Handling:**
     * - Stream errors are caught and sent as SSE error events
     * - Connection is gracefully closed on completion or error
     * - Headers are flushed immediately to establish the SSE connection
     * 
     * @param res - Express response object
     * @param stream - Async generator yielding events to stream
     * 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
     */
    const sendStreamResponse = async (
        res: Response, 
        stream: AsyncGenerator<unknown, void, undefined>
    ): Promise<void> => {
        // Set SSE headers
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
            res.setHeader(key, value);
        });
        res.flushHeaders();

        try {
            // Stream events to client
            for await (const event of stream) {
                // Use timestamp as event ID for client-side deduplication
                res.write(`id: ${Date.now()}\n`);
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
        } catch (streamError: unknown) {
            console.error('SSE streaming error:', streamError);
            
            // Convert to A2A error format
            const a2aError = streamError instanceof A2AError 
                ? streamError 
                : A2AError.internalError(
                    streamError instanceof Error ? streamError.message : 'Streaming error'
                );
            
            // Send error event if connection is still open
            if (!res.writableEnded) {
                res.write(`event: error\n`);
                res.write(`data: ${JSON.stringify(a2aError.toJSONRPCError())}\n\n`);
            }
        } finally {
            // Ensure connection is closed
            if (!res.writableEnded) {
                res.end();
            }
        }
    };

    /**
     * Maps A2A JSON-RPC error codes to appropriate HTTP status codes.
     * 
     * This mapping ensures that REST clients receive semantically correct
     * HTTP status codes while maintaining A2A error information in the response body.
     * 
     * @param errorCode - A2A JSON-RPC error code
     * @returns HTTP status code
     */
    const mapErrorToStatus = (errorCode: number): number => {
        switch (errorCode) {
            case A2A_ERROR_CODE.PARSE_ERROR:
            case A2A_ERROR_CODE.INVALID_REQUEST:
            case A2A_ERROR_CODE.INVALID_PARAMS:
                return HTTP_STATUS.BAD_REQUEST;
            
            case A2A_ERROR_CODE.METHOD_NOT_FOUND:
            case A2A_ERROR_CODE.TASK_NOT_FOUND:
                return HTTP_STATUS.NOT_FOUND;
            
            case A2A_ERROR_CODE.TASK_NOT_CANCELABLE:
                return HTTP_STATUS.CONFLICT;
            
            case A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED:
            case A2A_ERROR_CODE.UNSUPPORTED_OPERATION:
                return HTTP_STATUS.NOT_IMPLEMENTED;
            
            case A2A_ERROR_CODE.UNAUTHORIZED:
                return HTTP_STATUS.UNAUTHORIZED;
            
            default:
                return HTTP_STATUS.INTERNAL_SERVER_ERROR;
        }
    };

    /**
     * Centralized error handler for all routes.
     * 
     * Converts any error to an A2A error format, maps to appropriate HTTP status,
     * and sends the response. Handles the case where headers have already been sent.
     * 
     * @param res - Express response object
     * @param error - Error to handle (A2AError or generic Error)
     */
    const handleError = (res: Response, error: unknown): void => {
        // If headers already sent (e.g., during SSE), just close connection
        if (res.headersSent) {
            if (!res.writableEnded) {
                res.end();
            }
            return;
        }
        
        // Normalize to A2AError
        const a2aError = error instanceof A2AError 
            ? error 
            : A2AError.internalError(
                error instanceof Error ? error.message : 'Internal server error'
            );
        
        // Send error response with appropriate HTTP status
        const statusCode = mapErrorToStatus(a2aError.code);
        sendResponse(res, statusCode, a2aError.toJSONRPCError());
    };

    /**
     * Checks if the agent supports a specific capability.
     * 
     * @param capability - Capability name to check
     * @throws A2AError if capability is not supported
     */
    const requireCapability = async (
        capability: 'streaming' | 'pushNotifications'
    ): Promise<void> => {
        const agentCard = await requestHandler.getAgentCard();
        
        if (!agentCard.capabilities?.[capability]) {
            const errorMessage = capability === 'streaming'
                ? 'Agent does not support streaming'
                : 'Agent does not support push notifications';
            
            throw capability === 'pushNotifications'
                ? A2AError.pushNotificationNotSupported()
                : A2AError.unsupportedOperation(errorMessage);
        }
    };

    /**
     * Extracts and validates the action name from a route path.
     * 
     * @param path - Request path
     * @param pattern - Regex pattern to match
     * @param groupIndex - Regex group index for action (default: 1)
     * @returns Parsed action and optional taskId
     * @throws A2AError if path doesn't match pattern
     */
    const extractAction = (
        path: string, 
        pattern: RegExp,
        groupIndex: number = 1
    ): ParsedAction => {
        const match = path.match(pattern);
        
        if (!match) {
            throw A2AError.methodNotFound('Invalid action path');
        }
        
        // For task actions: match[1] = taskId, match[2] = action
        // For message actions: match[1] = action
        return pattern === ROUTE_PATTERN.TASK_ACTION
            ? { taskId: match[1], action: match[2] }
            : { action: match[groupIndex] };
    };

    /**
     * Validates and parses the historyLength query parameter.
     * 
     * @param value - Query parameter value
     * @returns Parsed integer value
     * @throws A2AError if value is invalid
     */
    const parseHistoryLength = (value: unknown): number => {
        if (value === undefined || value === null) {
            throw A2AError.invalidParams('historyLength is required');
        }
        
        const parsed = parseInt(String(value), 10);
        
        if (isNaN(parsed)) {
            throw A2AError.invalidParams('historyLength must be a valid integer');
        }
        
        if (parsed < 0) {
            throw A2AError.invalidParams('historyLength must be non-negative');
        }
        
        return parsed;
    };

    /**
     * Wraps a route handler with try-catch for consistent error handling.
     * 
     * This eliminates the need for repetitive try-catch blocks in every route.
     * 
     * @param handler - Async route handler function
     * @returns Wrapped handler with error handling
     */
    const asyncHandler = (handler: AsyncRouteHandler): AsyncRouteHandler => {
        return async (req: Request, res: Response): Promise<void> => {
            try {
                await handler(req, res);
            } catch (error) {
                handleError(res, error);
            }
        };
    };


    /**
     * GET /v1/card
     * 
     * Retrieves the authenticated extended agent card.
     * The extended card may include additional authentication-specific metadata.
     * 
     * @returns 200 OK with agent card
     * @returns 401 Unauthorized if authentication fails
     * @returns 500 Internal Server Error on failure
     */
    router.get('/v1/card', asyncHandler(async (req, res) => {
        const result = await requestHandler.getAuthenticatedExtendedAgentCard();
        sendResponse(res, HTTP_STATUS.OK, result);
    }));

    /**
     * POST /v1/message:send
     * POST /v1/message:stream
     * 
     * Sends a message to the agent with optional streaming response.
     * 
     * - :send returns a complete response (Task or Message)
     * - :stream returns an SSE stream of incremental updates
     * 
     * @body MessageSendParams - Message parameters including message content
     * @returns 201 Created with Task/Message for :send
     * @returns 200 OK with SSE stream for :stream
     * @returns 400 Bad Request if message is invalid
     * @returns 501 Not Implemented if streaming not supported (for :stream)
     */
    router.post(ROUTE_PATTERN.MESSAGE_ACTION, asyncHandler(async (req, res) => {
        const { action } = extractAction(req.path, ROUTE_PATTERN.MESSAGE_ACTION);
        
        switch (action) {
            case ACTION.STREAM:
                await requireCapability('streaming');
                const stream = await requestHandler.sendMessageStream(req.body);
                await sendStreamResponse(res, stream);
                break;
            
            case ACTION.SEND:
                const result = await requestHandler.sendMessage(req.body);
                sendResponse(res, HTTP_STATUS.CREATED, result);
                break;
            
            default:
                throw A2AError.methodNotFound(`Unknown message action: ${action}`);
        }
    }));

    /**
     * GET /v1/tasks/:taskId
     * 
     * Retrieves task status and history.
     * 
     * @param taskId - Task identifier
     * @query historyLength - Optional number of history items to return
     * @returns 200 OK with Task object
     * @returns 400 Bad Request if historyLength is invalid
     * @returns 404 Not Found if task doesn't exist
     */
    router.get('/v1/tasks/:taskId', asyncHandler(async (req, res) => {
        const params: TaskQueryParams = {
            id: req.params.taskId
        };
        
        // Parse optional historyLength query parameter
        if (req.query.historyLength !== undefined) {
            params.historyLength = parseHistoryLength(req.query.historyLength);
        }
        
        const result = await requestHandler.getTask(params);
        sendResponse(res, HTTP_STATUS.OK, result);
    }));

    /**
     * POST /v1/tasks/:taskId:cancel
     * POST /v1/tasks/:taskId:subscribe
     * 
     * Performs actions on existing tasks.
     * 
     * - :cancel attempts to cancel a running task
     * - :subscribe resumes streaming of task updates via SSE
     * 
     * @param taskId - Task identifier extracted from path
     * @returns 202 Accepted with updated Task for :cancel
     * @returns 200 OK with SSE stream for :subscribe
     * @returns 404 Not Found if task doesn't exist
     * @returns 409 Conflict if task cannot be cancelled (for :cancel)
     * @returns 501 Not Implemented if streaming not supported (for :subscribe)
     */
    router.post(ROUTE_PATTERN.TASK_ACTION, asyncHandler(async (req, res) => {
        const { taskId, action } = extractAction(req.path, ROUTE_PATTERN.TASK_ACTION);
        
        if (!taskId) {
            throw A2AError.invalidParams('Task ID is required');
        }
        
        const taskParams: TaskIdParams = { id: taskId };
        
        switch (action) {
            case ACTION.CANCEL:
                const cancelResult = await requestHandler.cancelTask(taskParams);
                sendResponse(res, HTTP_STATUS.ACCEPTED, cancelResult);
                break;
            
            case ACTION.SUBSCRIBE:
                await requireCapability('streaming');
                const stream = await requestHandler.resubscribe(taskParams);
                await sendStreamResponse(res, stream);
                break;
            
            default:
                throw A2AError.methodNotFound(`Unknown task action: ${action}`);
        }
    }));

    /**
     * POST /v1/tasks/:taskId/pushNotificationConfigs
     * 
     * Creates or updates a push notification configuration for a task.
     * Push notifications allow the agent to send updates to a client-provided webhook.
     * 
     * @param taskId - Task identifier
     * @body TaskPushNotificationConfig - Push notification configuration
     * @returns 201 Created with configuration response
     * @returns 400 Bad Request if configuration is invalid
     * @returns 501 Not Implemented if push notifications not supported
     */
    router.post('/v1/tasks/:taskId/pushNotificationConfigs', asyncHandler(async (req, res) => {
        await requireCapability('pushNotifications');
        
        const params = { 
            ...req.body, 
            taskId: req.params.taskId 
        };
        
        const result = await requestHandler.setTaskPushNotificationConfig(params);
        sendResponse(res, HTTP_STATUS.CREATED, result);
    }));

    /**
     * GET /v1/tasks/:taskId/pushNotificationConfigs
     * 
     * Lists all push notification configurations for a task.
     * 
     * @param taskId - Task identifier
     * @returns 200 OK with array of configurations
     * @returns 404 Not Found if task doesn't exist
     */
    router.get('/v1/tasks/:taskId/pushNotificationConfigs', asyncHandler(async (req, res) => {
        const result = await requestHandler.listTaskPushNotificationConfigs({ 
            id: req.params.taskId 
        });
        sendResponse(res, HTTP_STATUS.OK, result);
    }));

    /**
     * GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
     * 
     * Retrieves a specific push notification configuration.
     * 
     * @param taskId - Task identifier
     * @param configId - Configuration identifier
     * @returns 200 OK with configuration object
     * @returns 404 Not Found if task or configuration doesn't exist
     */
    router.get('/v1/tasks/:taskId/pushNotificationConfigs/:configId', asyncHandler(async (req, res) => {
        const result = await requestHandler.getTaskPushNotificationConfig({ 
            id: req.params.taskId,
            pushNotificationConfigId: req.params.configId
        });
        sendResponse(res, HTTP_STATUS.OK, result);
    }));

    /**
     * DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
     * 
     * Deletes a push notification configuration.
     * 
     * @param taskId - Task identifier
     * @param configId - Configuration identifier
     * @returns 204 No Content on success
     * @returns 404 Not Found if task or configuration doesn't exist
     */
    router.delete('/v1/tasks/:taskId/pushNotificationConfigs/:configId', asyncHandler(async (req, res) => {
        await requestHandler.deleteTaskPushNotificationConfig({ 
            id: req.params.taskId,
            pushNotificationConfigId: req.params.configId
        });
        sendResponse(res, HTTP_STATUS.NO_CONTENT);
    }));

    return router;
}

/**
 * @deprecated Use httpRestHandler instead. This function will be removed in a future version.
 */
export function createHttpRestRouter(requestHandler: A2ARequestHandler): Router {
    return httpRestHandler({ requestHandler }) as Router;
}
