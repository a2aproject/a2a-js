import net from 'net';

export interface UrlValidationOptions {
  /**
   * Whether to allow loopback addresses (localhost, 127.0.0.0/8, ::1).
   * Defaults to false.
   */
  allowLoopback?: boolean;

  /**
   * Whether to allow private IP networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, site-local IPv6).
   * Defaults to false.
   */
  allowPrivateNetworks?: boolean;

  /**
   * List of allowed hostnames or patterns (allowlist).
   * If specified and host matches any entry, validation succeeds regardless of IP restrictions.
   */
  allowedHosts?: (string | RegExp)[];

  /**
   * Allowed protocols/schemes (with trailing colon).
   * Defaults to ['http:', 'https:'].
   */
  allowedProtocols?: string[];
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

/**
 * Validates a webhook URL to prevent SSRF (Server-Side Request Forgery) per A2A Spec §13.2.
 */
export function validateWebhookUrl(urlString: string, options: UrlValidationOptions = {}): void {
  const {
    allowLoopback = false,
    allowPrivateNetworks = false,
    allowedHosts = [],
    allowedProtocols = ['http:', 'https:'],
  } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new UrlValidationError(`Invalid URL format: ${urlString}`);
  }

  // Validate protocol
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new UrlValidationError(
      `Invalid URL scheme '${parsedUrl.protocol}'. Allowed schemes: ${allowedProtocols.join(', ')}`
    );
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Strip enclosing square brackets for IPv6
  const cleanHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // Check explicit allowlist
  if (allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some((pattern) => {
      if (typeof pattern === 'string') {
        return pattern.toLowerCase() === hostname || pattern.toLowerCase() === cleanHost;
      }
      return pattern.test(hostname) || pattern.test(cleanHost);
    });
    if (isAllowed) {
      return;
    }
  }

  // Check localhost / domain loopback
  if (!allowLoopback) {
    if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
      throw new UrlValidationError(
        `Webhook URL hostname '${hostname}' resolves to loopback/localhost`
      );
    }
  }

  const ipType = net.isIP(cleanHost);

  if (ipType === 4) {
    validateIPv4(cleanHost, allowLoopback, allowPrivateNetworks);
  } else if (ipType === 6) {
    validateIPv6(cleanHost, allowLoopback, allowPrivateNetworks);
  }
}

function validateIPv4(ip: string, allowLoopback: boolean, allowPrivateNetworks: boolean): void {
  const parts = ip.split('.').map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new UrlValidationError(`Invalid IPv4 address format: ${ip}`);
  }

  const [p0, p1] = parts;

  // 0.0.0.0/8 (unspecified)
  if (p0 === 0) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is an unspecified address (0.0.0.0/8)`);
  }

  // 127.0.0.0/8 (loopback)
  if (p0 === 127 && !allowLoopback) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is in loopback range (127.0.0.0/8)`);
  }

  // 169.254.0.0/16 (link-local / cloud metadata)
  if (p0 === 169 && p1 === 254) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is in link-local range (169.254.0.0/16)`);
  }

  if (!allowPrivateNetworks) {
    // 10.0.0.0/8
    if (p0 === 10) {
      throw new UrlValidationError(`Webhook URL IP '${ip}' is in private range (10.0.0.0/8)`);
    }
    // 172.16.0.0/12
    if (p0 === 172 && p1 >= 16 && p1 <= 31) {
      throw new UrlValidationError(`Webhook URL IP '${ip}' is in private range (172.16.0.0/12)`);
    }
    // 192.168.0.0/16
    if (p0 === 192 && p1 === 168) {
      throw new UrlValidationError(`Webhook URL IP '${ip}' is in private range (192.168.0.0/16)`);
    }
  }
}

function validateIPv6(ip: string, allowLoopback: boolean, allowPrivateNetworks: boolean): void {
  const lowerIp = ip.toLowerCase();

  // IPv6 loopback: ::1 or 0:0:0:0:0:0:0:1
  if ((lowerIp === '::1' || lowerIp === '0:0:0:0:0:0:0:1') && !allowLoopback) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is loopback address (::1)`);
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:10.0.0.1)
  if (lowerIp.startsWith('::ffff:')) {
    const ipv4Part = lowerIp.substring(7);
    if (net.isIPv4(ipv4Part)) {
      validateIPv4(ipv4Part, allowLoopback, allowPrivateNetworks);
      return;
    }
  }

  // IPv6 link-local: fe80::/10 (fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(lowerIp)) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is in link-local range (fe80::/10)`);
  }

  // IPv6 ULA / Unique Local / Site-Local: fc00::/7 (fc, fd)
  if (/^f[cd]/i.test(lowerIp) && !allowPrivateNetworks) {
    throw new UrlValidationError(`Webhook URL IP '${ip}' is in private range (fc00::/7)`);
  }
}
