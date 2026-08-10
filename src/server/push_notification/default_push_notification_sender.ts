import { TaskPushNotificationConfig, StreamResponse } from '../../index.js';
import {
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
  ProtocolVersion,
} from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { PushNotificationSender } from './push_notification_sender.js';
import { PushNotificationStore, StoredPushNotificationConfig } from './push_notification_store.js';
import {
  PushNotificationSerializer,
  V1PushNotificationSerializer,
} from './push_notification_serializer.js';

export interface DefaultPushNotificationSenderOptions {
  /** Timeout in milliseconds for the abort controller. Defaults to 5000ms. */
  timeout?: number;
  /**
   * When `true`, disables the built-in SSRF guard that rejects push
   * notification URLs pointing at loopback, private, link-local or
   * unspecified addresses (and well-known cloud metadata endpoints).
   * Defaults to `false` (guard enabled), per the A2A spec requirement
   * that agents validate webhook URLs against SSRF. Enable only for
   * trusted internal deployments, e.g. a webhook hosted on the same host
   * or private network.
   */
  allowPrivateNetworks?: boolean;
  /**
   * Custom header name for the legacy token (defaults to
   * `X-A2A-Notification-Token`). Used only when `pushConfig.token` is set
   * and `pushConfig.authentication` is not.
   * @deprecated Use `pushConfig.authentication` with `AuthenticationInfo`.
   */
  tokenHeaderName?: string;
  /**
   * Per-wire-version push-notification serializers. The sender always
   * registers a built-in `'1.0'` serializer
   * ({@link V1PushNotificationSerializer}) at construction time; entries
   * supplied here override that default and add support for additional
   * versions (e.g. legacy v0.3 via the compat layer's
   * `V03PushNotificationSerializer`).
   *
   * When a stored config carries a wire version with no registered
   * serializer, the sender logs a warning and falls back to `'1.0'`.
   *
   * The typed key set is a developer affordance; the underlying registry
   * accepts any string at runtime.
   */
  serializers?: Partial<Record<ProtocolVersion, PushNotificationSerializer>>;
}

