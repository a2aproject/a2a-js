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
import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UserBuilder } from './common.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import { Extensions } from '../../extensions.js';
import { RequestMalformedError } from '../../errors.js';
import { validateVersion } from '../version.js';

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
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

  const router = express.Router();

  router.use(express.json(), jsonErrorHandler);

  router.post('/', async (req: Request, res: Response) => {
    try {
      const user = await options.userBuilder(req);
      const requestedVersion = req.header(A2A_VERSION_HEADER) || undefined;
      const context = new ServerCallContext(
        Extensions.parseServiceParameter(req.header(HTTP_EXTENSION_HEADER)),
        user,
        requestedVersion
      );
      const agentCard = await options.requestHandler.getAgentCard();
      validateVersion(context.requestedVersion, agentCard, 'JSONRPC');
      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(req.body, context);

      if (context.activatedExtensions) {
        res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
      }
      // Check if it's an AsyncGenerator (stream)
      if (typeof (rpcResponseOrStream as AsyncGenerator)?.[Symbol.asyncIterator] === 'function') {
        const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCResponse, void, undefined>;

        // Set SSE headers using shared utility
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        res.flushHeaders();

        try {
          for await (const event of stream) {
            // Each event from the stream is already a JSONRPCResult
            // Use shared formatSSEEvent utility
            res.write(formatSSEEvent(event));
          }
        } catch (streamError) {
          console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: req.body?.id || null, // Use original request ID if available
            error: JsonRpcTransportHandler.mapToJSONRPCError(streamError),
          };
          if (!res.headersSent) {
            // Should not happen if flushHeaders worked
            res.status(500).json(errorResponse); // Should be JSON, not SSE here
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
        error: JsonRpcTransportHandler.mapToJSONRPCError(error),
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
