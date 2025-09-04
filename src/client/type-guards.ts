import { Task, Message1, Message2 } from '../types.js';

/**
 * Conditional type utilities for extracting specific result types.
 * Uses advanced TypeScript features for precise type extraction.
 */
export type ExtractByKind<TUnion, TKind extends string> = 
  TUnion extends { kind: TKind } ? TUnion : never;

export type ExtractTask<T> = ExtractByKind<T, 'task'>;
export type ExtractMessage<T> = ExtractByKind<T, 'message'> | ExtractByKind<T, 'user-message'>;

/**
 * Template literal types for A2A result pattern matching.
 * Provides compile-time pattern validation for result IDs.
 */
export type A2AResultPattern<T extends string> = 
  T extends `task-${infer _Rest}` ? 'task'
  : T extends `msg-${infer _Rest}` ? 'message'
  : T extends `user-msg-${infer _Rest}` ? 'user-message'
  : 'unknown';

/**
 * Type guards with conditional type inference.
 * Provides precise type narrowing for union types.
 */
export function isTask<T>(result: T): result is Extract<T, { kind: 'task' }> {
  return (
    typeof result === 'object' &&
    result !== null &&
    'kind' in result &&
    result.kind === 'task'
  );
}

export function isMessage<T>(result: T): result is Extract<T, { kind: 'message' | 'user-message' }> {
  return (
    typeof result === 'object' &&
    result !== null &&
    'kind' in result &&
    (result.kind === 'message' || result.kind === 'user-message')
  );
}

/**
 * Type-safe result processor using conditional types.
 * Automatically infers correct handler types based on result kind.
 */
export function withResultType<T extends Task | Message1 | Message2, R>(
  result: T,
  handlers: {
    task?: T extends { kind: 'task' } ? (task: Extract<T, { kind: 'task' }>) => R : never;
    message?: T extends { kind: 'message' | 'user-message' } ? (message: Extract<T, { kind: 'message' | 'user-message' }>) => R : never;  
    fallback?: () => R;
  }
): R {
  if (isTask(result) && handlers.task) {
    return (handlers.task as (task: typeof result) => R)(result);
  }

  if (isMessage(result) && handlers.message) {
    return (handlers.message as (message: typeof result) => R)(result);
  }

  if (handlers.fallback) {
    return handlers.fallback();
  }

  throw new Error(`No handler provided for result kind: ${(result as any)?.kind}`);
}