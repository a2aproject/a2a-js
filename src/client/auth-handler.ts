export interface HttpHeaders { [key: string]: string };

/**
 * Generic interface for handling authentication for HTTP requests.
 * 
 * Handle HTTP 401 and 403 error codes from fetch results. If the shouldRetryWithHeaders
 * function returns revised headers, then retry the request using revised headers and report
 * success with onSuccess().
 */
export interface AuthenticationHandler {
    /**
     * Provides additional HTTP request headers.
     * @returns HTTP headers which should include Authorization if available.
     */
    headers: () => HttpHeaders;

    /**
     * Called to check if the HTTP request should be retried with *new* headers.  This usually
     * occours when the HTTP response issues a 401 or 403.  If this
     * function returns new HTTP headers, then the request should be retried with
     * the revised headers.
     *
     * Note that the new headers returned by this request are transient, and will only be saved
     * when the onSuccess() function is called, or otherwise discarded.
     * @param req The RequestInit object used to invoke fetch()
     * @param res The fetch Response object
     * @returns If the HTTP request should be retried then returns the HTTP headers to use,
     * 	or returns undefined if no retry should be made.
     */
    shouldRetryWithHeaders: (req:RequestInit, res:Response) => Promise<HttpHeaders | undefined>;

    /**
     * If the last call using the headers from shouldRetryWithHeaders() was successful, report back
     * using this function so the headers are preserved for subsequent requests.
     *
     * It is possible the server will reject the headers if they are not valid.  In this case,
     * the attempted headers should be discarded which is accomplished by not calling this function.
    */
    onSuccess: (headers:HttpHeaders) => Promise<void>
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
   * If the response is a 401/403 and the auth handler provides new headers, the request is retried.
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
    const authHeaders = this.authHandler.headers() || {};
    const mergedInit: RequestInit = {
      ...(init || {}),
      headers: {
        ...authHeaders,
        ...(init?.headers || {}),
      },
    };

    let response = await this.fetchImpl(url, mergedInit);

    // Check for HTTP 401/403 and retry request if necessary
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
      
      if (response.ok && this.authHandler.onSuccess) {
        await this.authHandler.onSuccess(updatedHeaders); // Remember headers that worked
      }
    }

    return response;
  }
}
