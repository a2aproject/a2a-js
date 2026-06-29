export interface HttpHeaders {
  [key: string]: string;
}

/**
 * Pluggable authentication handler for HTTP requests.
 *
 * - {@link headers} is called before each request to supply additional
 *   request headers (typically `Authorization`).
 * - {@link shouldRetryWithHeaders} is called after every response and
 *   decides whether the request should be retried with new headers,
 *   typically in response to a 401 / 403 or a WWW-Authenticate.
 * - {@link onSuccessfulRetry}, if defined, is called when a retry
 *   succeeds, giving the handler a chance to persist the new headers.
 */
export interface AuthenticationHandler {
  /** Returns request headers (may include `Authorization`). */
  headers: () => Promise<HttpHeaders>;

  /**
   * Called for every response. Returns new headers if the request
   * should be retried, or `undefined` to skip the retry.
   */
  shouldRetryWithHeaders: (req: RequestInit, res: Response) => Promise<HttpHeaders | undefined>;

  /**
   * Called when a retry using the headers from
   * {@link shouldRetryWithHeaders} succeeded. Lets the handler persist
   * those headers for subsequent requests.
   */
  onSuccessfulRetry?: (headers: HttpHeaders) => Promise<void>;
}

/**
 * Wraps `fetch` with authentication handling. The returned function
 * injects headers from `authHandler.headers()`, retries when
 * `authHandler.shouldRetryWithHeaders` returns new headers, and notifies
 * via `onSuccessfulRetry` when the retry succeeds.
 */
export function createAuthenticatingFetchWithRetry(
  fetchImpl: typeof fetch,
  authHandler: AuthenticationHandler
): typeof fetch {
  async function authFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const authHeaders = (await authHandler.headers()) || {};
    const mergedInit: RequestInit = {
      ...(init || {}),
      headers: {
        ...authHeaders,
        ...(init?.headers || {}),
      },
    };

    let response = await fetchImpl(url, mergedInit);

    const updatedHeaders = await authHandler.shouldRetryWithHeaders(mergedInit, response);
    if (updatedHeaders) {
      const retryInit: RequestInit = {
        ...(init || {}),
        headers: {
          ...updatedHeaders,
          ...(init?.headers || {}),
        },
      };
      response = await fetchImpl(url, retryInit);

      if (response.ok && authHandler.onSuccessfulRetry) {
        await authHandler.onSuccessfulRetry(updatedHeaders);
      }
    }

    return response;
  }

  // Preserve fetch's own properties so the wrapped function is a drop-in.
  Object.setPrototypeOf(authFetch, Object.getPrototypeOf(fetchImpl));
  Object.defineProperties(authFetch, Object.getOwnPropertyDescriptors(fetchImpl));

  return authFetch;
}
