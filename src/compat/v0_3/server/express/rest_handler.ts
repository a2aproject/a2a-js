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

import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../../../constants.js';
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
import { isLegacyVersion } from '../../translate/versions.js';
import type * as legacy from '../../types/types.js';
import {
  ListTaskPushNotificationConfigResponse as LegacyProtoListTaskPushNotificationConfigResponse,
  SendMessageRequest as LegacyProtoSendMessageRequest,
  SendMessageResponse as LegacyProtoSendMessageResponse,
  StreamResponse as LegacyProtoStreamResponse,
  Task as LegacyProtoTask,
  TaskPushNotificationConfig as LegacyProtoTaskPushNotificationConfig,
  AgentCard as LegacyProtoAgentCard,
} from '../../types/pb/a2a.js';
import { FromProto } from '../../types/converters/from_proto.js';
import { ToProto } from '../../types/converters/to_proto.js';
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
 * The router uses **header-based dispatch**, not path-based: a
 * middleware at the top of the chain parses `A2A-Version` (defaulting
 * to `'0.3'` per §3.6.2 when absent) and short-circuits any request
 * whose version is not in the legacy range `[0.3, 1.0)` by calling
 * `next('router')`, falling through to the parent's v1.0 middleware.
 *
 * The routes are registered at the canonical v0.3 reference URLs
 * (`/v1/card`, `/v1/message:send`, `/v1/tasks/:taskId`, …). The router
 * is mounted path-less by the core `restHandler` so the v1.0 spec's
 * tenant routes (`/:tenant/...`) remain free to use `v1` (or any other
 * label) as a tenant identifier.
 *
 * The router:
 *   - Parses `application/json` bodies via {@link LEGACY_JSON_CONTENT_TYPE}.
 *   - Reads protocol extensions from `X-A2A-Extensions` (the v0.3
 *     header) OR `A2A-Extensions` (the v1.0 header) for tolerance with
 *     v1.0-shaped clients hitting the legacy endpoints; if both are
 *     present the legacy header wins. Responses use the v0.3 spelling.
 *   - Defaults a missing `A2A-Version` header to
 *     {@link A2A_LEGACY_PROTOCOL_VERSION} (`'0.3'`).
 *   - Sets the response `Content-Type` to {@link LEGACY_JSON_CONTENT_TYPE}
 *     (`application/json`, not `application/a2a+json`).
 *   - Returns errors in the bare v0.3 `{ code, message, data? }` shape.
 *
 * @example
 * ```ts
 * import { legacyRestRouter } from '@a2a-js/sdk/compat/v0_3/server/express';
 * app.use(legacyRestRouter({ requestHandler, userBuilder }));
 * // → POST /v1/message:send
 * // → GET  /v1/tasks/:taskId
 * // …
 * ```
 */
