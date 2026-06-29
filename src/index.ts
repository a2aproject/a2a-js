/**
 * Exports the common types.
 *
 * Use `./client` for the client-only codebase and `./server` for the
 * server-only codebase.
 */

import { Message, Task } from './types/pb/a2a.js';

export * from './types/pb/a2a.js';
export {
  AGENT_CARD_PATH,
  HTTP_EXTENSION_HEADER,
  A2A_VERSION_HEADER,
  A2A_PROTOCOL_VERSION,
  A2A_CONTENT_TYPE,
} from './constants.js';
export { Extensions, type ExtensionURI } from './extensions.js';
export {
  generateAgentCardSignature,
  verifyAgentCardSignature,
  canonicalizeAgentCard,
  type AgentCardSignatureGenerator,
  type AgentCardSignatureVerifier,
} from './signature.js';

export type SendMessageResult = Message | Task;
