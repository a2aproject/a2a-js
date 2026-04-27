import { describe, it, expect } from 'vitest';
import { validateVersion, getSupportedVersions } from '../../src/server/version.js';
import { VersionNotSupportedError } from '../../src/errors.js';
import { AgentCard } from '../../src/index.js';
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
  it('should return an empty set for an agent card with no interfaces', () => {
    const card = createAgentCard([]);
    const versions = getSupportedVersions(card);
    expect(versions.size).toBe(0);
  });

  it('should return only versions declared in supported interfaces', () => {
    const card = createAgentCard([
      { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { protocolBinding: 'GRPC', protocolVersion: '1.0' },
    ]);
    const versions = getSupportedVersions(card);
    expect(versions.has('1.0')).toBe(true);
    expect(versions.size).toBe(1);
  });

  it('should deduplicate versions', () => {
    const card = createAgentCard([
      { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ]);
    const versions = getSupportedVersions(card);
    expect(versions.size).toBe(1);
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

  it('should not implicitly include 0.3 unless declared', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    const versions = getSupportedVersions(card);
    expect(versions.has('0.3')).toBe(false);
  });
});

describe('validateVersion', () => {
  it('should not throw for a supported version', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('1.0', card)).not.toThrow();
  });

  it('should throw for 0.3 when the agent does not declare it', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
    expect(() => validateVersion('0.3', card)).toThrow(VersionNotSupportedError);
  });

  it('should not throw for 0.3 when the agent explicitly declares it', () => {
    const card = createAgentCard([{ protocolBinding: 'JSONRPC', protocolVersion: '0.3' }]);
    expect(() => validateVersion('0.3', card)).not.toThrow();
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
    });

    it('should return an empty set when no binding matches', () => {
      const versions = getSupportedVersions(multiBindingCard, 'UNKNOWN' as any);
      expect(versions.size).toBe(0);
    });

    it('should return all versions when protocolBinding is undefined', () => {
      const card = createAgentCard([
        { protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
        { protocolBinding: 'HTTP+JSON', protocolVersion: '2.0' },
      ]);
      const versions = getSupportedVersions(card);
      expect(versions.has('1.0')).toBe(true);
      expect(versions.has('2.0')).toBe(true);
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

    it('should reject 0.3 when the binding does not declare it', () => {
      expect(() => validateVersion('0.3', multiBindingCard, 'GRPC')).toThrow(
        VersionNotSupportedError
      );
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
    expect(context.requestedVersion).toBe('0.3');
  });

  it('should default requestedVersion to 0.3 when empty string is provided', () => {
    const context = new ServerCallContext({ requestedVersion: '' });
    expect(context.requestedVersion).toBe('0.3');
  });

  it('should store the provided version', () => {
    const context = new ServerCallContext({ requestedVersion: '1.0' });
    expect(context.requestedVersion).toBe('1.0');
  });

  it('should default to 0.3 when version omitted', () => {
    const context = new ServerCallContext({});
    expect(context.requestedVersion).toBe('0.3');
  });
});
