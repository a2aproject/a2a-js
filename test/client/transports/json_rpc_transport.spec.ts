import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { MessageSendParams, TextPart } from '../../../src/types.js';
import { RequestOptions } from '../../../src/client/multitransport-client.js';
import { HTTP_EXTENSION_HEADER } from '../../../src/constants.js';
import { ServiceParameters, withA2AExtensions } from '../../../src/client/service-parameters.js';

describe('JsonRpcTransport', () => {
  let transport: JsonRpcTransport;
  let mockFetch: Mock<typeof fetch>;
  const endpoint = 'https://test.endpoint/api';

  beforeEach(() => {
    mockFetch = vi.fn();
    transport = new JsonRpcTransport({
      endpoint,
      fetchImpl: mockFetch,
    });
  });

  describe('sendMessage', () => {
    it('should correctly add the extension headers', async () => {
      const messageParams: MessageSendParams = {
        message: {
          kind: 'message',
          messageId: 'test-msg-1',
          role: 'user',
          parts: [
            {
              kind: 'text',
              text: 'Hello, agent!',
            } as TextPart,
          ],
        },
      };

      const expectedExtensions = 'extension1,extension2';
      const serviceParameters = ServiceParameters.create(withA2AExtensions(expectedExtensions));
      const options: RequestOptions = {
        serviceParameters,
      };

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }), {
          status: 200,
        })
      );
      await transport.sendMessage(messageParams, options);
      const fetchArgs = mockFetch.mock.calls[0][1];
      const headers = fetchArgs.headers;
      expect((headers as any)[HTTP_EXTENSION_HEADER]).to.deep.equal(expectedExtensions);
    });
  });
});
