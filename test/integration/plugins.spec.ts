import { AsyncLocalStorage } from 'node:async_hooks';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import express from 'express';
import * as grpc from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCard, TaskState, TaskStatus } from '../../src/index.js';
import {
  AgentEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from '../../src/server/index.js';
import { STATE_HEADERS_KEY, type ServerCallContext } from '../../src/server/context.js';
import { jsonRpcHandler, restHandler, UserBuilder } from '../../src/server/express/index.js';
import { A2AService, grpcService } from '../../src/server/grpc/index.js';
import { ClientFactory, ClientFactoryOptions } from '../../src/client/factory.js';
import { GrpcTransportFactory } from '../../src/client/transports/grpc/grpc_transport.js';
import type { A2APlugin, PushResult } from '../../src/plugins/index.js';
import { drain, lastState, makeParams } from './support/fixtures.js';
import { waitFor } from './support/delaying.js';

/** Records server, client, execution and task hook calls; `args(hook)` returns what each received. */
function recorder(): { plugin: A2APlugin; args: (hook: string) => any[] } {
  const calls: [string, any][] = [];
  const record =
    (hook: string) =>
    (arg: unknown): void =>
      void calls.push([hook, arg]);
  const plugin: A2APlugin = {
    name: 'recorder',
    beforeHandlerRun: record('beforeHandlerRun'),
    aroundHandlerRun: (req, next) => (calls.push(['aroundHandlerRun', req]), next()),
    afterHandlerRun: record('afterHandlerRun'),
    beforeClientRequest: record('beforeClientRequest'),
    aroundClientRequest: (req, next) => (calls.push(['aroundClientRequest', req]), next()),
    afterClientRequest: record('afterClientRequest'),
    beforeExecution: record('beforeExecution'),
    onExecutionEvent: (_ctx, event) => void calls.push(['onExecutionEvent', event]),
    afterExecution: (_ctx, error) => void calls.push(['afterExecution', error]),
    onTaskEvent: record('onTaskEvent'),
  };
  return { plugin, args: (hook) => calls.filter(([h]) => h === hook).map(([, arg]) => arg) };
}

const headers = (context: ServerCallContext) =>
  context.state.get(STATE_HEADERS_KEY) as Record<string, string | undefined>;

const status = (state: TaskState): TaskStatus => ({
  state,
  message: undefined,
  timestamp: undefined,
});

/** Publishes the task, WORKING, an artifact, then COMPLETED. */
class TaskAgent implements AgentExecutor {
  async execute({ taskId, contextId }: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const update = (state: TaskState) =>
      AgentEvent.statusUpdate({ taskId, contextId, status: status(state), metadata: {} });
    bus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: status(TaskState.TASK_STATE_SUBMITTED),
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    bus.publish(update(TaskState.TASK_STATE_WORKING));
    bus.publish(
      AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: {
          artifactId: 'out',
          name: '',
          description: '',
          parts: [],
          metadata: {},
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: {},
      })
    );
    bus.publish(update(TaskState.TASK_STATE_COMPLETED));
  }

  async cancelTask(): Promise<void> {}
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

const bindings = ['JSONRPC', 'HTTP+JSON', 'GRPC'] as const;
type Binding = (typeof bindings)[number];

/** Serves an agent over JSON-RPC, REST and gRPC; returns its card. */
async function serve(executor: AgentExecutor, plugins: A2APlugin[]): Promise<AgentCard> {
  // The handler validates versions against this card: v1.0 on every binding,
  // plus v0.3 on JSON-RPC for the compat test.
  const card: AgentCard = {
    name: 'Plugin Agent',
    description: '',
    version: '1.0.0',
    provider: undefined,
    documentationUrl: '',
    supportedInterfaces: [
      ...bindings.map((protocolBinding) => ({
        url: '',
        protocolBinding,
        tenant: '',
        protocolVersion: '1.0',
      })),
      { url: '', protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '0.3' },
    ],
    capabilities: { extensions: [], streaming: true, pushNotifications: true },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
    signatures: [],
  };
  const requestHandler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    executor,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { plugins }
  );
  const userBuilder = UserBuilder.noAuthentication;

  const app = express();
  app.use('/rpc', jsonRpcHandler({ requestHandler, userBuilder, legacyCompat: { enabled: true } }));
  app.use('/rest', restHandler({ requestHandler, userBuilder }));
  const http = app.listen(0);
  await once(http, 'listening');
  closers.push(() => http.close());
  const base = `http://localhost:${(http.address() as AddressInfo).port}`;

  const rpc = new grpc.Server();
  rpc.addService(A2AService, grpcService({ requestHandler, userBuilder }));
  const port = await new Promise<number>((resolve, reject) =>
    rpc.bindAsync('localhost:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p)
    )
  );
  closers.push(() => rpc.forceShutdown());

  const urls = { JSONRPC: `${base}/rpc`, 'HTTP+JSON': `${base}/rest`, GRPC: `localhost:${port}` };
  for (const i of card.supportedInterfaces) i.url = urls[i.protocolBinding as Binding];
  return card;
}

/** Creates a client for one binding of `card`; the factory prefers its v1.0 interface. */
function connect(card: AgentCard, binding: Binding, plugins: A2APlugin[]) {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new GrpcTransportFactory()],
      preferredTransports: [binding],
      clientConfig: { plugins },
    })
  );
  return factory.createFromAgentCard(card);
}

