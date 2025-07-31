/**
 * Utility function to make a fetch request with timeout support
 * @param resource The resource to fetch
 * @param options Fetch options with optional timeout
 * @returns A Promise that resolves to the Response
 */
export async function fetchWithTimeout(
  resource: RequestInfo | URL, 
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 8000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
} 