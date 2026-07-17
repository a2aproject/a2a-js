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
import {
  ServerCallContext,
  ServerCallContextBuilder,
  defaultServerCallContextBuilder,
} from '../context.js';
import {
  JSON_CONTENT_TYPE,
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  HTTP_EXTENSION_HEADER,
} from '../../constants.js';
import { UserBuilder, delegateAsyncIterator } from './common.js';
import { Extensions } from '../../extensions.js';
import { validateVersion } from '../version.js';
import { legacyRestRouter } from '../../compat/v0_3/server/express/index.js';

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
import { ContentTypeNotSupportedError, RequestMalformedError } from '../../errors/index.js';

/** Options for configuring the HTTP+JSON/REST handler. */
export interface RestHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
  /**
   * Enables the v0.3 protocol compatibility layer. When enabled, the
   * handler accepts v0.3-shaped requests on the v0.3 reference URL
   * paths and routes them through the compat module mounted at the top
   * of the router. The agent card MUST also declare a v0.3
   * `HTTP+JSON` interface in `supportedInterfaces`.
   *
   * Default: omitted (disabled).
   */
  legacyCompat?: { enabled: boolean };
  contextBuilder?: ServerCallContextBuilder;
}

/** Catches JSON parse errors from `express.json()` and maps them to A2A. */
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

/**
 * Rejects body-bearing REST requests whose Content-Type is neither
 * `application/json` nor `application/a2a+json`, surfacing a
 * ContentTypeNotSupportedError. Bodyless requests (GET, DELETE, OPTIONS)
 * without a Content-Type pass through.
 */
const restContentTypeGuard: RequestHandler = (req, res, next) => {
  const rawContentType = req.header('content-type');
  if (!rawContentType) {
    next();
    return;
  }
  const mediaType = rawContentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === JSON_CONTENT_TYPE || mediaType === A2A_CONTENT_TYPE) {
    next();
    return;
  }
  const error = new ContentTypeNotSupportedError(
    `Unsupported Content-Type "${rawContentType}"; expected application/json or application/a2a+json.`
  );
  res.status(HTTP_STATUS.BAD_REQUEST).json(toHTTPError(error, HTTP_STATUS.BAD_REQUEST));
};

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Creates Express.js middleware handling A2A HTTP+JSON/REST requests.
 *
 * @example
 * ```ts
 * app.use(
 *   '/api/rest',
 *   restHandler({
 *     requestHandler: a2aRequestHandler,
 *     userBuilder: UserBuilder.noAuthentication,
 *   })
 * );
 * ```
 */
