/**
 * v0.3 HTTP+JSON (REST) Express handler.
 *
 * Mounts the v0.3 REST endpoints (under the `/v1/...` path prefix used
 * by the v0.3 reference implementation) onto an Express router and
 * delegates to {@link LegacyRestTransportHandler} for the actual
 * v0.3 ↔ v1.0 translation work.
 *
 * Designed to share an `A2ARequestHandler` instance with the v1.0
 * `restHandler`: the core `restHandler` mounts this legacy router as a
 * sub-router so a single Express app exposes both v0.3 (`/v1/...`) and
 * v1.0 paths from one mount point. The two route sets are disjoint by
 * path prefix, so Express's matcher routes correctly without any body
 * inspection.
 */

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { A2A_VERSION_HEADER } from '../../../../constants.js';
import { Extensions } from '../../../../extensions.js';
import { ServerCallContext } from '../../../../server/context.js';
import { UserBuilder } from '../../../../server/express/common.js';
import { type A2ARequestHandler } from '../../../../server/request_handler/a2a_request_handler.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../../../sse_utils.js';
import { validateVersion } from '../../../../server/version.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_JSON_CONTENT_TYPE,
} from '../../constants.js';
import type * as legacy from '../../types/types.js';
import { A2AError as LegacyA2AError } from '../error.js';
import {
  HTTP_STATUS,
  LegacyRestTransportHandler,
  mapErrorToStatus,
  toLegacyHTTPError,
} from '../transports/rest/rest_transport_handler.js';

/**
 * Options for configuring the legacy v0.3 HTTP+JSON/REST handler.
 */
export interface LegacyRestHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Express error middleware that converts JSON parse errors from
 * `express.json()` to v0.3-shaped 400 responses.
 */
const legacyRestErrorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(toLegacyHTTPError(LegacyA2AError.parseError('Invalid JSON payload.')));
  }
  next(err);
};

/**
 * Type alias for async Express route handlers used in this module.
 */
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

// ============================================================================
// Legacy REST Handler - Main Export
// ============================================================================

/**
 * Creates an Express router exposing the v0.3 HTTP+JSON/REST endpoints.
 *
 * All endpoints are mounted under the `/v1/...` prefix used by the v0.3
 * reference implementation, so the router can be safely composed with
 * the v1.0 `restHandler` on the same mount point without path
 * collisions.
 *
 * The router:
 *   - Parses `application/json` bodies via {@link LEGACY_JSON_CONTENT_TYPE}.
 *   - Reads protocol extensions from the {@link LEGACY_HTTP_EXTENSION_HEADER}
 *     (`X-A2A-Extensions`) header (v0.3 used the `X-` prefix; v1.0 dropped it).
 *   - Defaults a missing `A2A-Version` header to {@link A2A_LEGACY_PROTOCOL_VERSION}
 *     (`'0.3'`).
 *   - Sets the response `Content-Type` to {@link LEGACY_JSON_CONTENT_TYPE}
 *     (`application/json`, not `application/a2a+json`).
 *   - Returns errors in the bare v0.3 `{ code, message, data? }` shape.
 *
 * @example
 * ```ts
 * import { legacyRestRouter } from '@a2a-js/sdk/compat/v0_3';
 * app.use('/api', legacyRestRouter({ requestHandler, userBuilder }));
 * // → POST /api/v1/message:send
 * // → GET  /api/v1/tasks/:taskId
 * // …
 * ```
 */
