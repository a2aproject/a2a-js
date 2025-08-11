export interface HttpHeaders { [key: string]: string };

/**
 * Generic interface for handling authentication for HTTP requests.
 * 
 * An example flow using Universal Authentication ([DID](https://w3c.github.io/did/) based signing
 * of JWTs using server challenges and decentralized private keys):
 * 
 * 1. First HTTP request adds the headers from the headers() function to the request.  These headers
 *    may contain an Authorization header with an Agentic JWT, or they might not if no JWT based session has 
 *    been established.  It is possible the headers() function will return a cached Authorization header
 *    that has become invalid
 * 2. For every HTTP response (even 200s) the shouldRetryWithHeaders() function is called.  A server
 *    that requires authentication and for which no Authentication header or an invalid Authentication
 *    header was provided, may return a 401 along with a WWW-Authenticate header that includes a Universal
 *    Authentication challenge.
 * 3. The shouldRetryWithHeaders() function, when a new Authorization token is deemed necessary (such as a 401), 
 *    may use private keys to sign the challenge from the first HTTP request and return the signed JWT
 *    as an Authorization header.
 * 4. The HTTP request is retried with the new Authorization header
 * 5. If the HTTP request is successful, then onSuccessfulRetry() is called (if defined) to signal the
 *    authentication was accepted by the server and can be cached for subsequent requests.
 */
export interface AuthenticationHandler {
    /**
     * Provides additional HTTP request headers.
     * @returns HTTP headers which may include Authorization if available.
     */
    headers: () => Promise<HttpHeaders>;

    /**
     * This method will be always called after each request is executed.  Handler can check if
     * there are auth related failures and if the request needs to be retried with revised headers.
     *
     * New headers are usually needed when the HTTP response issues a 401 or 403.  If this function returns
     * new HTTP headers, then the request should be retried with the revised headers.
     *
     * Note that the new headers returned by this request may be transient, and might only be saved
     * when the onSuccessfulRetry() function is called, or otherwise discarded.  This is an
     * implementation detail of an AuthenticationHandler.  If the headers are transient, then
     * the onSuccessfulRetry() function should be implemented to save the headers for subsequent
     * requests.
     * @param req The RequestInit object used to invoke fetch()
     * @param res The fetch Response object
     * @returns If the HTTP request should be retried then returns the HTTP headers to use,
     * 	or returns undefined if no retry should be made.
     */
    shouldRetryWithHeaders: (req:RequestInit, res:Response) => Promise<HttpHeaders | undefined>;

    /**
     * If the last HTTP request using the headers from shouldRetryWithHeaders() was successful, and
     * this function is implemented, then it will be called with the headers provided from
     * shouldRetryWithHeaders().
     *
     * This callback allows transient headers to be saved for subsequent requests only when they
     * are validated by the server.
    */
    onSuccessfulRetry?: (headers:HttpHeaders) => Promise<void>
}

/**
 * A fetch wrapper that handles authentication logic including retries for 401/403 responses.
 * This class can be used as a drop-in replacement for the native fetch function.
 * 
 * Usage examples:
 * - const authFetch = new AuthHandlingFetch(fetch, authHandler);
 * - const response = await authFetch(url, options);
 * - const response = await authFetch(url); // Direct function call
 */
export class AuthHandlingFetch extends Function {
  private fetchImpl: typeof fetch;
  private authHandler: AuthenticationHandler;

  /**
   * Constructs an AuthHandlingFetch instance.
   * @param fetchImpl The underlying fetch implementation to wrap
   * @param authHandler Authentication handler for managing auth headers and retries
   */
  constructor(fetchImpl: typeof fetch, authHandler: AuthenticationHandler) {
    super();
    this.fetchImpl = fetchImpl;
    this.authHandler = authHandler;
    
    // Make the instance callable
    const boundFetch = this._executeFetch.bind(this);
    Object.setPrototypeOf(boundFetch, AuthHandlingFetch.prototype);
    
    // Bind the fetch method to the instance
    boundFetch.fetch = this.fetch.bind(this);
    
    return boundFetch as any;
  }

  /**
   * Executes a fetch request with authentication handling.
   * If the auth handler provides new headers for the shouldRetryWithHeaders() function, 
   * then the request is retried.
   * @param url The URL to fetch
   * @param init The fetch request options
   * @returns A Promise that resolves to the Response
   */
  async fetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this._executeFetch(url, init);
  }

  /**
   * Internal method to execute fetch with authentication handling.
   * @param url The URL to fetch
   * @param init The fetch request options
   * @returns A Promise that resolves to the Response
   */
  public async _executeFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Merge auth headers with provided headers
    const authHeaders = await this.authHandler.headers() || {};
    const mergedInit: RequestInit = {
      ...(init || {}),
      headers: {
        ...authHeaders,
        ...(init?.headers || {}),
      },
    };

    let response = await this.fetchImpl(url, mergedInit);

    // Check if the auth handler wants to retry the request with new headers
    const updatedHeaders = await this.authHandler.shouldRetryWithHeaders(mergedInit, response);
    if (updatedHeaders) {
      // Retry request with revised headers
      const retryInit: RequestInit = {
        ...(init || {}),
        headers: {
          ...updatedHeaders,
          ...(init?.headers || {}),
        },
      };
      response = await this.fetchImpl(url, retryInit);
      
      if (response.ok && this.authHandler.onSuccessfulRetry) {
        await this.authHandler.onSuccessfulRetry(updatedHeaders); // Remember headers that worked
      }
    }

    return response;
  }
}
