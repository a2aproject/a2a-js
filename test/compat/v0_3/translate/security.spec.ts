import { describe, expect, it } from 'vitest';
import {
  toCompatOAuthFlows,
  toCompatSecurityRequirement,
  toCompatSecurityScheme,
  toCoreOAuthFlows,
  toCoreSecurityRequirement,
  toCoreSecurityScheme,
} from '../../../../src/compat/v0_3/translate/security.js';
import { A2AError } from '../../../../src/compat/v0_3/server/error.js';
import type {
  OAuthFlows as V1OAuthFlows,
  SecurityScheme as V1SecurityScheme,
} from '../../../../src/types/pb/a2a.js';
import type * as legacy from '../../../../src/compat/v0_3/types/types.js';

describe('security', () => {
  describe('SecurityRequirement', () => {
    it('wraps and unwraps StringList', () => {
      const compat = { oauth2: ['read', 'write'] };
      const core = toCoreSecurityRequirement(compat);
      expect(core).toEqual({ schemes: { oauth2: { list: ['read', 'write'] } } });
      expect(toCompatSecurityRequirement(core)).toEqual(compat);
    });
  });

  describe('SecurityScheme', () => {
    it('round-trips an apiKey scheme', () => {
      const compat: legacy.SecurityScheme = {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'my key',
      };
      expect(toCompatSecurityScheme(toCoreSecurityScheme(compat))).toEqual(compat);
    });

    it('round-trips an http bearer scheme', () => {
      const compat: legacy.SecurityScheme = {
        type: 'http',
        scheme: 'Bearer',
        bearerFormat: 'JWT',
        description: 'http auth',
      };
      expect(toCompatSecurityScheme(toCoreSecurityScheme(compat))).toEqual(compat);
    });

    it('round-trips an mutualTLS scheme', () => {
      const compat: legacy.SecurityScheme = { type: 'mutualTLS', description: 'mtls' };
      expect(toCompatSecurityScheme(toCoreSecurityScheme(compat))).toEqual(compat);
    });

    it('round-trips an openIdConnect scheme', () => {
      const compat: legacy.SecurityScheme = {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://oidc.example/.well-known/openid-configuration',
      };
      expect(toCompatSecurityScheme(toCoreSecurityScheme(compat))).toEqual(compat);
    });

    it('round-trips an oauth2 scheme with one flow', () => {
      const compat: legacy.SecurityScheme = {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://auth.example/token',
            scopes: { read: 'Read access' },
          },
        },
      };
      expect(toCompatSecurityScheme(toCoreSecurityScheme(compat))).toEqual(compat);
    });

    it('throws when v1.0 OAuth2 scheme has no flows', () => {
      const core: V1SecurityScheme = {
        scheme: {
          $case: 'oauth2SecurityScheme',
          value: { description: '', flows: undefined, oauth2MetadataUrl: '' },
        },
      };
      expect(() => toCompatSecurityScheme(core)).toThrow(A2AError);
    });

    it('throws when v1.0 SecurityScheme has no inner scheme', () => {
      const core: V1SecurityScheme = { scheme: undefined };
      expect(() => toCompatSecurityScheme(core)).toThrow(A2AError);
    });

    it('throws for unsupported compat scheme type', () => {
      const compat = { type: 'magic' } as unknown as legacy.SecurityScheme;
      expect(() => toCoreSecurityScheme(compat)).toThrow(A2AError);
    });

    describe('APIKey location handling (v1 → v0.3)', () => {
      it.each(['cookie', 'header', 'query'] as const)(
        'preserves valid APIKey location: %s',
        (loc) => {
          const core: V1SecurityScheme = {
            scheme: {
              $case: 'apiKeySecurityScheme',
              value: { description: '', location: loc, name: 'X-API-Key' },
            },
          };
          const compat = toCompatSecurityScheme(core) as legacy.APIKeySecurityScheme;
          expect(compat.in).toBe(loc);
        }
      );

      it('coerces an unknown APIKey location to "header"', () => {
        const core: V1SecurityScheme = {
          scheme: {
            $case: 'apiKeySecurityScheme',
            value: { description: '', location: 'headerz', name: 'X-API-Key' },
          },
        };
        const compat = toCompatSecurityScheme(core) as legacy.APIKeySecurityScheme;
        expect(compat.in).toBe('header');
      });

      it('coerces an empty APIKey location to "header"', () => {
        const core: V1SecurityScheme = {
          scheme: {
            $case: 'apiKeySecurityScheme',
            value: { description: '', location: '', name: 'X-API-Key' },
          },
        };
        const compat = toCompatSecurityScheme(core) as legacy.APIKeySecurityScheme;
        expect(compat.in).toBe('header');
      });
    });
  });

  describe('OAuthFlows', () => {
    it('round-trips authorizationCode', () => {
      const compat: legacy.OAuthFlows = {
        authorizationCode: {
          authorizationUrl: 'https://auth.example/auth',
          tokenUrl: 'https://auth.example/token',
          scopes: { 'read:tasks': 'Read tasks' },
          refreshUrl: 'https://auth.example/refresh',
        },
      };
      expect(toCompatOAuthFlows(toCoreOAuthFlows(compat))).toEqual(compat);
    });

    it('round-trips clientCredentials', () => {
      const compat: legacy.OAuthFlows = {
        clientCredentials: {
          tokenUrl: 'https://auth.example/token',
          scopes: { admin: 'Admin' },
        },
      };
      expect(toCompatOAuthFlows(toCoreOAuthFlows(compat))).toEqual(compat);
    });

    it('round-trips implicit', () => {
      const compat: legacy.OAuthFlows = {
        implicit: {
          authorizationUrl: 'https://auth.example/auth',
          scopes: { foo: 'bar' },
        },
      };
      expect(toCompatOAuthFlows(toCoreOAuthFlows(compat))).toEqual(compat);
    });

    it('round-trips password', () => {
      const compat: legacy.OAuthFlows = {
        password: {
          tokenUrl: 'https://auth.example/token',
          scopes: { foo: 'bar' },
        },
      };
      expect(toCompatOAuthFlows(toCoreOAuthFlows(compat))).toEqual(compat);
    });

    it('silently drops deviceCode going to compat', () => {
      const core: V1OAuthFlows = {
        flow: {
          $case: 'deviceCode',
          value: {
            deviceAuthorizationUrl: 'https://auth.example/device',
            tokenUrl: 'https://auth.example/token',
            refreshUrl: '',
            scopes: {},
          },
        },
      };
      expect(toCompatOAuthFlows(core)).toEqual({});
    });

    it('throws when compat flows are empty going to core', () => {
      expect(() => toCoreOAuthFlows({})).toThrow(A2AError);
    });
  });
});
