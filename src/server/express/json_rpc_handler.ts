import express, {
  Request,
  Response,
  ErrorRequestHandler,
  NextFunction,
  RequestHandler,
} from 'express';
import { JSONRPCErrorResponse } from '../../core.js';
import { JSONRPCResponse } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { ServerCallContextBuilder, defaultServerCallContextBuilder } from '../context.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER, JSON_CONTENT_TYPE } from '../../constants.js';
import { UserBuilder, delegateAsyncIterator } from './common.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import { Extensions } from '../../extensions.js';
import { A2A_ERROR_CODE, ContentTypeNotSupportedError } from '../../errors/index.js';
import { validateVersion } from '../version.js';
import { LegacyJsonRpcTransportHandler } from '../../compat/v0_3/server/index.js';
import {
  LEGACY_HTTP_EXTENSION_HEADER,
  LEGACY_METHOD_TASKS_RESUBSCRIBE,
  isLegacyJsonRpcMethod,
  isV1JsonRpcMethod,
} from '../../compat/v0_3/index.js';

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
  /**
   * Enables the v0.3 protocol compatibility layer. When enabled, the
   * handler inspects each request body's `method` field and routes
   * v0.3 method names (`message/send`, `tasks/get`, …) through the
   * v0.3 compat module. The agent card MUST also declare a v0.3
   * `JSONRPC` interface in `supportedInterfaces`.
   *
   * Default: omitted (disabled). Disabled v0.3-shaped requests surface
   * as JSON-RPC `method not found` (-32601).
   */
  legacyCompat?: { enabled: boolean };
  contextBuilder?: ServerCallContextBuilder;
}

/**
 * Returns `true` if the body looks like a v0.3 JSON-RPC request. v1.0
 * method names are PascalCase (`SendMessage`); v0.3 use `namespace/verb`
 * (`message/send`), so the two grammars are disjoint.
 */
function isLegacyRequest(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return isLegacyJsonRpcMethod((body as { method?: unknown }).method);
}

/**
 * Returns `true` for bodies that should fall through to the v0.3
 * dispatcher when `legacyCompat` is enabled: missing or unknown
 * `method`.
 */
function shouldUseLegacyFallback(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return !isV1JsonRpcMethod((body as { method?: unknown }).method);
}

/**
 * Creates Express.js middleware handling A2A JSON-RPC requests.
 *
 * @example
 * ```ts
 * app.use(jsonRpcHandler({
 *   requestHandler: a2aRequestHandler,
 *   userBuilder: UserBuilder.noAuthentication,
 * }));
 * ```
 */
