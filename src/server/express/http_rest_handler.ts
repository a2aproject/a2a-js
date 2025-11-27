import express, {
  Request,
  Response,
  Router,
  RequestHandler,
  ErrorRequestHandler,
  NextFunction,
} from 'express';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { A2AError } from '../error.js';
import {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskQueryParams,
  TaskIdParams,
  MessageSendParams,
} from '../../types.js';
import { RestMessageSendParams, RestTaskPushNotificationConfig } from './rest_types.js';
import {
  fromRestMessageSendParams,
  fromRestTaskPushNotificationConfig,
  toRestMessage,
  toRestTask,
  toRestStreamEvent,
  toRestTaskPushNotificationConfig,
  HTTP_STATUS,
  mapErrorToStatus,
  parseHistoryLength,
  extractAction,
  SSE_HEADERS,
  formatSSEEvent,
  formatSSEErrorEvent,
  ACTION,
} from '../transports/http_rest_transport_handler.js';

/**
 * Options for configuring the HTTP REST handler.
 */
export interface HttpRestHandlerOptions {
  /** The A2A request handler implementation that processes requests */
  requestHandler: A2ARequestHandler;
}

/**
 * Express error handler middleware for REST API JSON parse errors.
 * Catches SyntaxError from express.json() and converts to A2A parse error format.
 *
 * @param err - Error thrown by express.json() middleware
 * @param _req - Express request (unused)
 * @param res - Express response
 * @param next - Next middleware function
 */
export const restErrorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof SyntaxError && 'body' in err) {
    const a2aError = A2AError.parseError('Invalid JSON payload.');
    return res.status(400).json({
      error: a2aError.toJSONRPCError(),
    });
  }
  next(err);
};

/**
 * Regular expression patterns for matching REST API routes with actions.
 */
const ROUTE_PATTERN = {
  MESSAGE_ACTION: /^\/v1\/message:(send|stream)$/i,
  TASK_ACTION: /^\/v1\/tasks\/([^/:]+):([a-z]+)$/i,
} as const;

/**
 * Type alias for async Express route handlers used in this module.
 */
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

// ============================================================================
// HTTP REST Handler - Main Export
// ============================================================================

/**
 * Creates Express.js middleware to handle A2A HTTP+REST requests.
 *
 * This handler implements the A2A REST API specification with snake_case
 * field names, providing endpoints for:
 * - Agent card retrieval (GET /v1/card)
 * - Message sending with optional streaming (POST /v1/message:send|stream)
 * - Task management (GET/POST /v1/tasks/:taskId:cancel|subscribe)
 * - Push notification configuration
 *
 * The handler acts as an adapter layer, converting between REST format
 * (snake_case) at the API boundary and internal TypeScript format (camelCase)
 * for business logic.
 *
 * @param options - Configuration options including the request handler
 * @returns Express router configured with all A2A REST endpoints
 *
 * @example
 * ```typescript
 * const app = express();
 * const requestHandler = new DefaultRequestHandler(...);
 * app.use('/api/rest', httpRestHandler({ requestHandler }));
 * ```
 */
