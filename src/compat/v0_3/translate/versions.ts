/**
 * Re-exports the protocol-version helpers from the shared
 * `src/version_utils.js` module. Kept as a stable import path for the v0.3
 * compat layer's translators and tests.
 */

export {
  PROTOCOL_VERSION_0_3,
  PROTOCOL_VERSION_1_0,
  isLegacyVersion,
} from '../../../version_utils.js';