export function legacyRestRouter(options: LegacyRestHandlerOptions): RequestHandler {
  const router = express.Router();
  const transportHandler = new LegacyRestTransportHandler(options.requestHandler);

  router.use(
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
      next();
    },
    express.json({ type: LEGACY_JSON_CONTENT_TYPE }),
    legacyRestErrorHandler
  );

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Builds a {@link ServerCallContext} from the Express request.
   * - Extracts protocol extensions from the legacy `X-A2A-Extensions`
   *   header.
   * - Resolves the authenticated user.
   * - Defaults the A2A version to {@link A2A_LEGACY_PROTOCOL_VERSION}
   *   when the `A2A-Version` header is absent or empty (matches the
   *   v0.3 default specified in §3.6.2).
   * - Validates the requested version against the agent card's
   *   `HTTP+JSON` interface list.
   */
  const buildContext = async (req: Request): Promise<ServerCallContext> => {
    const user = await options.userBuilder(req);
    const requestedVersion = req.header(A2A_VERSION_HEADER) || A2A_LEGACY_PROTOCOL_VERSION;
    const context = new ServerCallContext({
      requestedExtensions: Extensions.parseServiceParameter(
        req.header(LEGACY_HTTP_EXTENSION_HEADER)
      ),
      user,
      requestedVersion,
    });
    const agentCard = await transportHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');
    return context;
  };

  /**
   * Sets the legacy activated-extensions response header (if any).
   */
  const setExtensionsHeader = (res: Response, context: ServerCallContext): void => {
    if (context.activatedExtensions) {
      res.setHeader(LEGACY_HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
    }
  };

  /**
   * Sends a JSON response with the given status code. Bodies are
   * already v0.3-shaped (no proto serializer roundtrip needed). For
   * 204 responses the body is omitted.
   */
  const sendResponse = <T>(
    res: Response,
    statusCode: number,
    context: ServerCallContext,
    body?: T
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
   * Streams v0.3-shaped events back as Server-Sent Events.
   *
   * Pulls the first event before flushing headers so an early error
   * (e.g. `TaskNotFoundError`) is returned as a proper HTTP error code
   * instead of a 200 followed by an SSE error event.
   */
  const sendStreamResponse = async (
    res: Response,
    stream: AsyncGenerator<legacy.SendStreamingMessageSuccessResponse['result'], void, undefined>,
    context: ServerCallContext
  ): Promise<void> => {
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<legacy.SendStreamingMessageSuccessResponse['result']>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      setExtensionsHeader(res, context);
      const statusCode = mapErrorToStatus(error);
      res.status(statusCode).json(toLegacyHTTPError(error));
      return;
    }

    Object.entries(SSE_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    setExtensionsHeader(res, context);
    res.flushHeaders();

    try {
      if (!firstResult.done) {
        res.write(formatSSEEvent(firstResult.value));
      }
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        res.write(formatSSEEvent(event));
      }
    } catch (streamError: unknown) {
      console.error('Legacy SSE streaming error:', streamError);
      if (!res.writableEnded) {
        res.write(formatSSEErrorEvent(toLegacyHTTPError(streamError)));
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  };

  /**
   * Centralized error handling for non-streaming route handlers.
   */
  const handleError = (res: Response, error: unknown): void => {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    const statusCode = mapErrorToStatus(error);
    res.status(statusCode).json(toLegacyHTTPError(error));
  };

  /**
   * Wraps an async route handler with centralized error handling.
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

  // ==========================================================================
  // Route Handlers
  // ==========================================================================

  /**
   * GET /v1/card
   *
   * Retrieves the authenticated extended agent card.
   */
  router.get(
    '/v1/card',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.getAuthenticatedExtendedAgentCard(context);
      sendResponse<legacy.AgentCard>(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * POST /v1/message:send
   *
   * Sends a message synchronously. Returns either a v0.3 `Task` or `Message`.
   * The colon is escaped to satisfy Express's path-to-regexp parser.
   */
  router.post(
    '/v1/message\\:send',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = req.body as legacy.MessageSendParams;
      const result = await transportHandler.sendMessage(params, context);
      // Match the v0.3 reference status: 201 Created for successful sends.
      sendResponse(res, HTTP_STATUS.CREATED, context, result);
    })
  );

  /**
   * POST /v1/message:stream
   *
   * Sends a message with a streaming SSE response.
   */
  router.post(
    '/v1/message\\:stream',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = req.body as legacy.MessageSendParams;
      const stream = await transportHandler.sendMessageStream(params, context);
      await sendStreamResponse(res, stream, context);
    })
  );

  /**
   * GET /v1/tasks/:taskId
   *
   * Retrieves a task. Accepts both `?historyLength=` and `?history_length=`
   * for compatibility with the v0.3 reference (which used snake_case query
   * parameters in places).
   */
  router.get(
    '/v1/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const historyLength = req.query.historyLength ?? req.query.history_length;
      const result = await transportHandler.getTask(req.params.taskId!, context, historyLength);
      sendResponse<legacy.Task>(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * POST /v1/tasks/:taskId:cancel
   *
   * Attempts to cancel a task. Returns 202 Accepted on success.
   */
  router.post(
    '/v1/tasks/:taskId\\:cancel',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.cancelTask(req.params.taskId!, context);
      sendResponse<legacy.Task>(res, HTTP_STATUS.ACCEPTED, context, result);
    })
  );

  /**
   * POST /v1/tasks/:taskId:subscribe
   *
   * Resubscribes to a task's update stream via SSE.
   */
  router.post(
    '/v1/tasks/:taskId\\:subscribe',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const stream = await transportHandler.resubscribe(req.params.taskId!, context);
      await sendStreamResponse(res, stream, context);
    })
  );

  /**
   * POST /v1/tasks/:taskId/pushNotificationConfigs
   *
   * Creates a push notification configuration. Returns 201 Created.
   */
  router.post(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = req.body as legacy.TaskPushNotificationConfig;
      const result = await transportHandler.setTaskPushNotificationConfig(params, context);
      sendResponse<legacy.TaskPushNotificationConfig>(res, HTTP_STATUS.CREATED, context, result);
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs
   *
   * Lists all push notification configurations for a task.
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.listTaskPushNotificationConfigs(
        req.params.taskId!,
        context
      );
      sendResponse<legacy.TaskPushNotificationConfig[]>(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Retrieves a specific push notification configuration.
   */
  router.get(
    '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.getTaskPushNotificationConfig(
        req.params.taskId!,
        req.params.configId!,
        context
      );
      sendResponse<legacy.TaskPushNotificationConfig>(res, HTTP_STATUS.OK, context, result);
    })
  );

  /**
   * DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
   *
   * Deletes a push notification configuration. Returns 204 No Content.
   */
  router.delete(
    '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      await transportHandler.deleteTaskPushNotificationConfig(
        req.params.taskId!,
        req.params.configId!,
        context
      );
      sendResponse(res, HTTP_STATUS.NO_CONTENT, context);
    })
  );

  // Note: `/v1/tasks` (ListTasks) is intentionally NOT registered.
  // Per `V1_METHODS_WITHOUT_LEGACY_EQUIVALENT` (in `compat/v0_3/constants.ts`),
  // the v0.3 protocol has no REST endpoint for listing tasks, so an
  // attempt to GET `/v1/tasks` falls through to Express's default 404.

  return router;
}
