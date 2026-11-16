/**
 * The `tck-client-parse` behaviour: ACTS §10 client tests.
 *
 * Every other ACTS step drives the SUT as a **server** — send bytes, assert on
 * what comes back. A client test inverts that: it supplies a canonical wire
 * payload and asks whether *this SDK's client* parses it correctly, which no
 * A2A operation can ask a server. §10 defines the file format and says nothing
 * about the mechanism, so without this the eight `CLIENT-*` tests can only be
 * skipped.
 *
 * The runner sends an ordinary `sendMessage` naming `tck-client-parse` with
 * `{operation, wire_payload}` in a data part; this builds a real SDK client
 * whose `fetch` returns that payload verbatim, performs the operation, and
 * hands back whatever the client produced.
 *
 * **An injected `fetch` rather than a bare deserializer.** Parsing the payload
 * straight into the generated types would be a fraction of the code and prove
 * much less: it skips the JSON-RPC envelope, the error mapping and the
 * response plumbing, which is most of what a client test is about.
 * `CLIENT-PARSE-004` makes that concrete — it feeds a JSON-RPC *error*
 * envelope and expects the client to surface `{error: {code, message}}`.
 * Unwrapping that by hand here would reimplement the code under test.
 *
 * The reply is shaped like a dispatcher's `payload` — the §4.2 assertion root
 * for the operation — so `expect_parsed` reads exactly like `expect.body`.
 */

import { AgentCard, Message, Task } from '../src/index.js';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '../src/client/index.js';

export const BEHAVIOR = 'tck-client-parse';

/**
 * Where the fake server lives. Nothing dials it — the injected `fetch`
 * answers before a socket is opened — but the client needs a valid base.
 */
const BASE_URL = 'http://acts-client-parse.invalid';

const CARD_PATH = '/.well-known/agent-card.json';
const EXTENDED_CARD_PATH = '/extendedAgentCard';

/**
 * A `fetch` that answers every request with `payload`.
 *
 * The response's JSON-RPC `id` is rewritten to echo the request's, which is
 * what a real server does. The corpus's canned payloads carry a fixed id
 * (`"req-001"`, `"1"`, …) that cannot match an id the client invented at call
 * time, and a client that validates the correlation — as JSON-RPC 2.0
 * requires — rejects the payload before parsing any of it. Echoing keeps the
 * test about parsing rather than about a correlation the canned-payload model
 * cannot express.
 */
function fetchReturning(payload: unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    let body = payload;
    if (isEnveloped(payload) && typeof init?.body === 'string') {
      try {
        const sent = JSON.parse(init.body) as { id?: unknown };
        if (sent.id !== undefined) {
          body = { ...(payload as Record<string, unknown>), id: sent.id };
        }
      } catch {
        // Not JSON — leave the payload untouched.
      }
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/**
 * A minimal card advertising JSON-RPC, so the factory can bind a transport.
 *
 * Passing the card object rather than a URL is what keeps the injected fetch
 * free to answer with the payload under test: were the client to resolve a
 * card over that fetch it would be handed the `wire_payload` instead.
 */
function scaffoldCard(): AgentCard {
  return {
    name: 'acts-client-parse',
    description: '',
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: true,
    },
    supportedInterfaces: [
      {
        url: BASE_URL,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  } as unknown as AgentCard;
}

/** Is this payload a JSON-RPC envelope rather than a bare object? */
function isEnveloped(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    ('jsonrpc' in payload || 'result' in payload || 'error' in payload)
  );
}

async function clientFor(payload: unknown) {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory({ fetchImpl: fetchReturning(payload) })],
    })
  );
  return factory.createFromAgentCard(scaffoldCard());
}

/**
 * Run a bare card payload through the SDK's own card handling.
 *
 * Both card operations land here when the payload has no envelope, which is
 * how the corpus writes them — and correctly so: a card is fetched over plain
 * HTTP on every binding, so there is nothing to unwrap. The two differ only in
 * the path they are served from.
 */
