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
import { ServerCallContext } from '../context.js';
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER, JSON_CONTENT_TYPE } from '../../constants.js';
import { UserBuilder } from './common.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import { Extensions } from '../../extensions.js';
import { ContentTypeNotSupportedError, RequestMalformedError } from '../../errors.js';
import { validateVersion } from '../version.js';
import { LegacyJsonRpcTransportHandler, isLegacyJsonRpcMethod } from '../../compat/v0_3/index.js';
import { LEGACY_HTTP_EXTENSION_HEADER } from '../../compat/v0_3/constants.js';

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
  /**
   * Enables the v0.3 protocol compatibility layer.
   *
   * When enabled, the handler inspects each incoming JSON-RPC request
   * body's `method` field; if it matches a known v0.3 method name
   * (e.g. `message/send`, `tasks/get`), the request is routed through
   * the v0.3 compat module instead of the v1.0 dispatcher.
   *
   * Default: omitted (treated as disabled). To accept v0.3 JSON-RPC
   * clients, the agent card MUST also declare a v0.3 `JSONRPC`
   * interface in `supportedInterfaces`; see §3.6.2.
   *
   * When disabled, the v0.3 compat code is not instantiated, the
   * method-name inspection is skipped, and v0.3-shaped requests are
   * surfaced as JSON-RPC `method not found` errors (-32601) by the
   * v1.0 dispatcher.
   */
  legacyCompat?: { enabled: boolean };
}

/**
 * Returns `true` if the request body looks like a v0.3 JSON-RPC request
 * (i.e. its `method` field is one of the known v0.3 method names).
 *
 * Detection is based on the method name alone; v1.0 method names are
 * PascalCase identifiers (`SendMessage`, `GetTask`) and v0.3 method
 * names are `namespace/verb` strings (`message/send`, `tasks/get`), so
 * the two grammars are disjoint.
 */
function isLegacyRequest(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return isLegacyJsonRpcMethod((body as { method?: unknown }).method);
}

