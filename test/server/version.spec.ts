import { describe, it, expect } from 'vitest';
import { validateVersion, getSupportedVersions } from '../../src/server/version.js';
import { VersionNotSupportedError } from '../../src/errors.js';
import { AgentCard } from '../../src/index.js';
import { A2A_DEFAULT_VERSION } from '../../src/constants.js';
import { ServerCallContext } from '../../src/server/context.js';

function createAgentCard(
  interfaces: Array<{ protocolBinding: string; protocolVersion: string }> = []
): AgentCard {
  return {
    name: 'Test Agent',
    description: 'Test',
    version: '1.0.0',
    defaultInputModes: [],
    defaultOutputModes: [],
    skills: [],
    securityRequirements: [],
    signatures: [],
    provider: { url: '', organization: '' },
    securitySchemes: {},
    supportedInterfaces: interfaces.map((i) => ({
      url: 'https://example.com',
      protocolBinding: i.protocolBinding,
      protocolVersion: i.protocolVersion,
      tenant: '',
    })),
    capabilities: {
      extensions: [],
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
  };
}

describe('getSupportedVersions', () => {
  it('should always include the default version (0.3)', () => {
    const card = createAgentCard([]);
    const versions = getSupportedVersions(card);
    expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
  });

  it('should include versions from supported interfaces', () => {
    const card = createAgentCard([
      { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { protocolBinding: 'GRPC', protocolVersion: '1.0' },
    ]);
    const versions = getSupportedVersions(card);
    expect(versions.has('1.0')).toBe(true);
    expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
  });

  it('should deduplicate versions', () => {
    const card = createAgentCard([
      { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ]);
    const versions = getSupportedVersions(card);
    expect(versions.size).toBe(2);
  });

  it('should handle multiple different versions', () => {
    const card = createAgentCard([
      { protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
      { protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ]);
    const versions = getSupportedVersions(card);
    expect(versions.has('0.3')).toBe(true);
    expect(versions.has('1.0')).toBe(true);
  });
});

describe('validateVersion', () => {
  it('should not throw for a supported version', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('1.0', card)).not.toThrow();
  });

  it('should not throw for the default version (0.3)', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion(A2A_DEFAULT_VERSION, card)).not.toThrow();
  });

  it('should throw VersionNotSupportedError for an unsupported version', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('2.0', card)).toThrow(VersionNotSupportedError);
  });

  it('should include supported versions in error message', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('9.9', card)).toThrow(/Supported versions/);
  });

  it('should include the requested version in error message', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('9.9', card)).toThrow(/9\.9/);
  });
});

describe('protocolBinding filtering', () => {
  const multiBindingCard = createAgentCard([
    { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    { protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    { protocolBinding: 'GRPC', protocolVersion: '1.0' },
  ]);

  describe('getSupportedVersions with protocolBinding', () => {
    it('should return versions only for the matching binding', () => {
      const card = createAgentCard([
        { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
        { protocolBinding: 'HTTP+JSON', protocolVersion: '2.0' },
      ]);
      const versions = getSupportedVersions(card, 'HTTP+JSON');
      expect(versions.has('2.0')).toBe(true);
      expect(versions.has('1.0')).toBe(false);
      expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
    });

    it('should always include default version even when filtering', () => {
      const versions = getSupportedVersions(multiBindingCard, 'GRPC');
      expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
    });

    it('should return only default version when no binding matches', () => {
      const versions = getSupportedVersions(multiBindingCard, 'UNKNOWN' as any);
      expect(versions.size).toBe(1);
      expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
    });

    it('should return all versions when protocolBinding is undefined', () => {
      const card = createAgentCard([
        { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
        { protocolBinding: 'HTTP+JSON', protocolVersion: '2.0' },
      ]);
      const versions = getSupportedVersions(card);
      expect(versions.has('1.0')).toBe(true);
      expect(versions.has('2.0')).toBe(true);
      expect(versions.has(A2A_DEFAULT_VERSION)).toBe(true);
    });
  });

  describe('validateVersion with protocolBinding', () => {
    it('should accept a version supported by the specified binding', () => {
      expect(() => validateVersion('1.0', multiBindingCard, 'JSONRPC')).not.toThrow();
    });

    it('should reject a version not supported by the specified binding', () => {
      const card = createAgentCard([
        { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
        { protocolBinding: 'HTTP+JSON', protocolVersion: '2.0' },
      ]);
      expect(() => validateVersion('2.0', card, 'JSONRPC')).toThrow(VersionNotSupportedError);
    });

    it('should always accept the default version regardless of binding', () => {
      expect(() => validateVersion(A2A_DEFAULT_VERSION, multiBindingCard, 'GRPC')).not.toThrow();
    });

    it('should use exact match for protocolBinding comparison', () => {
      const card = createAgentCard([{ protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }]);
      // 'rest' does not match 'HTTP+JSON'
      expect(() => validateVersion('1.0', card, 'rest' as any)).toThrow(VersionNotSupportedError);
    });
  });
});

describe('ServerCallContext version', () => {
  it('should default requestedVersion to 0.3 when not provided', () => {
    const context = new ServerCallContext();
    expect(context.requestedVersion).toBe(A2A_DEFAULT_VERSION);
  });

  it('should default requestedVersion to 0.3 when empty string is provided', () => {
    const context = new ServerCallContext({ requestedVersion: '' });
    expect(context.requestedVersion).toBe(A2A_DEFAULT_VERSION);
  });

  it('should store the provided version', () => {
    const context = new ServerCallContext({ requestedVersion: '1.0' });
    expect(context.requestedVersion).toBe('1.0');
  });

  it('should default to 0.3 when version omitted', () => {
    const context = new ServerCallContext({});
    expect(context.requestedVersion).toBe(A2A_DEFAULT_VERSION);
  });
});
