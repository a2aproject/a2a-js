import { describe, it, expect } from 'vitest';
import { SecurityScheme, OAuthFlows, AgentCard } from '../../src/index.js';

describe('SecurityScheme & OAuthFlows codecs (issue #663)', () => {
  describe('SecurityScheme.fromJSON and toJSON', () => {
    it('should parse external ProtoJSON apiKeySecurityScheme and convert to JSON', () => {
      const protoJson = {
        apiKeySecurityScheme: {
          name: 'X-API-KEY',
          location: 'header',
          description: 'API key authentication',
        },
      };

      const parsed = SecurityScheme.fromJSON(protoJson);
      expect(parsed.scheme).toEqual({
        $case: 'apiKeySecurityScheme',
        value: {
          name: 'X-API-KEY',
          location: 'header',
          description: 'API key authentication',
        },
      });

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual(protoJson);
    });

    it('should parse internal {$case, value} apiKeySecurityScheme idempotently', () => {
      const instance = {
        scheme: {
          $case: 'apiKeySecurityScheme' as const,
          value: {
            name: 'X-API-KEY',
            location: 'header',
            description: 'API key authentication',
          },
        },
      };

      const parsed = SecurityScheme.fromJSON(instance);
      expect(parsed.scheme).toEqual(instance.scheme);

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual({
        apiKeySecurityScheme: {
          name: 'X-API-KEY',
          location: 'header',
          description: 'API key authentication',
        },
      });
    });

    it('should parse external ProtoJSON openIdConnectSecurityScheme and convert to JSON', () => {
      const protoJson = {
        openIdConnectSecurityScheme: {
          openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
          description: 'OIDC auth',
        },
      };

      const parsed = SecurityScheme.fromJSON(protoJson);
      expect(parsed.scheme).toEqual({
        $case: 'openIdConnectSecurityScheme',
        value: {
          openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
          description: 'OIDC auth',
        },
      });

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual(protoJson);
    });

    it('should parse internal {$case, value} openIdConnectSecurityScheme idempotently', () => {
      const instance = {
        scheme: {
          $case: 'openIdConnectSecurityScheme' as const,
          value: {
            openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
            description: 'OIDC auth',
          },
        },
      };

      const parsed = SecurityScheme.fromJSON(instance);
      expect(parsed.scheme).toEqual(instance.scheme);

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual({
        openIdConnectSecurityScheme: {
          openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
          description: 'OIDC auth',
        },
      });
    });

    it('should parse external ProtoJSON httpAuthSecurityScheme and convert to JSON', () => {
      const protoJson = {
        httpAuthSecurityScheme: {
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Bearer token',
        },
      };

      const parsed = SecurityScheme.fromJSON(protoJson);
      expect(parsed.scheme).toEqual({
        $case: 'httpAuthSecurityScheme',
        value: {
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Bearer token',
        },
      });

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual(protoJson);
    });

    it('should parse internal {$case, value} httpAuthSecurityScheme idempotently', () => {
      const instance = {
        scheme: {
          $case: 'httpAuthSecurityScheme' as const,
          value: {
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Bearer token',
          },
        },
      };

      const parsed = SecurityScheme.fromJSON(instance);
      expect(parsed.scheme).toEqual(instance.scheme);
    });

    it('should parse external ProtoJSON mtlsSecurityScheme and convert to JSON', () => {
      const protoJson = {
        mtlsSecurityScheme: {
          description: 'mTLS auth',
        },
      };

      const parsed = SecurityScheme.fromJSON(protoJson);
      expect(parsed.scheme).toEqual({
        $case: 'mtlsSecurityScheme',
        value: {
          description: 'mTLS auth',
        },
      });

      const json = SecurityScheme.toJSON(parsed);
      expect(json).toEqual(protoJson);
    });

    it('should parse internal {$case, value} mtlsSecurityScheme idempotently', () => {
      const instance = {
        scheme: {
          $case: 'mtlsSecurityScheme' as const,
          value: {
            description: 'mTLS auth',
          },
        },
      };

      const parsed = SecurityScheme.fromJSON(instance);
      expect(parsed.scheme).toEqual(instance.scheme);
    });
  });

  describe('OAuthFlows.fromJSON and toJSON', () => {
    it('should parse external ProtoJSON authorizationCode flow and convert to JSON', () => {
      const protoJson = {
        authorizationCode: {
          authorizationUrl: 'https://auth.example.com/oauth/authorize',
          tokenUrl: 'https://auth.example.com/oauth/token',
          refreshUrl: 'https://auth.example.com/oauth/refresh',
          scopes: { 'read:all': 'Read all' },
          pkceRequired: true,
        },
      };

      const parsed = OAuthFlows.fromJSON(protoJson);
      expect(parsed.flow).toEqual({
        $case: 'authorizationCode',
        value: {
          authorizationUrl: 'https://auth.example.com/oauth/authorize',
          tokenUrl: 'https://auth.example.com/oauth/token',
          refreshUrl: 'https://auth.example.com/oauth/refresh',
          scopes: { 'read:all': 'Read all' },
          pkceRequired: true,
        },
      });

      const json = OAuthFlows.toJSON(parsed);
      expect(json).toEqual(protoJson);
    });

    it('should parse internal {$case, value} authorizationCode flow idempotently', () => {
      const instance = {
        flow: {
          $case: 'authorizationCode' as const,
          value: {
            authorizationUrl: 'https://auth.example.com/oauth/authorize',
            tokenUrl: 'https://auth.example.com/oauth/token',
            refreshUrl: 'https://auth.example.com/oauth/refresh',
            scopes: { 'read:all': 'Read all' },
            pkceRequired: true,
          },
        },
      };

      const parsed = OAuthFlows.fromJSON(instance);
      expect(parsed.flow).toEqual(instance.flow);
    });

    it('should parse internal {$case, value} clientCredentials flow idempotently', () => {
      const instance = {
        flow: {
          $case: 'clientCredentials' as const,
          value: {
            tokenUrl: 'https://auth.example.com/oauth/token',
            refreshUrl: '',
            scopes: { read: 'read' },
          },
        },
      };

      const parsed = OAuthFlows.fromJSON(instance);
      expect(parsed.flow).toEqual(instance.flow);
    });
  });

  describe('AgentCard round-trip with securitySchemes', () => {
    it('preserves securitySchemes when calling AgentCard.fromJSON on an AgentCard instance', () => {
      const plain = {
        name: 'test-agent',
        description: 'Testing',
        version: '1.0.0',
        supportedInterfaces: [] as any[],
        defaultInputModes: [] as string[],
        defaultOutputModes: [] as string[],
        skills: [] as any[],
        signatures: [] as any[],
        securityRequirements: [] as any[],
        securitySchemes: {
          oidc: {
            openIdConnectSecurityScheme: {
              openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
            },
          },
          apiKey: {
            apiKeySecurityScheme: {
              name: 'X-Key',
              location: 'header',
            },
          },
        },
      };

      // 1. Plain -> instance
      const instance1 = AgentCard.fromJSON(plain);
      expect(instance1.securitySchemes.oidc?.scheme?.$case).toBe('openIdConnectSecurityScheme');
      expect(instance1.securitySchemes.apiKey?.scheme?.$case).toBe('apiKeySecurityScheme');

      // 2. Instance -> re-parse via AgentCard.fromJSON (idempotency)
      const instance2 = AgentCard.fromJSON(instance1);
      expect(instance2.securitySchemes.oidc?.scheme?.$case).toBe('openIdConnectSecurityScheme');
      expect(instance2.securitySchemes.apiKey?.scheme?.$case).toBe('apiKeySecurityScheme');

      // 3. Serialize to ProtoJSON
      const protoJson = AgentCard.toJSON(instance2) as any;
      expect(protoJson.securitySchemes.oidc.openIdConnectSecurityScheme.openIdConnectUrl).toBe(
        'https://auth.example.com/.well-known/openid-configuration'
      );
      expect(protoJson.securitySchemes.apiKey.apiKeySecurityScheme.name).toBe('X-Key');
    });
  });
});
