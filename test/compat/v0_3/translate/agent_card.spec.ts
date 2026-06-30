import { describe, expect, it } from 'vitest';
import {
  duplicateInterfacesForLegacy,
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
import type {
  AgentCard as V1AgentCard,
  AgentInterface as V1AgentInterface,
} from '../../../../src/types/pb/a2a.js';
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

    describe('strict mode (default)', () => {
      function v1OnlyCore(): V1AgentCard {
        return {
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
      }

      it('throws on a v1.0-only card', () => {
        expect(() => toCompatAgentCard(v1OnlyCore())).toThrow(VersionNotSupportedError);
      });

      it('does not crash when supportedInterfaces is undefined', () => {
        const core = v1OnlyCore();
        (core as unknown as { supportedInterfaces?: unknown }).supportedInterfaces = undefined;
        expect(() => toCompatAgentCard(core)).toThrow(VersionNotSupportedError);
      });

      it('picks the declared v0.3 entry as primary in a dual-version card', () => {
        const core: V1AgentCard = {
          ...v1OnlyCore(),
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
        };
        const compat = toCompatAgentCard(core);
        expect(compat.url).toBe('https://api.example/legacy');
        expect(compat.protocolVersion).toBe('0.3');
      });
    });

    describe('embedV1Interfaces option', () => {
      function dualVersionCore(): V1AgentCard {
        return {
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
              url: 'https://api.example/v1',
              protocolBinding: 'JSONRPC',
              tenant: '',
              protocolVersion: '0.3',
            },
            {
              url: 'https://api.example/grpc',
              protocolBinding: 'GRPC',
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
      }

      it('omits supportedInterfaces by default', () => {
        const compat = toCompatAgentCard(dualVersionCore());
        expect((compat as { supportedInterfaces?: unknown[] }).supportedInterfaces).toBeUndefined();
      });

      it('embeds the source supportedInterfaces verbatim when enabled', () => {
        const core = dualVersionCore();
        const compat = toCompatAgentCard(core, { embedV1Interfaces: true });
        expect(compat.url).toBe('https://api.example/v1');
        expect(compat.preferredTransport).toBe('JSONRPC');
        expect(compat.protocolVersion).toBe('0.3');
        expect(compat.supportedInterfaces).toEqual(core.supportedInterfaces);
      });

      it('emits a defensive copy (does not alias the source array)', () => {
        const core = dualVersionCore();
        const compat = toCompatAgentCard(core, { embedV1Interfaces: true });
        expect(compat.supportedInterfaces).not.toBe(core.supportedInterfaces);
        expect(compat.supportedInterfaces![0]).not.toBe(core.supportedInterfaces[0]);
        compat.supportedInterfaces![0]!.url = 'https://mutated';
        expect(core.supportedInterfaces[0]!.url).toBe('https://api.example/v1');
      });

      it('throws on an empty supportedInterfaces array', () => {
        const empty: V1AgentCard = { ...dualVersionCore(), supportedInterfaces: [] };
        expect(() => toCompatAgentCard(empty, { embedV1Interfaces: true })).toThrow(
          VersionNotSupportedError
        );
      });
    });

    describe('duplicateInterfacesForLegacy helper', () => {
      const v1 = (binding: string, url = `/${binding.toLowerCase()}`) => ({
        url,
        protocolBinding: binding,
        tenant: '',
        protocolVersion: '1.0',
      });

      it('appends a v0.3 mirror for each listed binding', () => {
        const out = duplicateInterfacesForLegacy(
          [v1('JSONRPC'), v1('HTTP+JSON'), v1('GRPC')],
          ['JSONRPC', 'HTTP+JSON']
        );
        expect(out).toHaveLength(5);
        expect(out[3]).toEqual({ ...v1('JSONRPC'), protocolVersion: '0.3' });
        expect(out[4]).toEqual({ ...v1('HTTP+JSON'), protocolVersion: '0.3' });
      });

      it('is idempotent when a binding already has a v0.3 entry', () => {
        const input = [v1('JSONRPC'), { ...v1('JSONRPC'), protocolVersion: '0.3' }];
        const out = duplicateInterfacesForLegacy(input, ['JSONRPC']);
        expect(out).toHaveLength(2);
      });

      it('skips bindings not present in interfaces', () => {
        const out = duplicateInterfacesForLegacy([v1('JSONRPC')], ['GRPC']);
        expect(out).toEqual([v1('JSONRPC')]);
      });

      it('treats empty protocolVersion as legacy-compatible (no mirror added)', () => {
        const input = [{ ...v1('JSONRPC'), protocolVersion: '' }];
        const out = duplicateInterfacesForLegacy(input, ['JSONRPC']);
        expect(out).toEqual(input);
      });

      it('returns a deep copy so caller mutations do not bleed into the source', () => {
        const input = [v1('JSONRPC')];
        const out = duplicateInterfacesForLegacy(input, ['JSONRPC']);
        expect(out[0]).not.toBe(input[0]);
        out[0]!.url = 'https://mutated';
        expect(input[0]!.url).toBe('/jsonrpc');
      });

      it('tolerates a nullish interfaces input', () => {
        const out = duplicateInterfacesForLegacy(undefined as unknown as V1AgentInterface[], [
          'JSONRPC',
        ]);
        expect(out).toEqual([]);
      });
    });
  });
});
