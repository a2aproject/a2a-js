/**
 * Exports the common types.
 *
 * Use the client/index.ts file to import the client-only codebase.
 * Use the server/index.ts file to import the server-only codebase.
 */

export * from './types.js';
export type { A2AResponse } from './a2a_response.js';
export { AGENT_CARD_PATH, AGENT_CARD_WELL_KNOWN_PATH } from './constants.js';
