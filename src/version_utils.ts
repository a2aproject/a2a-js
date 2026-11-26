/**
 * Utility helpers for A2A protocol-version comparison. Lives in core so
 * both the v1.0 transports and the v0.3 compat translators can share a
 * single implementation without core having to import from the compat
 * layer.
 */

import { A2A_LEGACY_PROTOCOL_VERSION, A2A_PROTOCOL_VERSION, ProtocolVersion } from './constants.js';

/** The legacy A2A protocol version string targeted by the compat layer. */
export const PROTOCOL_VERSION_0_3 = A2A_LEGACY_PROTOCOL_VERSION;

/** The first non-legacy A2A protocol version; the upper bound of the legacy range. */
export const PROTOCOL_VERSION_1_0 = ProtocolVersion.V1_0;

interface NumericVersion {
  readonly major: number;
  readonly minor: number;
}

/**
 * Parses a `Major.Minor[.Patch...]` version string into its leading
 * `(major, minor)` pair. Returns `undefined` for unparseable inputs.
 */
function parseVersion(version: string | null | undefined): NumericVersion | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.\d+)*$/.exec(version?.trim() ?? '');
  // Version "1.2.3" will produce match = ["1.2.3", "1", "2"]
  if (!match) return undefined;
  // Minor is optional; default to 0 to match `packaging.Version("1") == 1.0`.
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
}

/** Normalizes a version to `Major.Minor`, dropping any patch; unparseable input is returned as is. */
export function majorMinor(version: string): string {
  const parsed = parseVersion(version);
  return parsed ? `${parsed.major}.${parsed.minor}` : version;
}

function compareVersions(left: NumericVersion, right: NumericVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  return left.minor - right.minor;
}

/**
 * Returns `true` when `version` is in the legacy range `[0.3, 1.0)`.
 * Empty, whitespace-only, or nullish inputs are treated as legacy ('0.3'),
 * matching the spec rule that clients without an explicit version are v0.3.
 * Unparseable, non-empty inputs return `false`.
 */
export function isLegacyVersion(version: string | null | undefined): boolean {
  if (!version || version.trim() === '') return true;
  const parsed = parseVersion(version);
  if (!parsed) return false;

  const lower = parseVersion(PROTOCOL_VERSION_0_3);
  const upper = parseVersion(PROTOCOL_VERSION_1_0);
  if (!lower || !upper) return false;

  return compareVersions(parsed, lower) >= 0 && compareVersions(parsed, upper) < 0;
}

/**
 * Returns `true` when an interface declaring `declared` can serve a request
 * for `requested`. An interface declares the latest minor it supports per major
 * (spec §3.6), so any lower minor of the same major is accepted. Pre-1.0
 * minors may break compatibility and must match exactly. Patch is ignored.
 */
export function supportsVersion(declared: string, requested: string): boolean {
  const declaredVersion = parseVersion(declared);
  const requestedVersion = parseVersion(requested);
  if (!declaredVersion || !requestedVersion) return false;
  if (declaredVersion.major !== requestedVersion.major) return false;
  // Pre-1.0 minors may break compatibility, so 0.x must match exactly.
  if (declaredVersion.major === 0) return declaredVersion.minor === requestedVersion.minor;
  return requestedVersion.minor <= declaredVersion.minor;
}

/**
 * Returns the `Major.Minor` version a v1+ client supporting up to `client`
 * should request from an interface declaring `declared`: the lower of the two
 * within the same major, or `undefined` when they cannot interoperate (pre-1.0
 * interfaces are served by the compat transports, not negotiated here).
 */
export function negotiateVersion(
  declared: string,
  client: string = A2A_PROTOCOL_VERSION
): string | undefined {
  const declaredVersion = parseVersion(declared);
  const clientVersion = parseVersion(client);
  if (!declaredVersion || !clientVersion) return undefined;
  if (declaredVersion.major !== clientVersion.major || declaredVersion.major === 0) {
    return undefined;
  }
  return `${declaredVersion.major}.${Math.min(declaredVersion.minor, clientVersion.minor)}`;
}
