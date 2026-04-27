import express, {
  Request,
  Response,
  RequestHandler,
  ErrorRequestHandler,
  NextFunction,
} from 'express';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import {
  RestTransportHandler,
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
} from '../transports/rest/rest_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UserBuilder } from './common.js';
import { Extensions } from '../../extensions.js';
import { validateVersion } from '../version.js';

import {
  AgentCard,
  ListTaskPushNotificationConfigsResponse,
  ListTasksResponse,
  MessageFns,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
} from '../../types/pb/a2a.js';
import { ToProto } from '../../types/converters/to_proto.js';
import { RequestMalformedError } from '../../errors.js';

/**
 * Options for configuring the HTTP+JSON/REST handler.
 */
export interface RestHandlerOptions {
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
    return res
      .status(400)
      .json(toHTTPError(new RequestMalformedError('Invalid JSON payload.'), 400));
  }
  next(err);
};

// Route patterns removed - using explicit route definitions instead

/**
 * Type alias for async Express route handlers used in this module.
 */
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

// ============================================================================
// HTTP+JSON/REST Handler - Main Export
// ============================================================================

/**
 * Creates Express.js middleware to handle A2A HTTP+JSON/REST requests.
 *
 * This handler implements the A2A REST API specification with snake_case
 * field names, providing endpoints for:
 * - Agent card retrieval (GET /extendedAgentCard)
 * - Message sending with optional streaming (POST /message:send|stream)
 * - Task management (GET/POST /tasks/:taskId:cancel|subscribe)
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
 * ```ts
 * const app = express();
 * const requestHandler = new DefaultRequestHandler(...);
 * app.use('/api/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function restHandler(options: RestHandlerOptions): RequestHandler {
  const router = express.Router();
  const restTransportHandler = new RestTransportHandler(options.requestHandler);

  router.use(express.json(), restErrorHandler);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Builds a ServerCallContext from the Express request.
   * Extracts protocol extensions from headers, builds user from request,
   * and extracts tenant from the URL path parameter if present.
   * Validates the requested version against the agent card's supported versions.

   *
   * @param req - Express request object
   * @returns ServerCallContext with requested extensions, authenticated user, and tenant
   */
  const buildContext = async (req: Request): Promise<ServerCallContext> => {
    const user = await options.userBuilder(req);
    const tenant = (req.params.tenant as string) || undefined;
    const requestedVersion = req.header(A2A_VERSION_HEADER) || undefined;

    const context = new ServerCallContext({
      requestedExtensions: Extensions.parseServiceParameter(req.header(HTTP_EXTENSION_HEADER)),
      user,
      requestedVersion,
      tenant,
    });
    const agentCard = await restTransportHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');
    return context;
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
   * @param responseType - Optional protobuf message type for serialization
   */
  const sendResponse = <T>(
    res: Response,
    statusCode: number,
    context: ServerCallContext,
    body?: T,
    responseType?: MessageFns<T>
  ): void => {
    setExtensionsHeader(res, context);
    res.status(statusCode);
    if (statusCode === HTTP_STATUS.NO_CONTENT) {
      res.end();
    } else {
      if (!responseType || body === undefined) {
        throw new Error('Bug: toJson serializer and body must be provided for non-204 responses.');
      }
      res.json(responseType.toJSON(body));
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
    stream: AsyncGenerator<StreamResponse, void, undefined>,
    context: ServerCallContext
  ): Promise<void> => {
    // Get first event before flushing headers to catch early errors
    // This allows returning proper HTTP error codes instead of 200 + SSE error
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<StreamResponse>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      // Early error - return proper HTTP error
      setExtensionsHeader(res, context);
      const statusCode = mapErrorToStatus(error);
      res.status(statusCode).json(toHTTPError(error, statusCode));
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
        const result = StreamResponse.toJSON(firstResult.value);
        res.write(formatSSEEvent(result));
      }
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        const result = StreamResponse.toJSON(event);
        res.write(formatSSEEvent(result));
      }
    } catch (streamError: unknown) {
      console.error('SSE streaming error:', streamError);
      if (!res.writableEnded) {
        res.write(formatSSEErrorEvent(toHTTPError(streamError, mapErrorToStatus(streamError))));
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
    const statusCode = mapErrorToStatus(error);
    res.status(statusCode).json(toHTTPError(error, statusCode));
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
   * Middleware that resolves tenant from the URL path parameter and normalizes
   * it into the request so downstream handlers don't need to deal with tenant
   * resolution at all.
   *
   * For tenant-prefixed routes (`/:tenant/...`), the path tenant is the
   * canonical source (per spec: "provided as a path parameter"). If the
   * request body or query string also carries a tenant that differs, a warning
   * is logged and the path tenant wins.
   *
   * The resolved tenant is written to:
   * - `req.body.tenant` for POST / PUT / DELETE requests that may carry a JSON body
   * - `req.query.tenant` for GET requests that use query parameters
   *
   * Non-tenant-prefixed routes pass through unchanged.
   */
  const tenantMiddleware = (req: Request, _res: Response, next: () => void): void => {
    const pathTenant = req.params.tenant as string | undefined;
    if (!pathTenant) {
      next();
      return;
    }

    // Detect conflict with body tenant (POST / PUT / DELETE with JSON body)
    const bodyTenant = req.body?.tenant as string | undefined;
    if (bodyTenant && bodyTenant !== pathTenant) {
      console.warn(
        `Tenant mismatch: URL path tenant "${pathTenant}" differs from request body ` +
          `tenant "${bodyTenant}". Using path tenant as the canonical value.`
      );
    }

    // Detect conflict with query tenant (GET)
    const queryTenant = req.query?.tenant as string | undefined;
    if (queryTenant && queryTenant !== pathTenant) {
      console.warn(
        `Tenant mismatch: URL path tenant "${pathTenant}" differs from query param ` +
          `tenant "${queryTenant}". Using path tenant as the canonical value.`
      );
    }

    // Normalize: write path tenant into both body and query so handlers can
    // read it from whichever source they naturally consume.
    if (req.body) {
      req.body.tenant = pathTenant;
    }
    (req.query as Record<string, unknown>).tenant = pathTenant;

    next();
  };

  /**
   * Helper to register routes with and without optional tenant prefix.
   * Tenant-prefixed routes get `tenantMiddleware` applied automatically,
   * so individual handlers never need to resolve tenant themselves.
   */
  const registerRoute = (
    method: 'get' | 'post' | 'delete' | 'put',
    path: string,
    handler: AsyncRouteHandler
  ) => {
    router[method](path, asyncHandler(handler));
    router[method](`/:tenant${path}`, tenantMiddleware, asyncHandler(handler));
  };

  /**
   * GET /extendedAgentCard
   *
   * Retrieves the authenticated extended agent card.
   *
   * @returns 200 OK with agent card
   * @returns 500 Internal Server Error on failure
   */
  registerRoute('get', '/extendedAgentCard', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.getAuthenticatedExtendedAgentCard(
      { tenant: (req.query.tenant as string) || '' },
      context
    );
    sendResponse<AgentCard>(res, HTTP_STATUS.OK, context, result, AgentCard);
  });

  /**
   * POST /message:send
   *
   * Sends a message to the agent synchronously.
   * Returns either a Message (for immediate responses) or a Task (for async processing).
   * Note: Colon is escaped in route definition for Express compatibility.
   *
   * @param req.body - MessageSendParams (accepts both snake_case and camelCase)
   * @returns 201 Created with RestMessage or RestTask
   * @returns 400 Bad Request if message is invalid
   */
  registerRoute('post', '/message\\:send', async (req, res) => {
    const context = await buildContext(req);
    const params = SendMessageRequest.fromJSON(req.body);
    const result = await restTransportHandler.sendMessage(params, context);
    const protoResult = ToProto.messageSendResult(result);
    sendResponse<SendMessageResponse>(
      res,
      HTTP_STATUS.OK,
      context,
      protoResult,
      SendMessageResponse
    );
  });

  /**
   * POST /message:stream
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
  registerRoute('post', '/message\\:stream', async (req, res) => {
    const context = await buildContext(req);
    const params = SendMessageRequest.fromJSON(req.body);
    const stream = await restTransportHandler.sendMessageStream(params, context);
    await sendStreamResponse(res, stream, context);
  });

  /**
   * GET /tasks/:taskId
   *
   * Retrieves the current status and details of a task.
   *
   * @param req.params.taskId - Task identifier
   * @param req.query.historyLength - Optional number of history messages to include
   * @returns 200 OK with RestTask
   * @returns 400 Bad Request if historyLength is invalid
   * @returns 404 Not Found if task doesn't exist
   */
  registerRoute('get', '/tasks/:taskId', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.getTask(
      req.params.taskId,
      context,
      req.query.historyLength,
      (req.query.tenant as string) || ''
    );
    sendResponse<Task>(res, HTTP_STATUS.OK, context, result, Task);
  });

  /**
   * POST /tasks/:taskId:cancel
   *
   * Attempts to cancel an ongoing task.
   * The task may not be immediately canceled depending on its current state.
   *
   * @param req.params.taskId - Task identifier
   * @returns 202 Accepted with RestTask (task is being canceled)
   * @returns 404 Not Found if task doesn't exist
   * @returns 409 Conflict if task cannot be canceled
   */
  registerRoute('post', '/tasks/:taskId\\:cancel', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.cancelTask(
      req.params.taskId,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse<Task>(res, HTTP_STATUS.ACCEPTED, context, result, Task);
  });

  /**
   * GET /tasks
   *
   * Retrieves a list of tasks with optional filtering and pagination capabilities.
   *
   * @returns 200 OK with ListTasksResponse
   * @returns 400 Bad Request if filter or pageSize is invalid
   */
  registerRoute('get', '/tasks', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.listTasks(req.query, context);
    sendResponse<ListTasksResponse>(res, HTTP_STATUS.OK, context, result, ListTasksResponse);
  });

  /**
   * POST /tasks/:taskId:subscribe
   *
   * Resubscribes to an existing task's updates via Server-Sent Events (SSE).
   * Useful for reconnecting to long-running tasks or receiving missed updates.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with SSE stream of task status and artifact updates
   * @returns 404 Not Found if task doesn't exist
   * @returns 501 Not Implemented if streaming not supported
   */
  registerRoute('post', '/tasks/:taskId\\:subscribe', async (req, res) => {
    const context = await buildContext(req);
    const stream = await restTransportHandler.resubscribe(
      req.params.taskId,
      context,
      (req.query.tenant as string) || ''
    );
    await sendStreamResponse(res, stream, context);
  });

  /**
   * POST /tasks/:taskId/pushNotificationConfigs
   *
   * Creates a push notification configuration for a task.
   * The agent will send task updates to the configured webhook URL.
   *
   * @param req.params.taskId - Task identifier
   * @param req.body - Push notification configuration (snake_case format)
   * @returns 201 Created with TaskPushNotificationConfig
   * @returns 501 Not Implemented if push notifications not supported
   */
  registerRoute('post', '/tasks/:taskId/pushNotificationConfigs', async (req, res) => {
    const context = await buildContext(req);
    const params = TaskPushNotificationConfig.fromJSON(req.body);
    const result = await restTransportHandler.createTaskPushNotificationConfig(params, context);
    sendResponse<TaskPushNotificationConfig>(
      res,
      HTTP_STATUS.CREATED,
      context,
      result,
      TaskPushNotificationConfig
    );
  });

  /**
   * GET /tasks/:taskId/pushNotificationConfigs
   *
   * Lists all push notification configurations for a task.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with array of TaskPushNotificationConfig
   * @returns 404 Not Found if task doesn't exist
   */
  registerRoute('get', '/tasks/:taskId/pushNotificationConfigs', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.listTaskPushNotificationConfigs(
      req.params.taskId,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse<ListTaskPushNotificationConfigsResponse>(
      res,
      HTTP_STATUS.OK,
      context,
      result,
      ListTaskPushNotificationConfigsResponse
    );
  });

  /**
   * GET /tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Retrieves a specific push notification configuration.
   *
   * @param req.params.taskId - Task identifier
   * @param req.params.configId - Push notification configuration identifier
   * @returns 200 OK with TaskPushNotificationConfig
   * @returns 404 Not Found if task or config doesn't exist
   */
  registerRoute('get', '/tasks/:taskId/pushNotificationConfigs/:configId', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.getTaskPushNotificationConfig(
      req.params.taskId,
      req.params.configId,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse<TaskPushNotificationConfig>(
      res,
      HTTP_STATUS.OK,
      context,
      result,
      TaskPushNotificationConfig
    );
  });

  /**
   * DELETE /tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Deletes a push notification configuration.
   *
   * @param req.params.taskId - Task identifier
   * @param req.params.configId - Push notification configuration identifier
   * @returns 204 No Content on success
   * @returns 404 Not Found if task or config doesn't exist
   */
  registerRoute('delete', '/tasks/:taskId/pushNotificationConfigs/:configId', async (req, res) => {
    const context = await buildContext(req);
    await restTransportHandler.deleteTaskPushNotificationConfig(
      req.params.taskId,
      req.params.configId,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse(res, HTTP_STATUS.NO_CONTENT, context);
  });

  return router;
}
