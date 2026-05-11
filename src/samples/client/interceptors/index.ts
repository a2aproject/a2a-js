import { v4 as uuidv4 } from 'uuid';

import {
  AfterArgs,
  BeforeArgs,
  CallInterceptor,
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from '../../../client/index.js';
import { Role } from '../../../index.js';
import { SendMessageRequest } from '../../../types/pb/a2a.js';

/**
 * Demonstrates client-side customization via {@link CallInterceptor}s.
 *
 * - {@link RequestIdInterceptor} adds an `X-Request-ID` header to every call
 *   via the transport-agnostic `serviceParameters` map.
 * - {@link LoggingInterceptor} logs the duration of every method invocation,
 *   measured between `before` and `after` callbacks.
 *
 * After the interceptor demo, the script also shows how to apply a per-call
 * timeout using `AbortSignal.timeout(...)`.
 *
 * Run any A2A server (e.g. `npm run agents:sample-agent`) and then:
 *
 *   npm run client:interceptors
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:41241';

// --- Interceptors ----------------------------------------------------------

/**
 * Injects a unique `X-Request-ID` value into every request so that server
 * logs can be correlated to client invocations. Values are passed through
 * `RequestOptions.serviceParameters`, the transport-agnostic abstraction
 * defined in A2A Specification §3.2.6
 * (https://a2a-protocol.org/latest/specification/#326-service-parameters).
 * Each SDK transport maps `serviceParameters` onto its native channel: the
 * JSON-RPC and HTTP+JSON/REST transports send them as HTTP request headers
 * (per §9.2 and §11.2), while the gRPC transport sends them as request
 * metadata (per §10.2). Either way the value reaches the server, but the
 * exact wire delivery depends on the transport selected by `ClientFactory`.
 */
class RequestIdInterceptor implements CallInterceptor {
  async before(args: BeforeArgs): Promise<void> {
    const requestId = uuidv4();
    args.options = {
      ...args.options,
      serviceParameters: {
        ...(args.options?.serviceParameters ?? {}),
        'X-Request-ID': requestId,
      },
    };
    console.log(`[RequestIdInterceptor] ${args.input?.method} -> X-Request-ID=${requestId}`);
  }

  async after(_args: AfterArgs): Promise<void> {
    // No-op; interceptors implementing only one phase still need to satisfy
    // the interface.
  }
}

/**
 * Times every client call. The timer is stashed in the request's
 * `serviceParameters` map (which both `before` and `after` see) by encoding
 * the start time under a custom key.
 */
const TIMING_HEADER = 'X-Demo-Start-Ms';

class LoggingInterceptor implements CallInterceptor {
  async before(args: BeforeArgs): Promise<void> {
    const start = performance.now();
    args.options = {
      ...args.options,
      serviceParameters: {
        ...(args.options?.serviceParameters ?? {}),
        [TIMING_HEADER]: String(start),
      },
    };
    console.log(`[LoggingInterceptor] -> ${args.input?.method}`);
  }

  async after(args: AfterArgs): Promise<void> {
    const startStr = args.options?.serviceParameters?.[TIMING_HEADER];
    const elapsed =
      startStr === undefined ? '?' : `${(performance.now() - Number(startStr)).toFixed(1)}ms`;
    console.log(`[LoggingInterceptor] <- ${args.result?.method} (${elapsed})`);
  }
}

// --- Main ------------------------------------------------------------------

async function main() {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory()],
      clientConfig: {
        // Interceptors run in declared order for `before` and reverse order for `after`.
        interceptors: [new LoggingInterceptor(), new RequestIdInterceptor()],
      },
    })
  );
  const client = await factory.createFromUrl(AGENT_URL);

  // 1. Plain send: both interceptors will fire.
  console.log('\n--- Demo 1: Interceptors fire on each call ---');
  await client.sendMessage(buildMessage('Hello with interceptors!'));

  // 2. Per-call timeout with AbortSignal.
  console.log('\n--- Demo 2: Per-call AbortSignal.timeout ---');
  try {
    await client.sendMessage(buildMessage('Hello with a 5s timeout.'), {
      signal: AbortSignal.timeout(5000),
    });
    console.log('[Main] Call returned within the timeout.');
  } catch (err) {
    console.error('[Main] Call aborted or failed:', err);
  }

  // 3. Demonstrating an extremely tight timeout that is expected to fail.
  console.log('\n--- Demo 3: Forcing a timeout (1ms) ---');
  try {
    await client.sendMessage(buildMessage('This call should time out.'), {
      signal: AbortSignal.timeout(1),
    });
    console.log('[Main] Unexpected: call succeeded despite 1ms timeout.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[Main] As expected, the call was aborted: ${message}`);
  }
}

function buildMessage(text: string): SendMessageRequest {
  return {
    tenant: '',
    metadata: {},
    message: {
      messageId: uuidv4(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: text },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    configuration: undefined,
  };
}

main().catch((err) => {
  console.error('[Main] Error:', err);
  process.exit(1);
});
