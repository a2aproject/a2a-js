import { ServerCallContext } from './context.js';

/**
 * A function that resolves an owner identity string from a {@link ServerCallContext}.
 *
 * The owner string is used by store implementations to scope data access,
 * ensuring that each authenticated caller can only access their own resources.
 * Per spec §13.1, servers MUST implement appropriate authorization scoping.
 *
 * Implementations MAY base ownership on user identity, organizational roles,
 * project membership, or any custom authorization model.
 *
 * @param context - The server call context containing caller identity information.
 * @returns A string identifying the owner scope for the current caller.
 */
export type OwnerResolver = (context: ServerCallContext) => string;

/**
 * Default {@link OwnerResolver} implementation that resolves ownership
 * from the authenticated user's name.
 *
 * Returns `'unknown'` when the context has no user or the user has no name,
 * which groups all unauthenticated calls into the same scope.
 *
 * @param context - The server call context.
 * @returns The user's name, or `'unknown'` if unavailable.
 */
export function resolveUserScope(context: ServerCallContext): string {
  return context.user?.userName || 'unknown';
}
