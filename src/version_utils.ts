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
 * Returns `true` when `version` is in the legacy range `[0.3, 1.0)`.
 * Empty, whitespace-only, or nullish inputs are treated as legacy ('0.3'),
 * matching the spec rule that clients without an explicit version are v0.3.
 * Unparseable, non-empty inputs return `false`.
 */
export function isLegacyVersion(version: string | null | undefined): boolean {
  if (!version || version.trim() === '') return true;
  const v = parseVersion(version);
  if (!v) return false;

  const lower = parseVersion(PROTOCOL_VERSION_0_3);
  const upper = parseVersion(PROTOCOL_VERSION_1_0);
  if (!lower || !upper) return false;

  return compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
}

/**
 * Returns `true` when an interface declaring `declared` can serve a request
 * for `requested`. An interface declares the latest minor it supports per major
 * (spec §3.6), so any lower minor of the same major is accepted. Pre-1.0
 * minors may break compatibility and must match exactly. Patch is ignored.
 */
export function supportsVersion(declared: string, requested: string): boolean {
  const d = parseVersion(declared);
  const r = parseVersion(requested);
  if (!d || !r || d.major !== r.major) return false;
  return d.major === 0 ? d.minor === r.minor : r.minor <= d.minor;
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
  const d = parseVersion(declared);
  const c = parseVersion(client);
  if (!d || !c || d.major !== c.major || d.major === 0) return undefined;
  return `${d.major}.${Math.min(d.minor, c.minor)}`;
}