export function restHandler(options: RestHandlerOptions): RequestHandler {
  const router = express.Router();
  const restTransportHandler = new RestTransportHandler(options.requestHandler);

  // Opt-in v0.3 compatibility. Dispatch between v0.3 and v1.0 happens
  // INSIDE the legacy router via a header-based middleware that parses
  // `A2A-Version` and short-circuits non-legacy requests via
  // `next('router')`. Path-based dispatch is intentionally avoided so
  // tenant routes (`/:tenant/...`) remain free to use `v1` (or any
  // other label) as a tenant identifier.
  if (options.legacyCompat?.enabled) {
    router.use(legacyRestRouter(options));
  }

  router.use(
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Type', A2A_CONTENT_TYPE);
      next();
    },
    // Body-bearing requests with an unsupported Content-Type must
    // surface as ContentTypeNotSupportedError, not as the generic
    // 400 that `express.json()` would produce after silently skipping.
    restContentTypeGuard,
    express.json({ type: [JSON_CONTENT_TYPE, A2A_CONTENT_TYPE], strict: false }),
    restErrorHandler
  );

  const buildContext = async (req: Request): Promise<ServerCallContext> => {
    const user = await options.userBuilder(req);
    const tenant = (req.params.tenant as string) || undefined;
    const requestedVersion = req.header(A2A_VERSION_HEADER) || undefined;
    const ctxBuilder = options.contextBuilder ?? defaultServerCallContextBuilder;
    const context = ctxBuilder({
      extensions: Extensions.parseServiceParameter(req.header(HTTP_EXTENSION_HEADER)),
      user,
      headers: req.headers,
      requestedVersion,
      tenant,
    });
    const agentCard = await restTransportHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');
    return context;
  };

  const setExtensionsHeader = (res: Response, context: ServerCallContext): void => {
    if (context.activatedExtensions) {
      res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
    }
  };

  /** Sends a JSON response; 204 produces an empty body. */
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
   * Sends an SSE stream response. The first event is consumed eagerly so
   * an early failure can surface as a proper HTTP error instead of a 200
   * SSE stream carrying a single error event.
   */
  const sendStreamResponse = async (
    res: Response,
    stream: AsyncGenerator<StreamResponse, void, undefined>,
    context: ServerCallContext
  ): Promise<void> => {
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<StreamResponse>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      setExtensionsHeader(res, context);
      const statusCode = mapErrorToStatus(error);
      res.status(statusCode).json(toHTTPError(error, statusCode));
      return;
    }

    Object.entries(SSE_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    setExtensionsHeader(res, context);
    res.flushHeaders();

    try {
      if (!firstResult.done) {
        const result = StreamResponse.toJSON(firstResult.value);
        res.write(formatSSEEvent(result));
      }
      for await (const event of delegateAsyncIterator(iterator)) {
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
   * Resolves tenant from the URL path parameter and normalizes it onto
   * `req.body.tenant` and `req.query.tenant`. The path tenant is the
   * canonical source — if the body or query also carries a tenant that
   * differs, a warning is logged and the path tenant wins.
   */
  const tenantMiddleware = (req: Request, _res: Response, next: () => void): void => {
    const pathTenant = req.params.tenant as string | undefined;
    if (!pathTenant) {
      next();
      return;
    }

    const bodyTenant = req.body?.tenant as string | undefined;
    if (bodyTenant && bodyTenant !== pathTenant) {
      console.warn(
        `Tenant mismatch: URL path tenant "${pathTenant}" differs from request body ` +
          `tenant "${bodyTenant}". Using path tenant as the canonical value.`
      );
    }

    const queryTenant = req.query?.tenant as string | undefined;
    if (queryTenant && queryTenant !== pathTenant) {
      console.warn(
        `Tenant mismatch: URL path tenant "${pathTenant}" differs from query param ` +
          `tenant "${queryTenant}". Using path tenant as the canonical value.`
      );
    }

    if (req.body) {
      req.body.tenant = pathTenant;
    }
    (req.query as Record<string, unknown>).tenant = pathTenant;

    next();
  };

  /**
   * Registers a route both with and without an optional `/:tenant` prefix.
   * Tenant-prefixed routes get `tenantMiddleware` automatically.
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
    const params = SendMessageRequest.fromJSON(req.body ?? {});
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
    const params = SendMessageRequest.fromJSON(req.body ?? {});
    const stream = await restTransportHandler.sendMessageStream(params, context);
    await sendStreamResponse(res, stream, context);
  });

  /**
   * GET/POST /tasks/:taskId:subscribe
   *
   * Resubscribes to an existing task's updates via Server-Sent Events (SSE).
   * Useful for reconnecting to long-running tasks or receiving missed updates.
   *
   * Both GET and POST are accepted here because the v1.0 spec has
   * two normative sources that disagree on the HTTP method:
   *   - `spec/a2a.proto`'s `google.api.http` annotation for
   *     `SubscribeToTask` uses `get: "/tasks/{id=*}:subscribe"`.
   *   - The spec markdown documents the operation as `POST`.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with SSE stream of task status and artifact updates
   * @returns 404 Not Found if task doesn't exist
   * @returns 501 Not Implemented if streaming not supported
   */
  const resubscribeHandler = async (req: Request, res: Response) => {
    const context = await buildContext(req);
    const stream = await restTransportHandler.resubscribe(
      req.params.taskId,
      context,
      (req.query.tenant as string) || ''
    );
    await sendStreamResponse(res, stream, context);
  };
  registerRoute('get', '/tasks/:taskId\\:subscribe', resubscribeHandler);
  registerRoute('post', '/tasks/:taskId\\:subscribe', resubscribeHandler);

  /**
   * POST /tasks/:taskId:cancel
   *
   * Attempts to cancel an ongoing task.
   * The task may not be immediately canceled depending on its current state.
   *
   * @param req.params.taskId - Task identifier
   * @returns 200 OK with RestTask (task in its post-cancel state)
   * @returns 404 Not Found if task doesn't exist
   * @returns 400 Bad Request if task cannot be canceled
   */
  registerRoute('post', '/tasks/:taskId\\:cancel', async (req, res) => {
    const context = await buildContext(req);
    const result = await restTransportHandler.cancelTask(
      req.params.taskId,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse<Task>(res, HTTP_STATUS.OK, context, result, Task);
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
      req.params.taskId as string,
      context,
      req.query.historyLength,
      (req.query.tenant as string) || ''
    );
    sendResponse<Task>(res, HTTP_STATUS.OK, context, result, Task);
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
    const params = TaskPushNotificationConfig.fromJSON(req.body ?? {});
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
      req.params.taskId as string,
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
      req.params.taskId as string,
      req.params.configId as string,
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
      req.params.taskId as string,
      req.params.configId as string,
      context,
      (req.query.tenant as string) || ''
    );
    sendResponse(res, HTTP_STATUS.NO_CONTENT, context);
  });

  return router;
}