export function httpRestHandler(options: HttpRestHandlerOptions): RequestHandler {
  const router = express.Router();
  const { requestHandler } = options;

  router.use(express.json(), restErrorHandler);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Sends a JSON response with the specified status code.
   * Handles 204 No Content responses specially (no body).
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
   * Sets appropriate SSE headers, streams events, and handles errors gracefully.
   * Converts internal events to REST format before sending.
   *
   * @param res - Express response object
   * @param stream - Async generator yielding events (Message, Task, or update events)
   */
  const sendStreamResponse = async (
    res: Response,
    stream: AsyncGenerator<unknown, void, undefined>
  ): Promise<void> => {
    Object.entries(SSE_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    res.flushHeaders();

    try {
      for await (const event of stream) {
        const restEvent = toRestStreamEvent(
          event as Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent
        );
        res.write(formatSSEEvent(restEvent));
      }
    } catch (streamError: unknown) {
      console.error('SSE streaming error:', streamError);
      const a2aError =
        streamError instanceof A2AError
          ? streamError
          : A2AError.internalError(
              streamError instanceof Error ? streamError.message : 'Streaming error'
            );
      if (!res.writableEnded) {
        res.write(formatSSEErrorEvent(a2aError.toJSONRPCError()));
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  };

  /**
   * Handles errors in route handlers by converting them to A2A error format
   * and sending appropriate HTTP response.
   * Gracefully handles cases where headers have already been sent.
   *
   * @param res - Express response object
   * @param error - Error to handle (can be A2AError or generic Error)
   */
  const handleError = (res: Response, error: unknown): void => {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    const a2aError =
      error instanceof A2AError
        ? error
        : A2AError.internalError(error instanceof Error ? error.message : 'Internal server error');
    const statusCode = mapErrorToStatus(a2aError.code);
    sendResponse(res, statusCode, a2aError.toJSONRPCError());
  };

  /**
   * Validates that the agent supports a required capability.
   * Throws appropriate A2AError if the capability is not available.
   *
   * @param capability - The capability to check ('streaming' or 'pushNotifications')
   * @throws {A2AError} UnsupportedOperation (-32005) for streaming
   * @throws {A2AError} PushNotificationNotSupported (-32008) for push notifications
   */
  const requireCapability = async (
    capability: 'streaming' | 'pushNotifications'
  ): Promise<void> => {
    const agentCard = await requestHandler.getAgentCard();
    if (!agentCard.capabilities?.[capability]) {
      const errorMessage =
        capability === 'streaming'
          ? 'Agent does not support streaming'
          : 'Agent does not support push notifications';
      throw capability === 'pushNotifications'
        ? A2AError.pushNotificationNotSupported()
        : A2AError.unsupportedOperation(errorMessage);
    }
  };

  /**
   * Wraps an async route handler to centralize error handling.
   * Catches any errors thrown by the handler and passes them to handleError.
   *
   * @param handler - Async route handler function
   * @returns Wrapped handler with built-in error handling
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

  // ============================================================================
  // Route Handlers
  // ============================================================================

  /**
   * GET /v1/card
   *
   * Retrieves the authenticated extended agent card.
   *
   * @returns 200 OK with agent card
   * @returns 500 Internal Server Error on failure
   */
  router.get(
    '/v1/card',
    asyncHandler(async (req, res) => {
      const result = await requestHandler.getAuthenticatedExtendedAgentCard();
      sendResponse(res, HTTP_STATUS.OK, result);
    })
  );

  /**
   * POST /v1/message:send
   * POST /v1/message:stream
   *
   * Sends a message to the agent. Supports both synchronous and streaming modes.
   * - :send - Synchronous message sending, returns Message or Task
   * - :stream - Streaming response via Server-Sent Events
   *
   * @param req.body - RestMessageSendParams (snake_case format)
   * @returns 201 Created with RestMessage or RestTask (:send)
   * @returns 200 OK with SSE stream (:stream)
   * @returns 400 Bad Request if message is invalid
   * @returns 501 Not Implemented if streaming not supported
   */
  router.post(
    ROUTE_PATTERN.MESSAGE_ACTION,
    asyncHandler(async (req, res) => {
      const { action } = extractAction(req.path, ROUTE_PATTERN.MESSAGE_ACTION);
      const restParams = req.body as RestMessageSendParams;

      // Validate required fields before conversion
      if (!restParams.message) {
        throw A2AError.invalidParams('message is required');
      }

      let params: MessageSendParams;
      try {
        params = fromRestMessageSendParams(restParams);
      } catch (error) {
        // Convert conversion errors to InvalidParams
        if (error instanceof A2AError) throw error;
        throw A2AError.invalidParams(
          error instanceof Error ? error.message : 'Invalid message parameters'
        );
      }

      switch (action) {
        case ACTION.STREAM: {
          await requireCapability('streaming');
          const stream = await requestHandler.sendMessageStream(params);
          await sendStreamResponse(res, stream);
          break;
        }
        case ACTION.SEND: {
          const result = await requestHandler.sendMessage(params);
          const restResult = result.kind === 'message' ? toRestMessage(result) : toRestTask(result);
          sendResponse(res, HTTP_STATUS.CREATED, restResult);
          break;
        }
        default:
          throw A2AError.methodNotFound(`Unknown message action: ${action}`);
      }
    })
  );

  /**
   * GET /v1/tasks/:taskId
   *
   * Retrieves the current status and details of a task.
   *
   * @param req.params.taskId - Task identifier
   * @param req.query.historyLength - Optional number of history messages to include
   * @returns 200 OK with RestTask
   * @returns 400 Bad Request if historyLength is invalid
   * @returns 404 Not Found if task doesn't exist
   */
  router.get(
    '/v1/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const params: TaskQueryParams = { id: req.params.taskId };
      if (req.query.historyLength !== undefined) {
        params.historyLength = parseHistoryLength(req.query.historyLength);
      }
      const result = await requestHandler.getTask(params);
      sendResponse(res, HTTP_STATUS.OK, toRestTask(result));
    })
  );

  /**
   * POST /v1/tasks/:taskId:cancel
   * POST /v1/tasks/:taskId:subscribe
   *
   * Performs actions on an existing task.
   * - :cancel - Attempts to cancel the task
   * - :subscribe - Resubscribes to task updates via SSE stream
   *
   * @param req.params.taskId - Task identifier
   * @returns 202 Accepted with RestTask (:cancel)
   * @returns 200 OK with SSE stream (:subscribe)
   * @returns 404 Not Found if task doesn't exist
   * @returns 409 Conflict if task cannot be canceled
   * @returns 501 Not Implemented if streaming not supported
   */
  router.post(
    ROUTE_PATTERN.TASK_ACTION,
    asyncHandler(async (req, res) => {
      const { taskId, action } = extractAction(req.path, ROUTE_PATTERN.TASK_ACTION);
      if (!taskId) {
        throw A2AError.invalidParams('Task ID is required');
      }
      const taskParams: TaskIdParams = { id: taskId };

      switch (action) {
        case ACTION.CANCEL: {
          const cancelResult = await requestHandler.cancelTask(taskParams);
          sendResponse(res, HTTP_STATUS.ACCEPTED, toRestTask(cancelResult));
          break;
        }
        case ACTION.SUBSCRIBE: {
          await requireCapability('streaming');
          const stream = await requestHandler.resubscribe(taskParams);
          await sendStreamResponse(res, stream);
          break;
        }
        default:
          throw A2AError.methodNotFound(`Unknown task action: ${action}`);
      }
    })
  );

  /**
   * POST /v1/tasks/:taskId/pushNotificationConfigs
   *
   * Creates a push notification configuration for a task.
   * The agent will send task updates to the configured webhook URL.
   *
   * @param req.params.taskId - Task identifier
   * @param req.body - Push notification configuration (snake_case format)
   * @returns 201 Created with RestTaskPushNotificationConfig
   * @returns 501 Not Implemented if push notifications not supported
   */
  router.post(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      await requireCapability('pushNotifications');
      const restConfig = {
        ...req.body,
        task_id: req.params.taskId,
      } as RestTaskPushNotificationConfig;
      const params = fromRestTaskPushNotificationConfig(restConfig);
      const result = await requestHandler.setTaskPushNotificationConfig(params);
      sendResponse(res, HTTP_STATUS.CREATED, toRestTaskPushNotificationConfig(result));
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs
   *
   * Lists all push notification configurations for a task.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with array of RestTaskPushNotificationConfig
   * @returns 404 Not Found if task doesn't exist
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const result = await requestHandler.listTaskPushNotificationConfigs({
        id: req.params.taskId,
      });
      sendResponse(res, HTTP_STATUS.OK, result.map(toRestTaskPushNotificationConfig));
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Retrieves a specific push notification configuration.
   *
   * @param req.params.taskId - Task identifier
   * @param req.params.configId - Push notification configuration identifier
   * @returns 200 OK with RestTaskPushNotificationConfig
   * @returns 404 Not Found if task or config doesn't exist
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    asyncHandler(async (req, res) => {
      const result = await requestHandler.getTaskPushNotificationConfig({
        id: req.params.taskId,
        pushNotificationConfigId: req.params.configId,
      });
      sendResponse(res, HTTP_STATUS.OK, toRestTaskPushNotificationConfig(result));
    })
  );

  /**
   * DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Deletes a push notification configuration.
   *
   * @param req.params.taskId - Task identifier
   * @param req.params.configId - Push notification configuration identifier
   * @returns 204 No Content on success
   * @returns 404 Not Found if task or config doesn't exist
   */
  router.delete(
    '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    asyncHandler(async (req, res) => {
      await requestHandler.deleteTaskPushNotificationConfig({
        id: req.params.taskId,
        pushNotificationConfigId: req.params.configId,
      });
      sendResponse(res, HTTP_STATUS.NO_CONTENT);
    })
  );

  return router;
}

/**
 * @deprecated Use httpRestHandler instead.
 */
export function createHttpRestRouter(requestHandler: A2ARequestHandler): Router {
  return httpRestHandler({ requestHandler }) as Router;
}
