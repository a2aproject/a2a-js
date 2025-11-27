import express, {
  Request,
  Response,
  ErrorRequestHandler,
  NextFunction,
  RequestHandler,
} from 'express';
import { JSONRPCErrorResponse, JSONRPCSuccessResponse, JSONRPCResponse } from '../../types.js';
import { A2AError } from '../error.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { getRequestedExtensions } from '../utils.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UnauthenticatedUser } from '../authentication/user.js';
import { UserBuilder } from './common.js';

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Creates Express.js middleware to handle A2A JSON-RPC requests.
 * @example
 * // Handle at root
 * app.use(jsonRpcHandler({ requestHandler: a2aRequestHandler }));
 * // or
 * app.use('/a2a/json-rpc', jsonRpcHandler({ requestHandler: a2aRequestHandler }));
 */
export function jsonRpcHandler(options: JsonRpcHandlerOptions): RequestHandler {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);

  const router = express.Router();

  router.use(express.json(), jsonErrorHandler);

  router.post('/', async (req: Request, res: Response) => {
    try {
      const user = await options.userBuilder(req);
      const context = new ServerCallContext(
        getRequestedExtensions(req.header(HTTP_EXTENSION_HEADER)),
        user ?? new UnauthenticatedUser()
      );
      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(req.body, context);

      if (context.activatedExtensions) {
        res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
      }
      // Check if it's an AsyncGenerator (stream)
      if (typeof (rpcResponseOrStream as AsyncGenerator)?.[Symbol.asyncIterator] === 'function') {
        const stream = rpcResponseOrStream as AsyncGenerator<
          JSONRPCSuccessResponse,
          void,
          undefined
        >;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        res.flushHeaders();

        try {
          for await (const event of stream) {
            // Each event from the stream is already a JSONRPCResult
            res.write(`id: ${new Date().getTime()}\n`);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch (streamError) {
          console.error(`Error during SSE streaming (request ${req.body?.id}):`, streamError);
          // If the stream itself throws an error, send a final JSONRPCErrorResponse
          let a2aError: A2AError;
          if (streamError instanceof A2AError) {
            a2aError = streamError;
          } else {
            a2aError = A2AError.internalError(
              (streamError instanceof Error && streamError.message) || 'Streaming error.'
            );
          }
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: req.body?.id || null, // Use original request ID if available
            error: a2aError.toJSONRPCError(),
          };
          if (!res.headersSent) {
            // Should not happen if flushHeaders worked
            res.status(500).json(errorResponse); // Should be JSON, not SSE here
          } else {
            // Try to send as last SSE event if possible, though client might have disconnected
            res.write(`id: ${new Date().getTime()}\n`);
            res.write(`event: error\n`); // Custom event type for client-side handling
            res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
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
      const a2aError =
        error instanceof A2AError ? error : A2AError.internalError('General processing error.');
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: a2aError.toJSONRPCError(),
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
    const a2aError = A2AError.parseError('Invalid JSON payload.');
    const errorResponse: JSONRPCErrorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: a2aError.toJSONRPCError(),
    };
    return res.status(400).json(errorResponse);
  }
  next(err);
};
