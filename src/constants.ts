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
export const HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

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
 * The default A2A version assumed when the A2A-Version header is empty or absent.
 * Per §3.6.2: "Agents MUST interpret empty value as 0.3 version."
 */
export const A2A_DEFAULT_VERSION = '0.3';

/**
 * The default page size for listing tasks
 */
export const DEFAULT_PAGE_SIZE = 50;
