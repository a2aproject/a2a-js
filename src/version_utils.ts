/**
 * Utility helpers for A2A protocol-version comparison. Lives in core so
 * both the v1.0 transports and the v0.3 compat translators can share a
 * single implementation without core having to import from the compat
 * layer.
 */

import { A2A_LEGACY_PROTOCOL_VERSION, A2A_PROTOCOL_VERSION } from './constants.js';

/** The legacy A2A protocol version string targeted by the compat layer. */
export const PROTOCOL_VERSION_0_3 = A2A_LEGACY_PROTOCOL_VERSION;

/** The current A2A protocol version string. */
export const PROTOCOL_VERSION_1_0 = A2A_PROTOCOL_VERSION;

interface NumericVersion {
  readonly major: number;
  readonly minor: number;
}

/**
 * Parses a `Major.Minor[.Patch...]` version string into its leading
 * `(major, minor)` pair. Returns `undefined` for unparseable inputs.
 */
function parseVersion(version: string): NumericVersion | undefined {
  const trimmed = version.trim();
  if (trimmed === '') return undefined;

  const segments = trimmed.split('.');
  if (segments.length === 0) return undefined;

  const major = Number.parseInt(segments[0]!, 10);
  if (!Number.isFinite(major) || major < 0) return undefined;

  // Minor is optional; default to 0 to match `packaging.Version("1") == 1.0`.
  const minorRaw = segments[1];
  const minor = minorRaw === undefined ? 0 : Number.parseInt(minorRaw, 10);
  if (!Number.isFinite(minor) || minor < 0) return undefined;

  return { major, minor };
}

function compareVersions(a: NumericVersion, b: NumericVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

/**
 * Returns `true` when `version` is a non-empty, parseable string that falls
 * inside the legacy range `[0.3, 1.0)`.
 *
 * Empty / nullish / unparseable inputs return `false`.
 */
export function isLegacyVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const v = parseVersion(version);
  if (!v) return false;

  const lower = parseVersion(PROTOCOL_VERSION_0_3);
  const upper = parseVersion(PROTOCOL_VERSION_1_0);
  if (!lower || !upper) return false;

  return compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
}
