/**
 * v0.3 HTTP+JSON (REST) Express handler. Mounts the v0.3 REST endpoints
 * under the `/v1/...` path prefix and delegates to
 * {@link LegacyRestTransportHandler} for the v0.3 ↔ v1.0 translation.
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
import { UserBuilder, delegateAsyncIterator } from '../../../../server/express/common.js';
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

/** Options for the legacy v0.3 HTTP+JSON/REST handler. */
export interface LegacyRestHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/** Converts JSON parse errors from `express.json()` to v0.3-shaped 400 responses. */
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

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Creates an Express router exposing the v0.3 HTTP+JSON/REST endpoints
 * at the canonical v0.3 reference URLs (`/v1/card`, `/v1/message:send`,
 * etc.). Dispatch is header-based: requests whose `A2A-Version` is not
 * in `[0.3, 1.0)` are routed via `next('router')` to the parent's v1.0
 * middleware.
 *
 * Responds with `application/json` (v0.3 spelling); errors use the bare
 * v0.3 `{ code, message, data? }` shape. Reads both `X-A2A-Extensions`
 * (preferred) and `A2A-Extensions` (fallback) from incoming requests.
 *
 * @example
 * ```ts
 * import { legacyRestRouter } from '@a2a-js/sdk/compat/v0_3/server/express';
 * app.use(legacyRestRouter({ requestHandler, userBuilder }));
 * ```
 */
