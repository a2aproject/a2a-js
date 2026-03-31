/**
 * Exports the common types.
 *
 * Use the client/index.ts file to import the client-only codebase.
 * Use the server/index.ts file to import the server-only codebase.
 */

import { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from './types/pb/a2a.js';

export * from './types/pb/a2a.js';
export { AGENT_CARD_PATH, HTTP_EXTENSION_HEADER } from './constants.js';
export { Extensions, type ExtensionURI } from './extensions.js';

export type A2AStreamEventData = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
export type SendMessageResult = Message | Task;