async function parseCard(payload: unknown, path: string): Promise<unknown> {
  const resolver = new DefaultAgentCardResolver({
    fetchImpl: fetchReturning(payload),
    path,
  });
  return resolver.resolve(BASE_URL, path);
}

/**
 * Render a client-raised error the way `expect_parsed` addresses it.
 *
 * `CLIENT-PARSE-004` asserts `error.code` and `error.message`. An SDK error
 * object does not necessarily carry the JSON-RPC code, so the envelope's own
 * `error` is preferred when the payload had one — the assertion is about the
 * client having surfaced *that* error, and inventing a code here would pass
 * the test without the client having done anything.
 */
function asError(err: unknown, payload: unknown): Record<string, unknown> {
  const raised = err instanceof Error ? err.constructor.name : typeof err;
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).error === 'object' &&
    (payload as Record<string, unknown>).error !== null
  ) {
    return { error: { ...((payload as Record<string, unknown>).error as object) }, raised };
  }
  return { error: { message: err instanceof Error ? err.message : String(err) }, raised };
}

/**
 * ProtoJSON-encode what the client produced.
 *
 * The client hands back the SDK's *internal* ts-proto objects, where a task
 * state is the numeric enum `3` and a text part is
 * `{content: {$case: 'text', value: …}}`. `expect_parsed` is written in wire
 * terms — `TASK_STATE_COMPLETED`, `{text: …}` — so the codecs do the same job
 * `MessageToDict` does on the python side.
 */
function encode(kind: 'task' | 'message' | 'card', value: unknown): unknown {
  if (kind === 'task') return Task.toJSON(value as never);
  if (kind === 'message') return Message.toJSON(value as never);
  return AgentCard.toJSON(value as never);
}

/**
 * Feed `payload` to this SDK's client and return what it produced.
 *
 * The result is the §4.2 assertion root for `operation`: a send-message result
 * keeps its `task`/`message` discriminator, `getTask` returns the Task's own
 * fields, and a card operation returns the card.
 */
export async function parse(operation: string, payload: unknown): Promise<unknown> {
  try {
    if (operation === 'get_agent_card') {
      return encode('card', await parseCard(payload, CARD_PATH));
    }
    if (operation === 'get_extended_agent_card') {
      // The corpus writes this as a bare card, matching the wire: its own
      // `supportedInterfaces` names REST, where the extended card is a plain
      // GET. Accept an envelope too, since JSON-RPC does wrap it.
      if (!isEnveloped(payload)) {
        return encode('card', await parseCard(payload, EXTENDED_CARD_PATH));
      }
      // `getAgentCard()` upgrades to the extended card by itself when the
      // card advertises `extendedAgentCard` — which the scaffold does, and
      // which is the very behaviour `CLIENT-AUTH-001` is about.
      const client = await clientFor(payload);
      return encode('card', await client.getAgentCard());
    }

    const client = await clientFor(payload);
    if (operation === 'send_message') {
      const result = await client.sendMessage({
        message: {
          messageId: 'acts',
          role: 1,
          parts: [],
          metadata: {},
          contextId: '',
          taskId: '',
          extensions: [],
          referenceTaskIds: [],
        },
        metadata: undefined,
        configuration: undefined,
        tenant: '',
      } as never);
      // Keep the oneof, which is exactly the discriminator
      // `expect_parsed: {task: ...}` addresses.
      return isTask(result)
        ? { task: encode('task', result) }
        : { message: encode('message', result) };
    }
    if (operation === 'get_task') {
      return encode(
        'task',
        await client.getTask({ id: 'acts', historyLength: 0, tenant: '' } as never)
      );
    }

    return { error: { message: `unsupported client operation '${operation}'` } };
  } catch (err) {
    return asError(err, payload);
  }
}

/** A send-message result is either a Task or a Message; only a Task has status. */
function isTask(result: unknown): result is Task {
  return typeof result === 'object' && result !== null && 'status' in result;
}

/** Read `{operation, wire_payload}` out of the step's data part. */
export function requestFrom(data: unknown): { operation: string; payload: unknown } | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.operation !== 'string') return undefined;
  return { operation: record.operation, payload: record.wire_payload };
}
