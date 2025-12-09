import { v4 as uuidv4 } from 'uuid';
import {
  A2AClient,
  AfterArgs,
  AuthenticationHandler,
  BeforeArgs,
  CallInterceptor,
  ClientFactory,
  ClientFactoryOptions,
  createAuthenticatingFetchWithRetry,
  JsonRpcTransportFactory,
} from '../../client/index.js';

// A simple token provider that simulates fetching a new token.
const tokenProvider = {
  token: 'initial-stale-token',
  getNewToken: async () => {
    console.log('Refreshing auth token...');
    tokenProvider.token = `new-token-${Date.now()}`;
    return tokenProvider.token;
  },
};

// 1. Implement the AuthenticationHandler interface.
const handler: AuthenticationHandler = {
  // headers() is called on every request to get the current auth headers.
  headers: async () => ({
    Authorization: `Bearer ${tokenProvider.token}`,
  }),

  // shouldRetryWithHeaders() is called after a request fails.
  // It decides if a retry is needed and provides new headers.
  shouldRetryWithHeaders: async (req: RequestInit, res: Response) => {
    if (res.status === 401) {
      // Unauthorized
      const newToken = await tokenProvider.getNewToken();
      // Return new headers to trigger a single retry.
      return { Authorization: `Bearer ${newToken}` };
    }

    // Return undefined to not retry for other errors.
    return undefined;
  },
};

// 2. Create the authenticated fetch function.
const authFetch = createAuthenticatingFetchWithRetry(fetch, handler);

// 3. Inject new fetch implementation into a client factory.
const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  transports: [
    new JsonRpcTransportFactory({ fetchImpl: authFetch })
  ]
}))
const client = await factory.createFromUrl('http://localhost:4000');