export function jsonRpcHandler(options: JsonRpcHandlerOptions): RequestHandler {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);
  const legacyJsonRpcTransportHandler = options.legacyCompat?.enabled
    ? new LegacyJsonRpcTransportHandler(options.requestHandler)
    : undefined;

  const router = express.Router();

  // Reject non-JSON content types up front. Without this, `express.json()`
  // would silently ignore the body and the dispatcher would surface a
  // misleading InvalidParamsError (-32602).
  router.use(contentTypeGuard);
  router.use(express.json(), jsonErrorHandler);

  router.post('/', async (req: Request, res: Response) => {
    const useLegacy =
      legacyJsonRpcTransportHandler !== undefined &&
      (isLegacyRequest(req.body) || shouldUseLegacyFallback(req.body));
    const mapToError = useLegacy
      ? LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError
      : JsonRpcTransportHandler.mapToJSONRPCError;
    try {
      const user = await options.userBuilder(req);
      const requestedVersion = req.header(A2A_VERSION_HEADER) || undefined;
      // On the legacy path, accept both the v0.3 `X-A2A-Extensions`
      // header (preferred) and the v1.0 `A2A-Extensions` header as a
      // fallback. On the v1.0 path, stay strict on the v1.0 spelling.
      const requestedExtensionsHeader = useLegacy
        ? (req.header(LEGACY_HTTP_EXTENSION_HEADER) ?? req.header(HTTP_EXTENSION_HEADER))
        : req.header(HTTP_EXTENSION_HEADER);
      const ctxBuilder = options.contextBuilder ?? defaultServerCallContextBuilder;
      const context = ctxBuilder({
        extensions: Extensions.parseServiceParameter(requestedExtensionsHeader),
        user,
        headers: req.headers,
        requestedVersion,
      });
      const agentCard = await options.requestHandler.getAgentCard();
      validateVersion(context.requestedVersion, agentCard, 'JSONRPC');
      const transportHandler = useLegacy ? legacyJsonRpcTransportHandler : jsonRpcTransportHandler;
      const rpcResponseOrStream = await transportHandler.handle(req.body, context);

      if (context.activatedExtensions) {
        // Legacy path responds with the v0.3 `X-A2A-Extensions`
        // spelling; v1.0 path responds with `A2A-Extensions`.
        res.setHeader(
          useLegacy ? LEGACY_HTTP_EXTENSION_HEADER : HTTP_EXTENSION_HEADER,
          Array.from(context.activatedExtensions)
        );
      }
      if (typeof (rpcResponseOrStream as AsyncGenerator)?.[Symbol.asyncIterator] === 'function') {
        const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCResponse, void, undefined>;

        const alwaysStreamSse =
          useLegacy &&
          (req.body as { method?: unknown })?.method === LEGACY_METHOD_TASKS_RESUBSCRIBE;
        if (alwaysStreamSse) {
          Object.entries(SSE_HEADERS).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
          res.flushHeaders();
          try {
            for await (const event of stream) {
              res.write(formatSSEEvent(event));
            }
          } catch (streamError) {
            console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
            const errorResponse: JSONRPCErrorResponse = {
              jsonrpc: '2.0',
              id: req.body?.id || null,
              error: mapToError(streamError),
            };
            if (!res.writableEnded) {
              res.write(formatSSEErrorEvent(errorResponse));
            }
          } finally {
            if (!res.writableEnded) {
              res.end();
            }
          }
          return;
        }

        // Peek the first event BEFORE flushing SSE headers so an early
        // failure (e.g. `resubscribe` on a terminal task, which throws
        // UnsupportedOperationError) surfaces as a proper JSON-RPC
        // error with the right HTTP status, rather than a 200 SSE
        // stream carrying a single error event that looks like a
        // successful subscription to most clients.
        const iterator = stream[Symbol.asyncIterator]();
        let firstResult: IteratorResult<JSONRPCResponse>;
        try {
          firstResult = await iterator.next();
        } catch (streamError) {
          console.error(`Pre-stream error for request ${req.body?.id}:`, streamError);
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: mapToError(streamError),
          };
          res.status(200).json(errorResponse);
          return;
        }

        // First event succeeded — switch to SSE.
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.flushHeaders();

        try {
          if (!firstResult.done) {
            res.write(formatSSEEvent(firstResult.value));
          }
          for await (const event of delegateAsyncIterator(iterator)) {
            res.write(formatSSEEvent(event));
          }
        } catch (streamError) {
          console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: mapToError(streamError),
          };
          if (!res.headersSent) {
            // Shouldn't happen if flushHeaders worked.
            res.status(500).json(errorResponse);
          } else {
            // Try to send as a last SSE event; client may have disconnected.
            res.write(formatSSEErrorEvent(errorResponse));
          }
        } finally {
          if (!res.writableEnded) {
            res.end();
          }
        }
      } else {
        const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
        res.status(200).json(rpcResponse);
      }
    } catch (error) {
      // Catches errors from `handle` itself (e.g. initial parse error).
      console.error('Unhandled error in JSON-RPC POST handler:', error);
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: mapToError(error),
      };
      if (!res.headersSent) {
        res.status(500).json(errorResponse);
      } else if (!res.writableEnded) {
        // Likely a stream attempt that failed early.
        res.end();
      }
    }
  });

  return router;
}

/**
 * Express middleware rejecting requests whose Content-Type is not
 * `application/json` with `ContentTypeNotSupportedError`. Bodyless
 * requests and requests without a Content-Type header pass through.
 */
const contentTypeGuard: RequestHandler = (req, res, next) => {
  const rawContentType = req.header('content-type');
  if (!rawContentType) {
    next();
    return;
  }
  // Strip charset and other params before comparing.
  const mediaType = rawContentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType === JSON_CONTENT_TYPE) {
    next();
    return;
  }
  const errorResponse: JSONRPCErrorResponse = {
    jsonrpc: '2.0',
    id: null,
    error: JsonRpcTransportHandler.mapToJSONRPCError(
      new ContentTypeNotSupportedError(
        `Unsupported Content-Type "${rawContentType}"; expected application/json.`
      )
    ),
  };
  res.status(400).json(errorResponse);
};

export const jsonErrorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  // Handle JSON parse errors from express.json() (https://github.com/expressjs/body-parser/issues/122)
  if (err instanceof SyntaxError && 'body' in err) {
    const errorResponse: JSONRPCErrorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: A2A_ERROR_CODE.PARSE_ERROR,
        message: 'Invalid JSON payload.',
      },
    };
    return res.status(400).json(errorResponse);
  }
  next(err);
};
