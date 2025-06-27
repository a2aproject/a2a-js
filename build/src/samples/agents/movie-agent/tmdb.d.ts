/**
 * Utility function to call the TMDB API
 * @param endpoint The TMDB API endpoint (e.g., 'movie', 'person')
 * @param query The search query
 * @returns Promise that resolves to the API response data
 */
export declare function callTmdbApi(endpoint: string, query: string): Promise<any>;
