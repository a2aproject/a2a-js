/**
 * Express integration for the A2A Server library.
 * This module provides Express.js specific functionality.
 */

// Legacy A2AExpressApp class (for backward compatibility)
export { A2AExpressApp } from './a2a_express_app.js';
export type { UserBuilder } from './common.js';

export { jsonRpcHandler, jsonErrorHandler } from './json_rpc_handler.js';
export type { JsonRpcHandlerOptions } from './json_rpc_handler.js';

export { agentCardHandler } from './agent_card_handler.js';
export type { AgentCardHandlerOptions, AgentCardProvider } from './agent_card_handler.js';

export { httpRestHandler, restErrorHandler } from './http_rest_handler.js';
export type { HttpRestHandlerOptions } from './http_rest_handler.js';

// Deprecated exports (for backward compatibility)
export { createHttpRestRouter } from './http_rest_handler.js';
