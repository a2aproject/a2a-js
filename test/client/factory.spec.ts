import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { ClientFactory, ClientFactoryOptions } from '../../src/client/factory.js';
import { TransportFactory, Transport } from '../../src/client/transports/transport.js';
import { JsonRpcTransportFactory } from '../../src/client/transports/json_rpc_transport.js';
import { AgentCard } from '../../src/types.js';
import { Client } from '../../src/client/multitransport-client.js';

describe('ClientFactory', () => {
  let mockTransportFactory1: sinon.SinonStubbedInstance<TransportFactory>;
  let mockTransportFactory2: sinon.SinonStubbedInstance<TransportFactory>;
  let mockTransport: sinon.SinonStubbedInstance<Transport>;

  beforeEach(() => {
    mockTransport = {
      getExtendedAgentCard: sinon.stub(),
      sendMessage: sinon.stub(),
      sendMessageStream: sinon.stub(),
      setTaskPushNotificationConfig: sinon.stub(),
      getTaskPushNotificationConfig: sinon.stub(),
      listTaskPushNotificationConfig: sinon.stub(),
      deleteTaskPushNotificationConfig: sinon.stub(),
      getTask: sinon.stub(),
      cancelTask: sinon.stub(),
      resubscribeTask: sinon.stub(),
    };

    mockTransportFactory1 = {
      protocolName: 'Transport1',
      create: sinon.stub(),
    };
    mockTransportFactory1.create.resolves(mockTransport);

    mockTransportFactory2 = {
      protocolName: 'Transport2',
      create: sinon.stub(),
    };
    mockTransportFactory2.create.resolves(mockTransport);
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const factory = new ClientFactory();
      expect(factory.options).to.deep.equal(ClientFactoryOptions.default);
    });

    it('should throw error if preferred transport is unknown', () => {
      const options: ClientFactoryOptions = {
        transports: [mockTransportFactory1],
        preferredTransports: ['UnknownTransport'],
      };
      expect(() => new ClientFactory(options)).to.throw(
        'Unknown preferred transport: UnknownTransport, available transports: Transport1'
      );
    });

    it('should throw error if duplicate transport names are provided', () => {
      const options: ClientFactoryOptions = {
        transports: [mockTransportFactory1, mockTransportFactory1], // Same name
      };
      expect(() => new ClientFactory(options)).to.throw('Duplicate transport name: Transport1');
    });

    it('should accept valid custom options', () => {
      const options: ClientFactoryOptions = {
        transports: [mockTransportFactory1],
        preferredTransports: ['Transport1'],
      };

      const factory = new ClientFactory(options);

      expect(factory.options).to.equal(options);
    });
  });

  describe('createClient', () => {
    let agentCard: AgentCard;

    beforeEach(() => {
      agentCard = {
        protocolVersion: '0.3.0',
        name: 'Test Agent',
        description: 'Test',
        url: 'http://transport1.com',
        preferredTransport: 'Transport1',
        version: '1.0.0',
        capabilities: {},
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
      };
    });

    it('should use agentCard.preferredTransport if available and supported', async () => {
      const factory = new ClientFactory({ transports: [mockTransportFactory1] });

      const client = await factory.createFromAgentCard(agentCard);

      expect(client).to.be.instanceOf(Client);
      expect(mockTransportFactory1.create.calledOnceWith('http://transport1.com', agentCard)).to.be
        .true;
    });

    it('should use factory preferred transport if available', async () => {
      agentCard.additionalInterfaces = [{ transport: 'Transport2', url: 'http://transport2.com' }];
      const factory = new ClientFactory({
        transports: [mockTransportFactory1, mockTransportFactory2],
        preferredTransports: ['Transport2'],
      });

      await factory.createFromAgentCard(agentCard);

      expect(mockTransportFactory2.create.calledOnce).to.be.true;
    });

    it('should throw error if no compatible transport found', async () => {
      const factory = new ClientFactory({ transports: [mockTransportFactory1] });
      agentCard.preferredTransport = 'Transport2'; // Not supported

      try {
        await factory.createFromAgentCard(agentCard);
        expect.fail('Should have thrown error');
      } catch (e: any) {
        expect(e.message).to.include('No compatible transport found');
      }
    });

    it('should fallback to default transport if preferred transport is missing but default supported', async () => {
      const factory = new ClientFactory({
        transports: [mockTransportFactory1, mockTransportFactory2],
        preferredTransports: ['Transport2'], // Not supported
      });

      await factory.createFromAgentCard(agentCard);

      expect(mockTransportFactory1.create.calledOnce).to.be.true;
    });

    it('should default to JSONRPC transport if agentCard.preferredTransport is undefined', async () => {
      agentCard.preferredTransport = undefined;
      const jsonRpcFactory = {
        protocolName: JsonRpcTransportFactory.name,
        create: sinon.stub().resolves(mockTransport),
      };
      const factory = new ClientFactory({ transports: [jsonRpcFactory] });

      await factory.createFromAgentCard(agentCard);

      expect(jsonRpcFactory.create.calledOnce).to.be.true;
    });

    it('should pass clientConfig to the created Client', async () => {
      const clientConfig = { polling: true };
      const factory = new ClientFactory({
        transports: [mockTransportFactory1],
        clientConfig,
      });

      const client = await factory.createFromAgentCard(agentCard);

      expect(client.config).to.equal(clientConfig);
    });

    it('should use card resolver with default path', async () => {
      const cardResolver = {
        resolve: sinon.stub().resolves(agentCard),
      };
      const factory = new ClientFactory({
        transports: [mockTransportFactory1],
        cardResolver,
      });

      await factory.createFromAgentCardUrl('http://transport1.com');

      expect(mockTransportFactory1.create.calledOnce);
      expect(cardResolver.resolve.calledOnceWith('http://transport1.com')).to.be.true;
    });

    it('should use card resolver with custom path', async () => {
      const cardResolver = {
        resolve: sinon.stub().resolves(agentCard),
      };
      const factory = new ClientFactory({
        transports: [mockTransportFactory1],
        cardResolver,
      });

      await factory.createFromAgentCardUrl('http://transport1.com', 'a2a/my-agent-card.json');

      expect(mockTransportFactory1.create.calledOnce);
      expect(cardResolver.resolve.calledOnceWith('http://transport1.com', 'a2a/my-agent-card.json'))
        .to.be.true;
    });
  });
});
