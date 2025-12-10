import express, {
  Request,
  Response,
  RequestHandler,
  ErrorRequestHandler,
  NextFunction,
} from 'express';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { A2AError } from '../error.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import {
  RestTransportHandler,
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
} from '../transports/rest/http_rest_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { getRequestedExtensions } from '../utils.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UserBuilder } from './common.js';

/**
 * Options for configuring the HTTP REST handler.
 */
export interface HttpRestHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
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
const restErrorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof SyntaxError && 'body' in err) {
    const a2aError = A2AError.parseError('Invalid JSON payload.');
    return res.status(400).json(toHTTPError(a2aError));
  }
  next(err);
};

// Route patterns removed - using explicit route definitions instead

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
 * app.use('/api/rest', httpRestHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function httpRestHandler(options: HttpRestHandlerOptions): RequestHandler {
  const router = express.Router();
  const restTransportHandler = new RestTransportHandler(options.requestHandler);

  router.use(express.json(), restErrorHandler);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Builds a ServerCallContext from the Express request.
   * Extracts protocol extensions from headers and builds user from request.
   *
   * @param req - Express request object
   * @returns ServerCallContext with requested extensions and authenticated user
   */
  const buildContext = async (req: Request): Promise<ServerCallContext> => {
    const user = await options.userBuilder(req);
    return new ServerCallContext(getRequestedExtensions(req.header(HTTP_EXTENSION_HEADER)), user);
  };

  /**
   * Sets activated extensions header in the response if any extensions were activated.
   *
   * @param res - Express response object
   * @param context - ServerCallContext containing activated extensions
   */
  const setExtensionsHeader = (res: Response, context: ServerCallContext): void => {
    if (context.activatedExtensions) {
      res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
    }
  };

  /**
   * Sends a JSON response with the specified status code.
   * Handles 204 No Content responses specially (no body).
   * Sets activated extensions header if present in context.
   *
   * @param res - Express response object
   * @param statusCode - HTTP status code
   * @param context - ServerCallContext for setting extension headers
   * @param body - Response body (omitted for 204 responses)
   */
  const sendResponse = (
    res: Response,
    statusCode: number,
    context: ServerCallContext,
    body?: unknown
  ): void => {
    setExtensionsHeader(res, context);
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
   * Events are already converted to REST format by the transport handler.
   * Sets activated extensions header if present in context.
   *
   * @param res - Express response object
   * @param stream - Async generator yielding REST-formatted events
   * @param context - ServerCallContext for setting extension headers
   */
  const sendStreamResponse = async (
    res: Response,
    stream: AsyncGenerator<unknown, void, undefined>,
    context: ServerCallContext
  ): Promise<void> => {
    // Get first event before flushing headers to catch early errors
    // This allows returning proper HTTP error codes instead of 200 + SSE error
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<unknown>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      // Early error - return proper HTTP error
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(error instanceof Error ? error.message : 'Streaming error');
      const statusCode = mapErrorToStatus(a2aError.code);
      sendResponse(res, statusCode, context, toHTTPError(a2aError));
      return;
    }

    // First event succeeded - now set SSE headers and stream
    Object.entries(SSE_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    setExtensionsHeader(res, context);
    res.flushHeaders();

    try {
      // Write first event
      if (!firstResult.done) {
        res.write(formatSSEEvent(firstResult.value));
      }
      // Continue with remaining events
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        res.write(formatSSEEvent(event));
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
        res.write(formatSSEErrorEvent(toHTTPError(a2aError)));
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
    res.status(statusCode).json(toHTTPError(a2aError));
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
      const context = await buildContext(req);
      const result = await restTransportHandler.getAuthenticatedExtendedAgentCard();
      sendResponse(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * POST /v1/message:send
   *
   * Sends a message to the agent synchronously.
   * Returns either a Message (for immediate responses) or a Task (for async processing).
   * Note: Colon is escaped in route definition for Express compatibility.
   *
   * @param req.body - MessageSendParams (accepts both snake_case and camelCase)
   * @returns 201 Created with RestMessage or RestTask
   * @returns 400 Bad Request if message is invalid
   */
  router.post(
    '/v1/message\\:send',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await restTransportHandler.sendMessage(req.body, context);
      sendResponse(res, HTTP_STATUS.CREATED, context, result);
    })
  );

  /**
   * POST /v1/message:stream
   *
   * Sends a message to the agent with streaming response.
   * Returns a Server-Sent Events (SSE) stream of updates.
   * Note: Colon is escaped in route definition for Express compatibility.
   *
   * @param req.body - MessageSendParams (accepts both snake_case and camelCase)
   * @returns 200 OK with SSE stream of messages, tasks, and status updates
   * @returns 400 Bad Request if message is invalid
   * @returns 501 Not Implemented if streaming not supported
   */
  router.post(
    '/v1/message\\:stream',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const stream = await restTransportHandler.sendMessageStream(req.body, context);
      await sendStreamResponse(res, stream, context);
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
      const context = await buildContext(req);
      const result = await restTransportHandler.getTask(
        req.params.taskId,
        context,
        req.query.historyLength
      );
      sendResponse(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * POST /v1/tasks/:taskId:cancel
   *
   * Attempts to cancel an ongoing task.
   * The task may not be immediately canceled depending on its current state.
   *
   * @param req.params.taskId - Task identifier
   * @returns 202 Accepted with RestTask (task is being canceled)
   * @returns 404 Not Found if task doesn't exist
   * @returns 409 Conflict if task cannot be canceled
   */
  router.post(
    '/v1/tasks/:taskId\\:cancel',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await restTransportHandler.cancelTask(req.params.taskId, context);
      sendResponse(res, HTTP_STATUS.ACCEPTED, context, result);
    })
  );

  /**
   * POST /v1/tasks/:taskId:subscribe
   *
   * Resubscribes to an existing task's updates via Server-Sent Events (SSE).
   * Useful for reconnecting to long-running tasks or receiving missed updates.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with SSE stream of task status and artifact updates
   * @returns 404 Not Found if task doesn't exist
   * @returns 501 Not Implemented if streaming not supported
   */
  router.post(
    '/v1/tasks/:taskId\\:subscribe',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const stream = await restTransportHandler.resubscribe(req.params.taskId, context);
      await sendStreamResponse(res, stream, context);
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
   * @returns 201 Created with TaskPushNotificationConfig
   * @returns 501 Not Implemented if push notifications not supported
   */
  router.post(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const config = {
        ...req.body,
        taskId: req.params.taskId,
        task_id: req.params.taskId,
      };
      const result = await restTransportHandler.setTaskPushNotificationConfig(config, context);
      sendResponse(res, HTTP_STATUS.CREATED, context, result);
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs
   *
   * Lists all push notification configurations for a task.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with array of TaskPushNotificationConfig
   * @returns 404 Not Found if task doesn't exist
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await restTransportHandler.listTaskPushNotificationConfigs(
        req.params.taskId,
        context
      );
      sendResponse(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Retrieves a specific push notification configuration.
   *
   * @param req.params.taskId - Task identifier
   * @param req.params.configId - Push notification configuration identifier
   * @returns 200 OK with TaskPushNotificationConfig
   * @returns 404 Not Found if task or config doesn't exist
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await restTransportHandler.getTaskPushNotificationConfig(
        req.params.taskId,
        req.params.configId,
        context
      );
      sendResponse(res, HTTP_STATUS.OK, context, result);
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
      const context = await buildContext(req);
      await restTransportHandler.deleteTaskPushNotificationConfig(
        req.params.taskId,
        req.params.configId,
        context
      );
      sendResponse(res, HTTP_STATUS.NO_CONTENT, context);
    })
  );

  return router;
}
