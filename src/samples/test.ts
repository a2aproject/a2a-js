import { A2AClient } from '@a2a-js/sdk/client';
import { v4 as uuidv4 } from 'uuid';
import { AfterArgs, BeforeArgs, CallInterceptor } from '../client/interceptors.js';
import { ClientFactory, ClientFactoryOptions } from '../client/factory.js';

// 1. Define an interceptor
class RequestIdInterceptor implements CallInterceptor {
  before(args: BeforeArgs): Promise<void> {
    args.options = {
      ...args.options,
      serviceParameters: {
        ...args.options.serviceParameters,
        ['X-Request-ID']: uuidv4(),
      },
    };
    return Promise.resolve();
  }

  after(_args: AfterArgs): Promise<void> {
    return Promise.resolve();
  }
}

// 2. Register the interceptor in the client factory
const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  clientConfig: {
    interceptors: [new RequestIdInterceptor()]
  }
}))
const client = await factory.createFromAgentCardUrl('http://localhost:4000', {
  fetchImpl: fetchWithCustomHeader,
});

// Now, all requests made by this client instance will include the X-Request-ID header.
await client.sendMessage({
  message: {
    messageId: uuidv4(),
    role: 'user',
    parts: [{ kind: 'text', text: 'A message requiring custom headers.' }],
    kind: 'message',
  },
});