import { ServerCallContext } from './context.js';

/**
 * Resolves an owner identity string from a {@link ServerCallContext}.
 * Store implementations use this to scope data access so each caller can
 * only see its own resources. Implementations MAY base ownership on user
 * identity, organizational roles, project membership, etc.
 */
export type OwnerResolver = (context: ServerCallContext) => string;

/**
 * Default {@link OwnerResolver} keyed on the authenticated user's name.
 * Returns `'unknown'` for unauthenticated calls (which groups them into
 * a single shared scope).
 */
export function resolveUserScope(context: ServerCallContext): string {
  return context.user?.userName || 'unknown';
}