export function legacyRestRouter(options: LegacyRestHandlerOptions): RequestHandler {
  const router = express.Router();
  const transportHandler = new LegacyRestTransportHandler(options.requestHandler);

  // Hand off non-legacy requests to the parent router. Header-less
  // requests default to '0.3' and stay here. This keeps the body
  // parser, content-type setter, and error handler below isolated from
  // v1.0 traffic.
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
    // `strict: false` so the parser accepts top-level JSON primitives.
    // The v0.3 reference clients (a2a-go, a2a-python) issue empty
    // POSTs by marshaling `nil` to literal `null`; strict mode would
    // reject that 4-byte body with a 400 SyntaxError.
    express.json({ type: LEGACY_JSON_CONTENT_TYPE, strict: false }),
    legacyRestErrorHandler
  );

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
    // Strict per-interface check: the card must declare a HTTP+JSON
    // interface at `protocolVersion: '0.3'`.
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');
    return context;
  };

  const setExtensionsHeader = (res: Response, context: ServerCallContext): void => {
    if (context.activatedExtensions) {
      res.setHeader(LEGACY_HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
    }
  };

  /**
   * Sends a JSON response. `body` must already be proto-JSON of the
   * matching v0.3 proto type. 204 emits no body. v0.3 REST emits
   * proto-JSON of the v0.3 proto types — not the v0.3 JSON-RPC shape
   * with `kind` discriminators on parts.
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

  /** v0.3 `Task | Message` → proto-JSON of `SendMessageResponse`. */
  const encodeSendMessageResult = (result: legacy.Task | legacy.Message): unknown => {
    const protoResult = ToProto.messageSendResult(result);
    if (!protoResult) {
      throw LegacyA2AError.internalError('sendMessage produced no result.');
    }
    return LegacyProtoSendMessageResponse.toJSON(protoResult);
  };

  const encodeTask = (task: legacy.Task): unknown => {
    return LegacyProtoTask.toJSON(ToProto.task(task));
  };

  const encodeTaskPushNotificationConfig = (cfg: legacy.TaskPushNotificationConfig): unknown => {
    return LegacyProtoTaskPushNotificationConfig.toJSON(ToProto.taskPushNotificationConfig(cfg));
  };

  const encodeAgentCard = (card: legacy.AgentCard): unknown => {
    return LegacyProtoAgentCard.toJSON(ToProto.agentCard(card));
  };

  const encodeListTaskPushNotificationConfigs = (
    configs: legacy.TaskPushNotificationConfig[]
  ): unknown => {
    return LegacyProtoListTaskPushNotificationConfigResponse.toJSON({
      configs: configs.map((c) => ToProto.taskPushNotificationConfig(c)),
      nextPageToken: '',
    });
  };

  const decodeSendMessageRequest = (rawBody: unknown): legacy.MessageSendParams => {
    const proto = LegacyProtoSendMessageRequest.fromJSON(rawBody ?? {});
    return FromProto.messageSendParams(proto);
  };

  const decodeTaskPushNotificationConfig = (
    rawBody: unknown
  ): legacy.TaskPushNotificationConfig => {
    const proto = LegacyProtoTaskPushNotificationConfig.fromJSON(rawBody ?? {});
    return FromProto.taskPushNotificationConfig(proto);
  };

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
   * Streams events as SSE. Pulls the first event before flushing
   * headers so an early failure surfaces as a proper HTTP error code
   * instead of a 200 with a single error event.
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
      for await (const event of delegateAsyncIterator(iterator)) {
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

  const asyncHandler = (handler: AsyncRouteHandler): AsyncRouteHandler => {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await handler(req, res);
      } catch (error) {
        handleError(res, error);
      }
    };
  };

  // Routes use the canonical v0.3 reference URLs (`/v1/...`). The
  // version-dispatch middleware above ensures only legacy-range
  // requests reach these routes.

  // GET /v1/card
  router.get(
    '/v1/card',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.getAuthenticatedExtendedAgentCard(context);
      sendResponse(res, HTTP_STATUS.OK, context, encodeAgentCard(result));
    })
  );

  // POST /v1/message:send (colon escaped for Express).
  router.post(
    '/v1/message\\:send',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = decodeSendMessageRequest(req.body);
      const result = await transportHandler.sendMessage(params, context);
      // 201 Created matches the v0.3 reference.
      sendResponse(res, HTTP_STATUS.CREATED, context, encodeSendMessageResult(result));
    })
  );

  // POST /v1/message:stream (SSE).
  router.post(
    '/v1/message\\:stream',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = decodeSendMessageRequest(req.body);
      const stream = await transportHandler.sendMessageStream(params, context);
      await sendStreamResponse(res, stream, context);
    })
  );

  // Route order matters: Express 5's path-to-regexp v8 matches `:param`
  // greedily up to the next `/`, including literal `:`. So
  // `GET /v1/tasks/:taskId` would swallow `:subscribe` and `:cancel` if
  // registered first. The more specific routes must come first.

  // POST /v1/tasks/:taskId:cancel — returns 200 OK with the
  // post-cancellation Task. v0.3 reference clients treat anything
  // other than 200 as a hard error.
  router.post(
    '/v1/tasks/:taskId\\:cancel',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const result = await transportHandler.cancelTask(req.params.taskId!, context);
      sendResponse(res, HTTP_STATUS.OK, context, encodeTask(result));
    })
  );

  // GET or POST /v1/tasks/:taskId:subscribe — resubscribe via SSE. The
  // v0.3 reference only registers GET; we also accept POST for tolerance
  // with v1.0-shaped clients.
  const resubscribeHandler = asyncHandler(async (req, res) => {
    const context = await buildContext(req);
    const stream = await transportHandler.resubscribe(req.params.taskId!, context);
    await sendStreamResponse(res, stream, context);
  });
  router.get('/v1/tasks/:taskId\\:subscribe', resubscribeHandler);
  router.post('/v1/tasks/:taskId\\:subscribe', resubscribeHandler);

  // GET /v1/tasks/:taskId — accepts both `historyLength` and
  // `history_length` for compat with v0.3 reference servers that used
  // snake_case query parameters.
  router.get(
    '/v1/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const historyLength = req.query.historyLength ?? req.query.history_length;
      const result = await transportHandler.getTask(req.params.taskId!, context, historyLength);
      sendResponse(res, HTTP_STATUS.OK, context, encodeTask(result));
    })
  );

  // POST /v1/tasks/:taskId/pushNotificationConfigs
  router.post(
    '/v1/tasks/:taskId/pushNotificationConfigs',
    asyncHandler(async (req, res) => {
      const context = await buildContext(req);
      const params = decodeTaskPushNotificationConfig(req.body);
      const result = await transportHandler.setTaskPushNotificationConfig(params, context);
      sendResponse(res, HTTP_STATUS.CREATED, context, encodeTaskPushNotificationConfig(result));
    })
  );

  // GET /v1/tasks/:taskId/pushNotificationConfigs
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

  // GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
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

  // DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
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

  // `/v1/tasks` (ListTasks) is intentionally NOT registered: the v0.3
  // protocol has no REST endpoint for listing tasks.

  return router;
}
