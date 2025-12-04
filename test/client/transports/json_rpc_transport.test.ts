import { JsonRpcTransport } from '../../../src/client/transports/json_rpc_transport.js';
import { expect } from 'chai';
import sinon from 'sinon';
import { describe, it, beforeEach } from 'mocha';
import { MessageSendParams, TextPart } from '../../../src/types.js';
import { RequestOptions } from '../../../src/client/multitransport-client.js';
import { ACTIVATED_EXTENSION_HEADER, HTTP_EXTENSION_HEADER } from '../../../src/constants.js';

describe('JsonRpcTransport', () => {
  let transport: JsonRpcTransport;
  let mockFetch: sinon.SinonStubbedFunction<typeof fetch>;
  const endpoint = 'https://test.endpoint/api';

  beforeEach(() => {
    mockFetch = sinon.stub();
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
      const options: RequestOptions = {
        context: new Map<symbol, unknown>(),
        serviceParameters: { [HTTP_EXTENSION_HEADER]: expectedExtensions },
      };

      mockFetch.resolves(
        new Response(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }), {
          headers: { [HTTP_EXTENSION_HEADER]: 'extension1' },
          status: 200,
        })
      );
      await transport.sendMessage(messageParams, options);
      const fetchArgs = mockFetch.firstCall.args[1];
      const headers = fetchArgs.headers;
      expect((headers as any)[HTTP_EXTENSION_HEADER]).to.deep.equal(expectedExtensions);
      expect(options.context.get(ACTIVATED_EXTENSION_HEADER) as string[]).to.deep.equal([
        'extension1',
      ]);
    });
  });
});
