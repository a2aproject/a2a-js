// Re-exports the protocol-version helpers. Stable import path for the
// translators and tests.

export {
  PROTOCOL_VERSION_0_3,
  PROTOCOL_VERSION_1_0,
  isLegacyVersion,
} from '../../../version_utils.js';