/** Maximum redirect hops a push notification may follow (SSRF guard). */
const MAX_PUSH_REDIRECTS = 10;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export class DefaultPushNotificationSender implements PushNotificationSender {
  private readonly pushNotificationStore: PushNotificationStore;
  private notificationChain: Map<string, Promise<unknown>>;
  private readonly options: Required<Omit<DefaultPushNotificationSenderOptions, 'serializers'>>;
  private readonly serializers: Map<string, PushNotificationSerializer>;
  private readonly fallbackSerializer: PushNotificationSerializer;
  // Avoid log spam when many notifications target the same unknown version.
  private readonly warnedMissingSerializers: Set<string> = new Set();

  constructor(
    pushNotificationStore: PushNotificationStore,
    options: DefaultPushNotificationSenderOptions = {}
  ) {
    this.pushNotificationStore = pushNotificationStore;
    this.notificationChain = new Map();
    this.options = {
      timeout: options.timeout ?? 5000,
      allowPrivateNetworks: options.allowPrivateNetworks ?? false,
      tokenHeaderName: options.tokenHeaderName ?? 'X-A2A-Notification-Token',
    };

    // Seed with the built-in v1.0 serializer, then overlay user-supplied
    // entries. User entries with key '1.0' override the default
    // (intentional — callers may want a custom v1.0 encoding).
    const builtinV1 = new V1PushNotificationSerializer();
    this.serializers = new Map<string, PushNotificationSerializer>([
      [ProtocolVersion.V1_0, builtinV1],
    ]);
    if (options.serializers) {
      for (const [version, serializer] of Object.entries(options.serializers)) {
        if (serializer) {
          this.serializers.set(version, serializer);
        }
      }
    }
    // Resolve from the registry (not `builtinV1`) so a user who overrode
    // '1.0' has their custom serializer used for fallback too.
    this.fallbackSerializer = this.serializers.get(ProtocolVersion.V1_0) ?? builtinV1;
  }

  async send(streamResponse: StreamResponse, context: ServerCallContext): Promise<void> {
    const taskId = this._getTaskId(streamResponse);
    // Stand-alone messages with no task association can't have a
    // registered push config — skip the store round-trip.
    if (!taskId) {
      return;
    }

    const storedConfigs = await this._loadStoredConfigs(taskId, context);
    if (!storedConfigs || storedConfigs.length === 0) {
      return;
    }

    const lastPromise = this.notificationChain.get(taskId) ?? Promise.resolve();
    // Chain promises so notifications for the same task are sent
    // sequentially; once resolved the GC can clean them up so memory
    // doesn't grow linearly with the number of notifications sent.
    const newPromise = lastPromise
      .catch(() => {})
      .then(async () => {
        const dispatches = storedConfigs.map(async (storedConfig) => {
          try {
            await this._dispatchNotification(streamResponse, storedConfig, taskId);
          } catch (error) {
            console.error(
              `Error sending push notification for task_id=${taskId} to URL: ${storedConfig.config.url}. Error:`,
              error
            );
          }
        });
        await Promise.all(dispatches);
      });
    this.notificationChain.set(taskId, newPromise);

    return newPromise.finally(() => {
      if (this.notificationChain.get(taskId) === newPromise) {
        this.notificationChain.delete(taskId);
      }
    });
  }

  /**
   * Returns the task id associated with a {@link StreamResponse}.
   * Returns an empty string for stand-alone messages with no task
   * association; the sender skips dispatch in that case.
   */
  private _getTaskId(streamResponse: StreamResponse): string {
    const payload = streamResponse.payload;
    if (!payload) {
      throw new Error('StreamResponse payload is undefined');
    }
    switch (payload.$case) {
      case 'task':
        return payload.value.id;
      case 'statusUpdate':
      case 'artifactUpdate':
      case 'message':
        return payload.value.taskId;
      default: {
        const _exhaustive: never = payload;
        throw new Error(`Unknown payload case: ${(_exhaustive as { $case: string }).$case}`);
      }
    }
  }

  /**
   * Resolves stored configs from the {@link PushNotificationStore},
   * preferring the wire-version-aware
   * {@link PushNotificationStore.loadWithMetadata} when available.
   *
   * Stores that only implement the canonical {@link PushNotificationStore.load}
   * are silently lifted into the wrapped shape by tagging every entry
   * with the wire version of the *triggering* request. See
   * `src/compat/v0_3/README.md` for the implication on v1.0 deployments
   * with v0.3 compat opted in.
   */
  private async _loadStoredConfigs(
    taskId: string,
    context: ServerCallContext
  ): Promise<StoredPushNotificationConfig[]> {
    if (this.pushNotificationStore.loadWithMetadata) {
      return await this.pushNotificationStore.loadWithMetadata(taskId, context);
    }
    const plain = await this.pushNotificationStore.load(taskId, context);
    const fallbackVersion = context.requestedVersion || A2A_LEGACY_PROTOCOL_VERSION;
    return plain.map((config) => ({ config, wireVersion: fallbackVersion }));
  }

  /**
   * Resolves the serializer registered for the given wire version,
   * falling back to v1.0 (with a one-time warning) when no entry is
   * registered.
   */
  private _resolveSerializer(wireVersion: string): PushNotificationSerializer {
    const serializer = this.serializers.get(wireVersion);
    if (serializer) {
      return serializer;
    }
    if (!this.warnedMissingSerializers.has(wireVersion)) {
      this.warnedMissingSerializers.add(wireVersion);
      console.warn(
        `No push notification serializer registered for wire version '${wireVersion}'; ` +
          `falling back to '${A2A_PROTOCOL_VERSION}'. Register one via ` +
          `DefaultPushNotificationSenderOptions.serializers to silence this warning.`
      );
    }
    return this.fallbackSerializer;
  }

  /**
   * Builds the auth headers for a push notification request. Priority:
   * `pushConfig.authentication` (scheme + credentials) → `Authorization`
   * header; otherwise `pushConfig.token` → legacy token header.
   *
   * A configured `scheme` with missing/blank credentials is an error
   * (BUG-40) — silently dropping the Authorization header would let the
   * webhook reject the push with an auth error that is hard to diagnose.
   * Credentials containing CR/LF are rejected (BUG-34) so a client cannot
   * inject extra HTTP headers via the concatenated header value.
   */
  private _buildAuthHeaders(pushConfig: TaskPushNotificationConfig): Record<string, string> {
    const headers: Record<string, string> = {};

    if (pushConfig.authentication?.scheme) {
      const credentials = pushConfig.authentication.credentials;
      if (!credentials || credentials.trim() === '') {
        throw new Error(
          `Push notification authentication scheme '${pushConfig.authentication.scheme}' ` +
            `requires non-empty credentials.`
        );
      }
      if (/[\r\n]/.test(credentials)) {
        throw new Error(
          'Push notification authentication credentials must not contain CR/LF characters.'
        );
      }
      headers['Authorization'] = `${pushConfig.authentication.scheme} ${credentials}`;
    } else if (pushConfig.token) {
      headers[this.options.tokenHeaderName] = pushConfig.token;
    }

    return headers;
  }

  private async _dispatchNotification(
    streamResponse: StreamResponse,
    storedConfig: StoredPushNotificationConfig,
    taskId: string
  ): Promise<void> {
    const { config: pushConfig, wireVersion } = storedConfig;
    const url = pushConfig.url;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const serializer = this._resolveSerializer(wireVersion);
      const { body, contentType } = serializer.serialize(streamResponse);

      const response = await this._postWithRedirectGuard(
        url,
        {
          'Content-Type': contentType,
          ...this._buildAuthHeaders(pushConfig),
        },
        body,
        controller.signal
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.info(`Push notification sent for task_id=${taskId} to URL: ${url}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * POSTs the notification body, following redirects manually so every
   * hop is re-validated against the SSRF guard (an automatic redirect
   * could otherwise bypass the check on the initial URL) and the
   * notification token / Authorization header is dropped when a hop
   * crosses to a different host. Non-redirect hops return the response
   * as-is.
   */
  private async _postWithRedirectGuard(
    url: string,
    headers: Record<string, string>,
    body: string,
    signal: AbortSignal
  ): Promise<Response> {
    let currentUrl = url;
    const currentHeaders = { ...headers };

    for (let hop = 0; ; hop++) {
      if (!this.options.allowPrivateNetworks) {
        this._validatePushUrl(currentUrl);
      }
      const response = await fetch(currentUrl, {
        method: 'POST',
        headers: currentHeaders,
        body,
        signal,
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      if (!isRedirectStatus(response.status) || !location) {
        return response;
      }
      // Release the redirect response so the connection can be reused.
      await response.body?.cancel();

      if (hop >= MAX_PUSH_REDIRECTS) {
        throw new Error(
          `Push notification URL followed more than ${MAX_PUSH_REDIRECTS} redirects: ${url}`
        );
      }

      const nextUrl = new URL(location, currentUrl).toString();
      if (new URL(nextUrl).host !== new URL(currentUrl).host) {
        // Drop auth headers on cross-host redirects so credentials do not
        // leak to a different host.
        delete currentHeaders['Authorization'];
        delete currentHeaders[this.options.tokenHeaderName];
      }
      currentUrl = nextUrl;
    }
  }

  /**
   * Rejects push notification URLs that would reach non-public targets
   * (SSRF guard, CWE-918): non-http(s) schemes, hostnames without a
   * host, loopback / private / link-local / unspecified / multicast
   * literal addresses, and well-known cloud metadata hostnames. Mirrors
   * the Go SDK's `isBlockedIP` guard. The check is static: DNS
   * resolution happens later inside `fetch` at connection time.
   */
  private _validatePushUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid push notification URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Push notification URL must use http or https, got: ${parsed.protocol}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) {
      throw new Error(`Invalid push notification URL: ${url}`);
    }
    if (this._isBlockedHost(hostname)) {
      throw new Error(
        `Push notification URL must not point to a private/internal address: ${hostname}`
      );
    }
  }

  private _isBlockedHost(hostname: string): boolean {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return true;
    }
    // Well-known cloud metadata endpoints (resolved via DNS to link-local).
    if (
      hostname === 'metadata.google.internal' ||
      hostname.endsWith('.metadata.google.internal') ||
      hostname === 'metadata.azure.com' ||
      hostname.endsWith('.metadata.azure.com') ||
      hostname === 'metadata.goog' ||
      hostname.endsWith('.metadata.goog')
    ) {
      return true;
    }
    // IPv6 hostnames keep their brackets in URL.hostname, e.g. '[::1]'.
    if (hostname.includes(':')) {
      return this._isBlockedIpv6(hostname.replace(/^\[|\]$/g, ''));
    }
    return this._isBlockedIpv4(hostname);
  }

  private _isBlockedIpv4(hostname: string): boolean {
    const octets = hostname.split('.');
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) {
      return false;
    }
    const [a, b] = octets.map((o) => Number(o));
    if (octets.some((o) => Number(o) > 255)) {
      return false; // Not a valid IP literal; treated as a hostname.
    }
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local incl. 169.254.169.254
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast + reserved
    );
  }

  private _isBlockedIpv6(hostname: string): boolean {
    if (hostname === '::' || hostname === '::1') {
      return true;
    }
    if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
      return true; // fc00::/7 unique local addresses
    }
    if (/^fe[89ab]/.test(hostname)) {
      return true; // fe80::/10 link-local
    }
    if (hostname.startsWith('ff')) {
      return true; // ff00::/8 multicast
    }
    if (hostname.startsWith('::ffff:')) {
      // IPv4-mapped address, e.g. '::ffff:7f00:1' -> 127.0.0.1.
      const embedded = hostname.slice('::ffff:'.length);
      if (embedded.includes('.')) {
        return this._isBlockedIpv4(embedded);
      }
      const hex = embedded
        .split(':')
        .map((group) => group.padStart(4, '0'))
        .join('');
      const octets = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return this._isBlockedIpv4(octets.join('.'));
    }
    return false;
  }
}
