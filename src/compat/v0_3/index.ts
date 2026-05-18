/**
 * Compat-layer constants, method-name mappings, and payload translators
 * for the legacy A2A v0.3 protocol.
 */

export * from './constants.js';
export * from './translate/index.js';
export { A2AError as LegacyA2AError } from './server/error.js';