/**
 * Creates Express.js middleware to handle A2A JSON-RPC requests.
 * @example
 *
 * ```ts
 * // Handle at root
 * app.use(jsonRpcHandler({ requestHandler: a2aRequestHandler, userBuilder: UserBuilder.noAuthentication }));
 * // or
 * app.use('/a2a/json-rpc', jsonRpcHandler({ requestHandler: a2aRequestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function jsonRpcHandler(options: JsonRpcHandlerOptions): RequestHandler {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);
  // Only instantiate the v0.3 compat handler when the operator has
  // explicitly opted in. When omitted, v0.3-shaped requests fall
  // through to the v1.0 dispatcher which rejects them as
  // `method not found` (-32601).
  const legacyJsonRpcTransportHandler = options.legacyCompat?.enabled
    ? new LegacyJsonRpcTransportHandler(options.requestHandler)
    : undefined;

  const router = express.Router();

  // §9.1 JSON-RPC requests MUST use `application/json`. Reject any
  // other content type with `ContentTypeNotSupportedError` (-32005)
  // rather than letting `express.json()` ignore the body and the
  // dispatcher fall back to a misleading `InvalidParamsError` (-32602).
  router.use(contentTypeGuard);
  router.use(express.json(), jsonErrorHandler);

  router.post('/', async (req: Request, res: Response) => {
    const useLegacy = legacyJsonRpcTransportHandler !== undefined && isLegacyRequest(req.body);
    const mapToError = useLegacy
      ? LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError
      : JsonRpcTransportHandler.mapToJSONRPCError;
    try {
      const user = await options.userBuilder(req);
      const requestedVersion = req.header(A2A_VERSION_HEADER) || undefined;
      // On the legacy path, accept both the v0.3 `X-A2A-Extensions`
      // header (preferred — the v0.3 spec spelling) and the v1.0
      // `A2A-Extensions` header (fallback for tolerance with
      // v1.0-shaped clients hitting the compat layer). On the v1.0
      // path, stay strict on the v1.0 spelling — matches the REST
      // handler's behaviour.
      const requestedExtensionsHeader = useLegacy
        ? (req.header(LEGACY_HTTP_EXTENSION_HEADER) ?? req.header(HTTP_EXTENSION_HEADER))
        : req.header(HTTP_EXTENSION_HEADER);
      const context = new ServerCallContext({
        requestedExtensions: Extensions.parseServiceParameter(requestedExtensionsHeader),
        user,
        requestedVersion,
      });
      const agentCard = await options.requestHandler.getAgentCard();
      // The agent card is the single source of truth for which protocol
      // versions this transport accepts. `requestedVersion` defaults to
      // '0.3' when the A2A-Version header is absent (§3.6.2). When
      // `legacyCompat` is enabled, the validator implicitly accepts
      // '0.3' for any binding the card already exposes, so v0.3
      // clients (and header-less clients) succeed without requiring
      // operators to duplicate every v1.0 `supportedInterfaces` entry
      // with a v0.3 stub.
      validateVersion(context.requestedVersion, agentCard, 'JSONRPC', {
        legacyCompat: options.legacyCompat,
      });
      const transportHandler = useLegacy ? legacyJsonRpcTransportHandler : jsonRpcTransportHandler;
      const rpcResponseOrStream = await transportHandler.handle(req.body, context);

      if (context.activatedExtensions) {
        // Legacy path responds with the v0.3 `X-A2A-Extensions`
        // spelling; v1.0 path responds with `A2A-Extensions`. Matches
        // the REST handler's per-path response convention.
        res.setHeader(
          useLegacy ? LEGACY_HTTP_EXTENSION_HEADER : HTTP_EXTENSION_HEADER,
          Array.from(context.activatedExtensions)
        );
      }
      // Check if it's an AsyncGenerator (stream)
      if (typeof (rpcResponseOrStream as AsyncGenerator)?.[Symbol.asyncIterator] === 'function') {
        const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCResponse, void, undefined>;

        // Peek the first event BEFORE flushing SSE headers so that an
        // early failure (e.g. `resubscribe` on a terminal task, which
        // throws `UnsupportedOperationError`) surfaces as a proper
        // JSON-RPC error response with the right HTTP status rather
        // than a 200 SSE stream carrying a single error event — the
        // latter looks like a successful subscription to most clients.
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

        // First event succeeded — now switch to SSE.
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.flushHeaders();

        try {
          if (!firstResult.done) {
            res.write(formatSSEEvent(firstResult.value));
          }
          for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
            res.write(formatSSEEvent(event));
          }
        } catch (streamError) {
          console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: req.body?.id || null, // Use original request ID if available
            error: mapToError(streamError),
          };
          if (!res.headersSent) {
            // Should not happen if flushHeaders worked
            res.status(500).json(errorResponse);
          } else {
            // Try to send as last SSE event if possible, though client might have disconnected
            // Use shared formatSSEErrorEvent utility
            res.write(formatSSEErrorEvent(errorResponse));
          }
        } finally {
          if (!res.writableEnded) {
            res.end();
          }
        }
      } else {
        // Single JSON-RPC response
        const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
        res.status(200).json(rpcResponse);
      }
    } catch (error) {
      // Catch errors from jsonRpcTransportHandler.handle itself (e.g., initial parse error)
      console.error('Unhandled error in JSON-RPC POST handler:', error);
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: mapToError(error),
      };
      if (!res.headersSent) {
        res.status(500).json(errorResponse);
      } else if (!res.writableEnded) {
        // If headers sent (likely during a stream attempt that failed early), try to end gracefully
        res.end();
      }
    }
  });

  return router;
}

/**
 * Express middleware that rejects requests whose Content-Type is not
 * `application/json` (§9.1) with `ContentTypeNotSupportedError`
 * (-32005). Bodyless requests (GET, OPTIONS, …) and requests without a
 * Content-Type header pass through; only POSTs that explicitly declare
 * a non-JSON content type are rejected.
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
  // Per §5.4 ContentTypeNotSupportedError maps to HTTP 400.
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
      error: JsonRpcTransportHandler.mapToJSONRPCError(
        new RequestMalformedError('Invalid JSON payload.')
      ),
    };
    return res.status(400).json(errorResponse);
  }
  next(err);
};
