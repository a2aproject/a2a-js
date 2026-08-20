import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Whether an address is not a public unicast destination for push webhooks.
 * Covers loopback, RFC 1918 / RFC 4193 private, link-local, unspecified,
 * multicast, RFC 6598 CGNAT, and RFC 2544 benchmarking ranges.
 */
export function isBlockedPushIp(ip: string): boolean {
  const normalized = ip.split('%', 1)[0] ?? ip;
  const version = isIP(normalized);
  if (version === 0) {
    return true;
  }

  if (version === 4) {
    return isBlockedIpv4(normalized);
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = ipv4MappedFromV6(normalized);
  if (mapped !== undefined) {
    return isBlockedIpv4(mapped);
  }

  return isBlockedIpv6(normalized);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  // 0.0.0.0/8 unspecified / "this" network
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 CGNAT (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15 benchmarking (RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 reserved
  if (a >= 240) return true;

  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  // Loopback
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  // Expand coarsely via URL parser for prefix checks
  try {
    const expanded = expandIpv6(lower);
    // fe80::/10 link-local
    if (expanded[0] === 0xfe80 || (expanded[0] & 0xffc0) === 0xfe80) return true;
    // fc00::/7 ULA
    if ((expanded[0] & 0xfe00) === 0xfc00) return true;
    // ff00::/8 multicast
    if ((expanded[0] & 0xff00) === 0xff00) return true;
  } catch {
    return true;
  }
  return false;
}

function ipv4MappedFromV6(ip: string): string | undefined {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice('::ffff:'.length);
    if (isIP(rest) === 4) {
      return rest;
    }
  }
  return undefined;
}

function expandIpv6(ip: string): number[] {
  // Minimal expander for prefix checks only.
  const sides = ip.split('::');
  let head = sides[0] ? sides[0].split(':') : [];
  let tail = sides.length > 1 && sides[1] ? sides[1].split(':') : [];
  if (sides.length > 2) {
    throw new Error('invalid ipv6');
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) {
    throw new Error('invalid ipv6');
  }
  const middles = Array(missing).fill('0');
  const parts = [...head, ...middles, ...tail].map((p) => parseInt(p || '0', 16));
  if (parts.length !== 8 || parts.some((n) => Number.isNaN(n))) {
    throw new Error('invalid ipv6');
  }
  return parts;
}

/**
 * Return an error string if a push-notification URL is not safe to POST to.
 * Rejects non-http(s) schemes and hosts that resolve to blocked addresses.
 * Unresolvable hosts fail closed.
 */
export async function pushUrlValidationError(url: string): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'unparseable URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `scheme '${parsed.protocol.replace(/:$/, '')}' is not http/https`;
  }

  const host = parsed.hostname;
  if (!host) {
    return 'no hostname';
  }

  // Literal IP in the URL: check directly (skip DNS).
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(literal) !== 0) {
    if (isBlockedPushIp(literal)) {
      return `host '${host}' is a non-public address`;
    }
    return undefined;
  }

  try {
    const results = await lookup(host, { all: true, verbatim: true });
    if (results.length === 0) {
      return `host '${host}' could not be resolved`;
    }
    for (const { address } of results) {
      if (isBlockedPushIp(address)) {
        return `host '${host}' resolves to a non-public address`;
      }
    }
  } catch {
    return `host '${host}' could not be resolved`;
  }

  return undefined;
}
