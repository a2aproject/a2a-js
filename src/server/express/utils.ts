/**
 * REST API field transformation utilities.
 *
 * Transforms object keys between snake_case (REST) and camelCase (internal).
 * Values are never modified - only keys are transformed.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Converts a snake_case string to camelCase.
 * Example: "message_id" → "messageId"
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Converts a camelCase string to snake_case.
 * Example: "messageId" → "message_id"
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Generic helper to transform object keys recursively.
 */
function transformKeys(
  data: unknown,
  keyTransform: (key: string) => string,
  recurse: (value: unknown) => unknown
): unknown {
  if (data == null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(recurse);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[keyTransform(key)] = recurse(value);
  }
  return result;
}

/**
 * Recursively transforms snake_case keys to camelCase.
 * Example: { message_id: "abc" } → { messageId: "abc" }
 */
export function restToInternal(data: unknown): unknown {
  return transformKeys(data, toCamelCase, restToInternal);
}

/**
 * Recursively transforms camelCase keys to snake_case.
 * Example: { messageId: "abc" } → { message_id: "abc" }
 */
export function internalToRest(data: unknown): unknown {
  return transformKeys(data, toSnakeCase, internalToRest);
}

/**
 * Express middleware that automatically transforms REST API requests and responses.
 *
 * - Incoming requests: snake_case → camelCase
 * - Outgoing responses: camelCase → snake_case
 *
 * This allows handlers to work with clean TypeScript camelCase types internally,
 * while maintaining REST API snake_case conventions externally.
 */
export function restTransformMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Transform incoming request body: snake_case → camelCase
    if (req.body && Object.keys(req.body).length > 0) {
      req.body = restToInternal(req.body);
    }

    // Intercept response to transform outgoing data: camelCase → snake_case
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      return originalJson(internalToRest(body));
    };

    next();
  };
}
