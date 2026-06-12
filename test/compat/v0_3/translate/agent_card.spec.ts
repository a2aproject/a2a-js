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

    describe('synthesize option', () => {
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

      it('accepts a v1.0-only card without throwing', () => {
        const core = v1OnlyCore();
        expect(() => toCompatAgentCard(core, { synthesize: true })).not.toThrow();
      });

      it('emits protocolVersion 0.3 regardless of the source version', () => {
        const core = v1OnlyCore();
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect(compat.protocolVersion).toBe('0.3');
      });

      it('keeps the underlying v1.0 interface URL and binding', () => {
        const core = v1OnlyCore();
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect(compat.url).toBe('https://api.example/v1');
        expect(compat.preferredTransport).toBe('JSONRPC');
      });

      it('passes through additional v1.0 interfaces as additionalInterfaces', () => {
        const core = v1OnlyCore();
        core.supportedInterfaces.push({
          url: 'https://api.example/grpc',
          protocolBinding: 'GRPC',
          tenant: '',
          protocolVersion: '1.0',
        });
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect(compat.url).toBe('https://api.example/v1');
        expect(compat.additionalInterfaces).toHaveLength(1);
        expect(compat.additionalInterfaces?.[0]).toEqual({
          url: 'https://api.example/grpc',
          transport: 'GRPC',
        });
      });

      it('still throws when there are no interfaces at all', () => {
        const core = v1OnlyCore();
        core.supportedInterfaces = [];
        expect(() => toCompatAgentCard(core, { synthesize: true })).toThrow(
          VersionNotSupportedError
        );
      });

      it('does not crash when supportedInterfaces is undefined (defensive)', () => {
        const core = v1OnlyCore();
        // Cast through unknown to satisfy the non-nullable proto type
        // while modelling a real-world malformed input.
        (core as unknown as { supportedInterfaces?: unknown }).supportedInterfaces = undefined;
        expect(() => toCompatAgentCard(core, { synthesize: true })).toThrow(
          VersionNotSupportedError
        );
        expect(() => toCompatAgentCard(core)).toThrow(VersionNotSupportedError);
      });

      it('forces protocolVersion to 0.3 even when a v1.0 entry is the primary', () => {
        // Belt-and-braces: even if the source primary interface declares
        // a non-legacy version explicitly, the synthesized card must
        // present itself as v0.3 to legacy clients.
        const core = v1OnlyCore();
        const compat = toCompatAgentCard(core, { synthesize: true });
        // primary core interface is v1.0 but emitted version is v0.3.
        expect(core.supportedInterfaces[0]!.protocolVersion).toBe('1.0');
        expect(compat.protocolVersion).toBe('0.3');
      });

      it('default (no options) preserves strict filter and throws on v1.0-only', () => {
        const core = v1OnlyCore();
        expect(() => toCompatAgentCard(core)).toThrow(VersionNotSupportedError);
      });

      it('default (synthesize: false) preserves strict filter and throws on v1.0-only', () => {
        const core = v1OnlyCore();
        expect(() => toCompatAgentCard(core, { synthesize: false })).toThrow(
          VersionNotSupportedError
        );
      });

      it('synthesize: true still prefers a declared v0.3 interface when present (dual card)', () => {
        // Synthesis is a fallback for cards with NO legacy interface.
        // When a v0.3 entry is declared explicitly it MUST still be
        // picked as the primary, so dual-version deployments don't
        // observe a URL change after the synthesize option is added.
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
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect(compat.url).toBe('https://api.example/legacy');
        expect(compat.protocolVersion).toBe('0.3');
      });

      it('synthesize: true with mixed versions (no legacy entry) falls back to the first interface', () => {
        // No legacy-range entry -> the fallback kicks in and the
        // first non-legacy entry becomes the primary, with emitted
        // protocolVersion stamped as 0.3.
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
              url: 'https://api.example/v2',
              protocolBinding: 'JSONRPC',
              tenant: '',
              protocolVersion: '2.0',
            },
          ],
        };
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect(compat.url).toBe('https://api.example/v1');
        expect(compat.protocolVersion).toBe('0.3');
        expect(compat.additionalInterfaces).toHaveLength(1);
        expect(compat.additionalInterfaces?.[0]?.url).toBe('https://api.example/v2');
      });
    });

    describe('embedV1Interfaces option', () => {
      function v1OnlyCoreLocal(): V1AgentCard {
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

      it('omits supportedInterfaces by default (back-compat with pure v0.3 output)', () => {
        const core = v1OnlyCoreLocal();
        const compat = toCompatAgentCard(core, { synthesize: true });
        expect((compat as { supportedInterfaces?: unknown[] }).supportedInterfaces).toBeUndefined();
      });

      it('embeds the source supportedInterfaces verbatim when enabled', () => {
        const core = v1OnlyCoreLocal();
        const compat = toCompatAgentCard(core, {
          synthesize: true,
          embedV1Interfaces: true,
        });
        // The emitted hybrid card carries BOTH the v0.3 top-level
        // surface AND the original v1.0 supportedInterfaces array, so
        // both card resolvers can read it from the same JSON document.
        expect(compat.url).toBe('https://api.example/v1');
        expect(compat.preferredTransport).toBe('JSONRPC');
        expect(compat.protocolVersion).toBe('0.3');
        expect(compat.supportedInterfaces).toEqual(core.supportedInterfaces);
      });

      it('emits a defensive copy (does not alias the source array)', () => {
        // Mutating the emitted card MUST NOT mutate the input card the
        // caller passed in.
        const core = v1OnlyCoreLocal();
        const compat = toCompatAgentCard(core, {
          synthesize: true,
          embedV1Interfaces: true,
        });
        expect(compat.supportedInterfaces).not.toBe(core.supportedInterfaces);
        expect(compat.supportedInterfaces![0]).not.toBe(core.supportedInterfaces[0]);
        compat.supportedInterfaces![0]!.url = 'https://mutated';
        expect(core.supportedInterfaces[0]!.url).toBe('https://api.example/v1');
      });

      it('works without synthesize when at least one legacy interface qualifies', () => {
        // embedV1Interfaces is orthogonal to synthesize: it just copies
        // the source supportedInterfaces onto the emitted card.
        const core: V1AgentCard = {
          ...v1OnlyCoreLocal(),
          supportedInterfaces: [
            {
              url: 'https://api.example/legacy',
              protocolBinding: 'JSONRPC',
              tenant: '',
              protocolVersion: '0.3',
            },
            {
              url: 'https://api.example/v1',
              protocolBinding: 'JSONRPC',
              tenant: '',
              protocolVersion: '1.0',
            },
          ],
        };
        const compat = toCompatAgentCard(core, { embedV1Interfaces: true });
        // Strict filtering picked the v0.3 entry as primary; the
        // v1.0 entry survives only because embedV1Interfaces carries
        // the full source array through.
        expect(compat.url).toBe('https://api.example/legacy');
        expect(compat.supportedInterfaces).toEqual(core.supportedInterfaces);
      });

      it('omits supportedInterfaces when the source array is empty', () => {
        // Defensive guard: never emit an empty `supportedInterfaces`
        // field that would confuse downstream parsers expecting it to
        // either be absent or non-empty.
        const core: V1AgentCard = {
          ...v1OnlyCoreLocal(),
          supportedInterfaces: [
            {
              url: 'https://api.example/legacy',
              protocolBinding: 'JSONRPC',
              tenant: '',
              protocolVersion: '0.3',
            },
          ],
        };
        // Build a card with the property explicitly set to [] without
        // breaking the existing primary-interface lookup.
        const empty: V1AgentCard = { ...core, supportedInterfaces: [] };
        // Strict filter throws on empty supportedInterfaces (no
        // primary), but with embedV1Interfaces we should still not
        // crash before that point.
        expect(() =>
          toCompatAgentCard(empty, { synthesize: true, embedV1Interfaces: true })
        ).toThrow(VersionNotSupportedError);
      });
    });
  });
});
