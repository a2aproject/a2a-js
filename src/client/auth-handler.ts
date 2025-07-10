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
     * Called to check if the HTTP request should be retried with new headers.  This usually
     * occours when the HTTP response issues a 401 or 403.  If this
     * function returns new HTTP headers, then the request should be retried with
     * the revised headers.
     * @param req The RequestInit object used to invoke fetch()
     * @param res The fetch Response object
     * @returns If the HTTP request should be retried then returns the HTTP headers to use,
     * 	or returns undefined if no retry should be made.
     */
    shouldRetryWithHeaders: (req:RequestInit, res:Response) => Promise<HttpHeaders | undefined>;

    /* If the last call using the headers was successful, report back using this function. */
    onSuccess: (headers:HttpHeaders) => Promise<void>
}