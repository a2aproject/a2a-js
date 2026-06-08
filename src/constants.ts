/**
 * Shared constants for the A2A library
 */

/**
 * The well-known path for the agent card
 */
export const AGENT_CARD_PATH = '.well-known/agent-card.json';

/**
 * The name of the extension header used in http
 */
export const HTTP_EXTENSION_HEADER = 'A2A-Extensions';

/**
 * The A2A-Version service parameter / header name.
 * Clients MUST send this header with each request (§3.6.1).
 * Servers MUST validate the version and return VersionNotSupportedError
 * if the requested version is not supported (§3.6.2).
 */
export const A2A_VERSION_HEADER = 'A2A-Version';

/**
 * The A2A protocol version implemented by this SDK (Major.Minor).
 * Patch version numbers SHOULD NOT be used per §3.6.
 */
export const A2A_PROTOCOL_VERSION = '1.0';

/**
 * The legacy A2A protocol version recognized by the v0.3 compat layer.
 *
 * Mirrors the `protocolVersion` field on legacy v0.3 AgentCards. Defined in
 * core (rather than in `src/compat/v0_3/constants.ts`) so core modules such
 * as `src/version_utils.ts` can reference it without statically importing
 * from the compat layer. The compat layer re-exports this constant for
 * backward compatibility.
 */
export const A2A_LEGACY_PROTOCOL_VERSION = '0.3';

/**
 * Known A2A protocol wire versions.
 *
 * The string values match the canonical `Major.Minor` form transmitted in
 * the `A2A-Version` HTTP header (§3.6.1) and stored on
 * `ServerCallContext.requestedVersion`. Used as typed keys in version-keyed
 * registries such as `DefaultPushNotificationSenderOptions.serializers`.
 *
 * Enum values are hard-coded string literals (TypeScript requires enum
 * initializers to be constants); the matching exported string constants
 * {@link A2A_PROTOCOL_VERSION} and {@link A2A_LEGACY_PROTOCOL_VERSION}
 * remain the canonical sources of truth. The enum is interchangeable with
 * those constants and with free-form `string` versions arriving over the
 * wire.
 */
export enum ProtocolVersion {
  V0_3 = '0.3',
  V1_0 = '1.0',
}

/**
 * The JSON content type per §9.1.
 * JSON-RPC requests MUST use this content type.
 */
export const JSON_CONTENT_TYPE = 'application/json';

/**
 * The A2A JSON content type per §11.1.
 * REST responses SHOULD use this content type.
 * Push notification payloads MUST use this content type (§14.1).
 */
export const A2A_CONTENT_TYPE = 'application/a2a+json';

/**
 * The default page size for listing tasks
 */
export const DEFAULT_PAGE_SIZE = 50;
