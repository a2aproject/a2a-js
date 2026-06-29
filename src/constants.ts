/** Shared constants for the A2A library. */

/** The well-known path for the agent card. */
export const AGENT_CARD_PATH = '.well-known/agent-card.json';

/** The name of the A2A extensions header used over HTTP. */
export const HTTP_EXTENSION_HEADER = 'A2A-Extensions';

/** The A2A-Version service parameter / header name. */
export const A2A_VERSION_HEADER = 'A2A-Version';

/** The A2A protocol version implemented by this SDK (Major.Minor). */
export const A2A_PROTOCOL_VERSION = '1.0';

/**
 * The legacy A2A protocol version recognized by the v0.3 compat layer.
 * Defined here (rather than under `src/compat/v0_3/`) so core modules can
 * reference it without depending on the compat layer.
 */
export const A2A_LEGACY_PROTOCOL_VERSION = '0.3';

/**
 * Known A2A protocol wire versions, matching the `Major.Minor` form
 * transmitted in the `A2A-Version` HTTP header. The matching exported
 * string constants {@link A2A_PROTOCOL_VERSION} and
 * {@link A2A_LEGACY_PROTOCOL_VERSION} remain the canonical source of
 * truth; this enum is interchangeable with them and with free-form
 * `string` versions arriving over the wire.
 */
export enum ProtocolVersion {
  V0_3 = '0.3',
  V1_0 = '1.0',
}

/** Content-Type for JSON-RPC requests. */
export const JSON_CONTENT_TYPE = 'application/json';

/** Content-Type for HTTP+JSON/REST responses and push notification payloads. */
export const A2A_CONTENT_TYPE = 'application/a2a+json';

/** Default page size for listing tasks. */
export const DEFAULT_PAGE_SIZE = 50;
