import { NextFunction, ErrorRequestHandler, Request, Response } from "express";
import { JSONRPCErrorResponse } from "../../types.js";
import { A2AError } from "../error.js";

export const jsonErrorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
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
}