describe.each(bindings)('plugins over %s', (binding) => {
  /** Checks one side of a 4-event stream: around wraps every pull, after runs per event and at the end. */
  function expectStreamHooks(
    side: ReturnType<typeof recorder>,
    before: string,
    around: string,
    after: string
  ): void {
    expect(side.args(before).map((r) => r.method)).toEqual(['SendStreamingMessage']);
    expect(side.args(around)).toHaveLength(5);
    expect(side.args(after).map((r) => [r.isStreamEvent, r.isFinal, r.error])).toEqual([
      ...Array(4).fill([true, false, undefined]),
      [false, true, undefined],
    ]);
  }

  it('run every hook on both sides of a streaming send', async () => {
    const server = recorder();
    const caller = recorder();
    const tracing: A2APlugin = {
      name: 'tracing',
      beforeClientRequest: (req) => {
        req.options.serviceParameters = { ...req.options.serviceParameters, 'x-trace': 'trace-1' };
      },
    };
    const card = await serve(new TaskAgent(), [server.plugin]);
    const client = await connect(card, binding, [tracing, caller.plugin]);

    const events = await drain(client.sendMessageStream(makeParams('m1')));

    expect(events).toHaveLength(4);
    expect(lastState(events)).toBe(TaskState.TASK_STATE_COMPLETED);
    expectStreamHooks(caller, 'beforeClientRequest', 'aroundClientRequest', 'afterClientRequest');
    expectStreamHooks(server, 'beforeHandlerRun', 'aroundHandlerRun', 'afterHandlerRun');

    const [run] = server.args('beforeHandlerRun');
    expect(run.context.protocolBinding).toBe(binding);
    expect(headers(run.context)['x-trace']).toBe('trace-1');

    expect(server.args('beforeExecution')).toHaveLength(1);
    expect(server.args('onExecutionEvent')).toHaveLength(4);
    expect(server.args('afterExecution')).toEqual([undefined]);
    expect(server.args('onTaskEvent').map((i) => [i.fromState, i.toState])).toEqual([
      [undefined, TaskState.TASK_STATE_SUBMITTED],
      [TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING],
      [TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_WORKING],
      [TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_COMPLETED],
    ]);

    // A unary call goes through the same hooks on this binding.
    await client.sendMessage(makeParams('m2'));
    expect(server.args('beforeHandlerRun').map((r) => r.method)).toEqual([
      'SendStreamingMessage',
      'SendMessage',
    ]);
  });
});

describe('plugins across the SDK', () => {
  it('run push hooks in the default sender the handler builds', async () => {
    // TaskAgent's 4 events each trigger a push; wait for all so none outlive the webhook.
    const pushHeaders: (string | undefined)[] = [];
    const results: PushResult[] = [];
    const webhook = express();
    webhook.post('/hook', (req, res) => {
      pushHeaders.push(req.header('x-push-trace'));
      res.sendStatus(200);
    });
    const hook = webhook.listen(0);
    await once(hook, 'listening');
    closers.push(() => hook.close());

    const card = await serve(new TaskAgent(), [
      {
        name: 'push',
        beforePushSend: (req) => void (req.headers['x-push-trace'] = 'push-1'),
        onPushSent: (r) => void results.push(r),
      },
    ]);
    const client = await connect(card, 'JSONRPC', []);
    const params = makeParams('m1');
    params.configuration = {
      acceptedOutputModes: [],
      returnImmediately: false,
      taskPushNotificationConfig: {
        tenant: '',
        id: 'cfg',
        taskId: '',
        url: `http://localhost:${(hook.address() as AddressInfo).port}/hook`,
        token: '',
        authentication: undefined,
      },
    };

    await client.sendMessage(params);
    await waitFor(() => results.length === 4, '4 push deliveries');

    expect(pushHeaders).toEqual(Array(4).fill('push-1'));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
  });

  it('run server hooks for a v0.3 JSON-RPC request', async () => {
    const server = recorder();
    const card = await serve(new TaskAgent(), [server.plugin]);

    const v03 = card.supportedInterfaces.find((i) => i.protocolVersion === '0.3');
    const response = await fetch(v03?.url ?? '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'm-03',
            role: 'user',
            parts: [{ kind: 'text', text: 'hi' }],
          },
        },
      }),
    });

    expect(await response.json()).toMatchObject({ result: { status: { state: 'completed' } } });
    const [run] = server.args('beforeHandlerRun');
    expect(run.method).toBe('SendMessage');
    expect(run.context.protocolBinding).toBe('JSONRPC');
    expect(server.args('afterHandlerRun').at(-1).isFinal).toBe(true);
  });

  it('pass request state to outgoing calls through aroundExecution', async () => {
    // A tenant plugin forwards x-tenant from the request an agent serves to the calls it makes.
    const tenant = new AsyncLocalStorage<string | undefined>();
    const tenantPlugin: A2APlugin = {
      name: 'tenant',
      aroundExecution: (ctx, next) => tenant.run(headers(ctx.context)['x-tenant'], next),
      beforeClientRequest: (req) => {
        const value = tenant.getStore();
        if (value)
          req.options.serviceParameters = { ...req.options.serviceParameters, 'x-tenant': value };
      },
    };
    const downstream = recorder();
    const downstreamCard = await serve(new TaskAgent(), [downstream.plugin]);
    const orchestrator: AgentExecutor = {
      async execute(ctx, bus) {
        const client = await connect(downstreamCard, 'JSONRPC', [tenantPlugin]);
        await client.sendMessage(makeParams('forwarded'));
        await new TaskAgent().execute(ctx, bus);
      },
      async cancelTask() {},
    };
    const card = await serve(orchestrator, [tenantPlugin]);
    const client = await connect(card, 'JSONRPC', []);

    await client.sendMessage(makeParams('plan'), { serviceParameters: { 'x-tenant': 'acme' } });

    const [run] = downstream.args('beforeHandlerRun');
    expect(headers(run.context)['x-tenant']).toBe('acme');
  });
});