export function legacyRestRouter(options: LegacyRestHandlerOptions): RequestHandler {
  const router = express.Router();
  const transportHandler = new LegacyRestTransportHandler(options.requestHandler);

  // Version-based dispatch: short-circuit anything that isn't in the
  // legacy range `[0.3, 1.0)` (per `isLegacyVersion`) by handing off to
  // the parent router via `next('router')`. Header-less requests
  // default to `'0.3'` per §3.6.2 and stay in this router. This ensures
  // body parser, content-type setter and error handler below NEVER run
  // for non-legacy requests, preserving wire-shape isolation.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    const requestedVersion = req.header(A2A_VERSION_HEADER) || A2A_LEGACY_PROTOCOL_VERSION;
    if (isLegacyVersion(requestedVersion)) {
      next();
    } else {
      next('router');
    }
  });

  router.use(
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Type', LEGACY_JSON_CONTENT_TYPE);
      next();
    },
    // `strict: false` so the parser accepts JSON primitives at the top
    // level. The v0.3 reference clients (a2a-go's `aclient/rest.go` and
    // a2a-python's REST client) issue empty-payload POSTs by marshaling
    // `nil` to the literal `null` — with strict mode body-parser would
    // reject that 4-byte body with a 400 SyntaxError before any route
    // handler runs. See the parallel fix in `server/express/rest_handler.ts`.
    express.json({ type: LEGACY_JSON_CONTENT_TYPE, strict: false }),
    legacyRestErrorHandler
  );

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Builds a {@link ServerCallContext} from the Express request.
   * - Extracts protocol extensions from `X-A2A-Extensions` (v0.3
   *   spelling, preferred) OR `A2A-Extensions` (v1.0 spelling,
   *   fallback) — server-side tolerance for v1.0-shaped clients
   *   hitting the legacy endpoints.
   * - Resolves the authenticated user.
   * - Defaults the A2A version to {@link A2A_LEGACY_PROTOCOL_VERSION}
   *   when the `A2A-Version` header is absent or empty (matches the
   *   v0.3 default specified in §3.6.2).
   * - Propagates the URL tenant (if any) via `context.tenant`. The
   *   legacy router doesn't currently register `:tenant` parameter
   *   routes, so this is a no-op today but stays forward-compatible
   *   for future tenant-aware route registrations.
   * - Validates the requested version against the agent card's
   *   `HTTP+JSON` interface list.
   */
  const buildContext = async (req: Request): Promise<ServerCallContext> => {
    const user = await options.userBuilder(req);
    const requestedVersion = req.header(A2A_VERSION_HEADER) || A2A_LEGACY_PROTOCOL_VERSION;
    const context = new ServerCallContext({
      requestedExtensions: Extensions.parseServiceParameter(
        req.header(LEGACY_HTTP_EXTENSION_HEADER) ?? req.header(HTTP_EXTENSION_HEADER)
      ),
      user,
      requestedVersion,
      tenant: (req.params.tenant as string) || undefined,
    });
    const agentCard = await transportHandler.getAgentCard();
    // This router is only mounted when the operator opted into
    // `legacyCompat`, so the validator implicitly accepts '0.3' for
    // any binding the card already exposes (per §3.6.2). This lets a
    // v1.0-only card serve legacy clients without forcing operators
    // to duplicate every v1.0 `supportedInterfaces` entry with a v0.3
    // stub.
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON', {
      legacyCompat: { enabled: true },
    });
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
   * Sends a JSON response with the given status code. The body is
   * pre-serialized proto-JSON (already passed through the matching
   * proto type's `toJSON` by the route handler). For 204 responses the
   * body is omitted.
   *
   * v0.3 REST emits proto-JSON of the v0.3 proto types — per the v0.3
   * a2a.proto's `google.api.http` annotations + `body: "*"` mapping
   * (matching what a2a-python's `A2ARESTFastAPIApplication` and
   * a2a-go's REST router emit). This is NOT the v0.3 JSON-RPC body
   * shape with `kind` discriminators on parts.
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
   * Encodes a legacy `Task | Message` (the v0.3 result of
   * `message/send`) as proto-JSON of `SendMessageResponse`. This is
   * the wire-shape v0.3 REST clients expect (a2a-python's REST handler
   * runs the response through `proto_utils.ToProto.message_send_result`
   * and serializes via `json_format`).
   */
  const encodeSendMessageResult = (result: legacy.Task | legacy.Message): unknown => {
    const protoResult = ToProto.messageSendResult(result);
    if (!protoResult) {
      throw LegacyA2AError.internalError('sendMessage produced no result.');
    }
    return LegacyProtoSendMessageResponse.toJSON(protoResult);
  };

  /** Legacy `Task` → proto-JSON of `Task`. */
  const encodeTask = (task: legacy.Task): unknown => {
    return LegacyProtoTask.toJSON(ToProto.task(task));
  };

  /** Legacy `TaskPushNotificationConfig` → proto-JSON. */
  const encodeTaskPushNotificationConfig = (cfg: legacy.TaskPushNotificationConfig): unknown => {
    return LegacyProtoTaskPushNotificationConfig.toJSON(ToProto.taskPushNotificationConfig(cfg));
  };

  /**
   * Legacy `AgentCard` → proto-JSON. Used for the
   * `GET /v1/card` (authenticated extended card) response.
   */
  const encodeAgentCard = (card: legacy.AgentCard): unknown => {
    return LegacyProtoAgentCard.toJSON(ToProto.agentCard(card));
  };

  /**
   * Legacy `TaskPushNotificationConfig[]` → proto-JSON of
   * `ListTaskPushNotificationConfigResponse` (wraps the list in a
   * `configs[]` field per the v0.3 proto).
   */
  const encodeListTaskPushNotificationConfigs = (
    configs: legacy.TaskPushNotificationConfig[]
  ): unknown => {
    return LegacyProtoListTaskPushNotificationConfigResponse.toJSON({
      configs: configs.map((c) => ToProto.taskPushNotificationConfig(c)),
      nextPageToken: '',
    });
  };

  /**
   * Decodes a proto-JSON `SendMessageRequest` body into the legacy
   * `MessageSendParams` shape the rest of the transport handler
   * consumes. Mirrors the inverse of `encodeSendMessageResult`.
   */
  const decodeSendMessageRequest = (rawBody: unknown): legacy.MessageSendParams => {
    const proto = LegacyProtoSendMessageRequest.fromJSON(rawBody ?? {});
    const legacyParams = FromProto.messageSendParams(proto);
    return legacyParams;
  };

  /** Decodes proto-JSON `TaskPushNotificationConfig` into the legacy shape. */
  const decodeTaskPushNotificationConfig = (
    rawBody: unknown
  ): legacy.TaskPushNotificationConfig => {
    const proto = LegacyProtoTaskPushNotificationConfig.fromJSON(rawBody ?? {});
    return FromProto.taskPushNotificationConfig(proto);
  };

  /**
   * Encodes a single legacy stream result (`Task | Message |
   * TaskStatusUpdateEvent | TaskArtifactUpdateEvent`) as proto-JSON of
   * `StreamResponse` (a `oneof payload` envelope). This is the
   * SSE event-data wire shape v0.3 REST clients expect.
   */
  const encodeStreamEvent = (
    event: legacy.SendStreamingMessageSuccessResponse['result']
  ): unknown => {
    const proto = ToProto.messageStreamResult(event);
    if (!proto) {
      throw LegacyA2AError.internalError('Stream produced an unrepresentable event.');
    }
    return LegacyProtoStreamResponse.toJSON(proto);
  };

  /**
   * Streams events back as Server-Sent Events. Each event's `data:`
   * field is the proto-JSON serialization of `StreamResponse`.
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
        res.write(formatSSEEvent(encodeStreamEvent(firstResult.value)));
      }
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        res.write(formatSSEEvent(encodeStreamEvent(event)));
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

  // The routes below use the canonical v0.3 reference URLs (`/v1/...`).
  // The router is mounted path-less by the core `restHandler`; the
  // version-dispatch middleware above ensures only legacy-range requests
  // reach these routes. Requests with `A2A-Version: 1.0` (or any other
  // non-legacy version) targeting the same paths fall through to the
  // v1.0 router, where `/v1/...` is interpreted as `/:tenant/...` with
  // `tenant='v1'` per v1.0 tenant semantics.

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
      sendResponse(res, HTTP_STATUS.OK, context, encodeAgentCard(result));
    })
  );

  /**
   * POST /v1/message:send
   *
   * Sends a message synchronously. Returns proto-JSON of
   * `SendMessageResponse` (a `oneof payload { task | msg }` envelope).
   * The colon is escaped to satisfy Express's path-to-regexp parser.
   */
  router.post(
    '/v1/message\\:send',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = decodeSendMessageRequest(req.body);
      const result = await transportHandler.sendMessage(params, context);
      // Match the v0.3 reference status: 201 Created for successful sends.
      sendResponse(res, HTTP_STATUS.CREATED, context, encodeSendMessageResult(result));
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
      const params = decodeSendMessageRequest(req.body);
      const stream = await transportHandler.sendMessageStream(params, context);
      await sendStreamResponse(res, stream, context);
    })
  );

  // Route registration order matters: Express 5's path-to-regexp v8
  // matches `:param` GREEDILY — it captures everything up to the next
  // `/`, including a literal `:`. So `GET /v1/tasks/:taskId` would
  // swallow `GET /v1/tasks/{id}:subscribe` (capturing `taskId =
  // "{id}:subscribe"`) if registered first. The same goes for `:cancel`.
  // We therefore register the more specific `:cancel` / `:subscribe`
  // routes BEFORE the generic `:taskId` route. (Express 4's
  // path-to-regexp v0 anchored on the literal `:`, so this ordering
  // was a no-op there.)

  /**
   * POST /v1/tasks/:taskId:cancel
   *
   * Attempts to cancel a task. Returns 200 OK with the
   * post-cancellation Task. (Not 202 Accepted: the response body is
   * the fully-materialized Task, and v0.3 reference clients — both
   * a2a-go's and a2a-python's REST transports — treat anything other
   * than 200 as a hard error.)
   */
  router.post(
    '/v1/tasks/:taskId\\:cancel',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.cancelTask(req.params.taskId!, context);
      sendResponse(res, HTTP_STATUS.OK, context, encodeTask(result));
    })
  );

  /**
   * GET or POST /v1/tasks/:taskId:subscribe
   *
   * Resubscribes to a task's update stream via SSE.
   *
   * The v0.3 proto's `google.api.http` annotation for `SubscribeToTask`
   * maps to `get: "/v1/tasks/{id}:subscribe"` (no request body), and
   * the canonical v0.3 reference (`A2ARESTFastAPIApplication` in
   * a2a-python <= 0.3.24) only registers GET. A subset of v0.3
   * compatibility adapters (e.g. a2a-python's `src/a2a/compat/v0_3/`)
   * additionally accept POST for tolerance. We register both: GET so
   * we can be called by the v0.3 reference (this is required for
   * interop with the python_v03 / go_v03 baselines), and POST so
   * existing v1.0-shaped clients that send POST keep working.
   */
  const resubscribeHandler = asyncHandler(async (req, res) => {
    const context = await buildContext(req);
    const stream = await transportHandler.resubscribe(req.params.taskId!, context);
    await sendStreamResponse(res, stream, context);
  });
  router.get('/v1/tasks/:taskId\\:subscribe', resubscribeHandler);
  router.post('/v1/tasks/:taskId\\:subscribe', resubscribeHandler);

  /**
   * GET /v1/tasks/:taskId
   *
   * Retrieves a task. Accepts both `?historyLength=` and `?history_length=`
   * for compatibility with the v0.3 reference (which used snake_case query
   * parameters in places). Registered AFTER `:cancel` / `:subscribe` so
   * the param doesn't greedily swallow the literal-colon suffixes — see
   * note above.
   */
  router.get(
    '/v1/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const historyLength = req.query.historyLength ?? req.query.history_length;
      const result = await transportHandler.getTask(req.params.taskId!, context, historyLength);
      sendResponse(res, HTTP_STATUS.OK, context, encodeTask(result));
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
      const params = decodeTaskPushNotificationConfig(req.body);
      const result = await transportHandler.setTaskPushNotificationConfig(params, context);
      sendResponse(res, HTTP_STATUS.CREATED, context, encodeTaskPushNotificationConfig(result));
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
      sendResponse(res, HTTP_STATUS.OK, context, encodeListTaskPushNotificationConfigs(result));
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
      sendResponse(res, HTTP_STATUS.OK, context, encodeTaskPushNotificationConfig(result));
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
  // the v0.3 protocol has no REST endpoint for listing tasks. A
  // request to `GET /v1/tasks` with `A2A-Version: 0.3` therefore
  // matches no legacy route and falls through to the parent router
  // (where v1.0 may handle it as `/:tenant/tasks` with `tenant='v1'`,
  // and version validation against the agent card will reject it
  // unless the operator explicitly opted into a hybrid configuration).

  return router;
}
