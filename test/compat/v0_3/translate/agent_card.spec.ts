import { describe, expect, it } from 'vitest';
import {
  toCompatAgentCapabilities,
  toCompatAgentCard,
  toCompatAgentCardSignature,
  toCompatAgentExtension,
  toCompatAgentInterface,
  toCompatAgentProvider,
  toCompatAgentSkill,
  toCoreAgentCapabilities,
  toCoreAgentCard,
  toCoreAgentCardSignature,
  toCoreAgentExtension,
  toCoreAgentInterface,
  toCoreAgentProvider,
  toCoreAgentSkill,
} from '../../../../src/compat/v0_3/translate/agent_card.js';
import { VersionNotSupportedError } from '../../../../src/errors.js';
import type { AgentCard as V1AgentCard } from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('agent_card', () => {
  describe('AgentInterface', () => {
    it('maps transport ↔ protocolBinding', () => {
      const compat: legacy.AgentInterface = { url: 'https://x', transport: 'JSONRPC' };
      const core = toCoreAgentInterface(compat);
      expect(core.protocolBinding).toBe('JSONRPC');
      expect(core.protocolVersion).toBe('0.3');
      expect(toCompatAgentInterface(core)).toEqual(compat);
    });
  });

  describe('AgentProvider', () => {
    it('round-trips', () => {
      const compat: legacy.AgentProvider = { url: 'https://p', organization: 'Org' };
      expect(toCompatAgentProvider(toCoreAgentProvider(compat))).toEqual(compat);
    });
  });

  describe('AgentExtension', () => {
    it('round-trips', () => {
      const compat: legacy.AgentExtension = {
        uri: 'https://ext.example/a',
        description: 'desc',
        required: true,
        params: { p: 'v' },
      };
      expect(toCompatAgentExtension(toCoreAgentExtension(compat))).toEqual(compat);
    });

    it('defaults required=false going compat → core', () => {
      const compat: legacy.AgentExtension = { uri: 'https://ext.example/a' };
      const core = toCoreAgentExtension(compat);
      expect(core.required).toBe(false);
    });
  });

  describe('AgentCapabilities', () => {
    it('drops stateTransitionHistory (v0.3-only) going core → compat', () => {
      const core = toCoreAgentCapabilities({
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      });
      const compat = toCompatAgentCapabilities(core);
      expect(compat.streaming).toBe(true);
      expect(compat.pushNotifications).toBe(false);
      expect(compat.stateTransitionHistory).toBeUndefined();
    });

    it('does not propagate extendedAgentCard from capabilities (card handles it)', () => {
      const compat = toCompatAgentCapabilities({
        streaming: undefined,
        pushNotifications: undefined,
        extensions: [],
        extendedAgentCard: true,
      });
      // The capabilities-level translator must NOT introduce a v0.3
      // field for the extended-card flag — that lives on the card.
      expect(Object.keys(compat)).not.toContain('extendedAgentCard');
      expect(Object.keys(compat)).not.toContain('supportsAuthenticatedExtendedCard');
    });
  });

  describe('AgentSkill', () => {
    it('round-trips with security', () => {
      const compat: legacy.AgentSkill = {
        id: 's1',
        name: 'Skill',
        description: 'desc',
        tags: ['t'],
        examples: ['ex'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        security: [{ oauth2: ['read'] }],
      };
      expect(toCompatAgentSkill(toCoreAgentSkill(compat))).toEqual(compat);
    });

    it('drops empty optional arrays going core → compat', () => {
      const core = toCoreAgentSkill({
        id: 's1',
        name: 'Skill',
        description: 'desc',
        tags: ['t'],
      });
      const compat = toCompatAgentSkill(core);
      expect(compat.examples).toBeUndefined();
      expect(compat.inputModes).toBeUndefined();
      expect(compat.outputModes).toBeUndefined();
      expect(compat.security).toBeUndefined();
    });
  });

  describe('AgentCardSignature', () => {
    it('round-trips', () => {
      const compat: legacy.AgentCardSignature = {
        protected: 'eyJhbGciOi...',
        signature: 'sig...',
        header: { kid: 'key-1' },
      };
      expect(toCompatAgentCardSignature(toCoreAgentCardSignature(compat))).toEqual(compat);
    });
  });

  describe('AgentCard', () => {
    function minimalCompatCard(): legacy.AgentCard {
      return {
        name: 'Agent',
        description: 'desc',
        version: '1.2.3',
        url: 'https://api.example/a2a',
        preferredTransport: 'JSONRPC',
        protocolVersion: '0.3',
        capabilities: { streaming: true },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [{ id: 's1', name: 'Skill', description: 'desc', tags: [] }],
      };
    }

    it('round-trips a minimal card', () => {
      const compat = minimalCompatCard();
      expect(toCompatAgentCard(toCoreAgentCard(compat))).toEqual(compat);
    });

    it('folds supportsAuthenticatedExtendedCard into capabilities.extendedAgentCard', () => {
      const compat: legacy.AgentCard = {
        ...minimalCompatCard(),
        supportsAuthenticatedExtendedCard: true,
      };
      const core = toCoreAgentCard(compat);
      expect(core.capabilities?.extendedAgentCard).toBe(true);
    });

    it('unfolds extendedAgentCard back to the card level going core → compat', () => {
      const core = toCoreAgentCard({
        ...minimalCompatCard(),
        supportsAuthenticatedExtendedCard: true,
      });
      const back = toCompatAgentCard(core);
      expect(back.supportsAuthenticatedExtendedCard).toBe(true);
    });

    it('puts additional interfaces in supportedInterfaces after the primary one', () => {
      const compat: legacy.AgentCard = {
        ...minimalCompatCard(),
        additionalInterfaces: [{ url: 'https://api.example/grpc', transport: 'GRPC' }],
      };
      const core = toCoreAgentCard(compat);
      expect(core.supportedInterfaces).toHaveLength(2);
      expect(core.supportedInterfaces[0]!.url).toBe('https://api.example/a2a');
      expect(core.supportedInterfaces[1]!.url).toBe('https://api.example/grpc');
    });

    it('filters out interfaces with non-legacy protocolVersion', () => {
      const core: V1AgentCard = {
        name: 'Agent',
        description: 'desc',
        version: '1.2.3',
        supportedInterfaces: [
          {
            url: 'https://api.example/v1',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
          {
            url: 'https://api.example/legacy',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '0.3',
          },
        ],
        provider: undefined,
        capabilities: {
          streaming: undefined,
          pushNotifications: undefined,
          extensions: [],
          extendedAgentCard: undefined,
        },
        securitySchemes: {},
        securityRequirements: [],
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
        signatures: [],
      };
      const compat = toCompatAgentCard(core);
      expect(compat.url).toBe('https://api.example/legacy');
      expect(compat.additionalInterfaces).toBeUndefined();
    });

    it('throws VersionNotSupportedError if no interface qualifies', () => {
      const core: V1AgentCard = {
        name: 'Agent',
        description: 'desc',
        version: '1.2.3',
        supportedInterfaces: [
          {
            url: 'https://api.example/v1',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
        provider: undefined,
        capabilities: {
          streaming: undefined,
          pushNotifications: undefined,
          extensions: [],
          extendedAgentCard: undefined,
        },
        securitySchemes: {},
        securityRequirements: [],
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
        signatures: [],
      };
      expect(() => toCompatAgentCard(core)).toThrow(VersionNotSupportedError);
    });

    it('keeps an interface with empty protocolVersion (treated as compatible)', () => {
      const core: V1AgentCard = {
        name: 'Agent',
        description: 'desc',
        version: '1.2.3',
        supportedInterfaces: [
          {
            url: 'https://api.example/legacy',
            protocolBinding: 'JSONRPC',
            tenant: '',
            protocolVersion: '',
          },
        ],
        provider: undefined,
        capabilities: {
          streaming: undefined,
          pushNotifications: undefined,
          extensions: [],
          extendedAgentCard: undefined,
        },
        securitySchemes: {},
        securityRequirements: [],
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
        signatures: [],
      };
      const compat = toCompatAgentCard(core);
      expect(compat.url).toBe('https://api.example/legacy');
      // Falls back to PROTOCOL_VERSION_0_3 for the card-level version.
      expect(compat.protocolVersion).toBe('0.3');
    });

    it('defaults preferredTransport to JSONRPC when omitted on compat side', () => {
      const compat: legacy.AgentCard = { ...minimalCompatCard() };
      delete (compat as Partial<legacy.AgentCard>).preferredTransport;
      const core = toCoreAgentCard(compat);
      expect(core.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
    });
  });
});
