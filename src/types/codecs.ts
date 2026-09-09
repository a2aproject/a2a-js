import * as pb from './pb/a2a.js';
import type { MessageFns } from './pb/a2a.js';

export * from './pb/a2a.js';

export type SecurityScheme = pb.SecurityScheme;
export type OAuthFlows = pb.OAuthFlows;
export type OAuth2SecurityScheme = pb.OAuth2SecurityScheme;
export type AgentCard = pb.AgentCard;
export type Task = pb.Task;
export type Message = pb.Message;
export type Part = pb.Part;
export type Artifact = pb.Artifact;
export type SendMessageResponse = pb.SendMessageResponse;

export const Task = pb.Task;
export const Message = pb.Message;
export const Part = pb.Part;
export const Artifact = pb.Artifact;
export const SendMessageResponse = pb.SendMessageResponse;

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export const OAuthFlows: MessageFns<pb.OAuthFlows> = {
  ...pb.OAuthFlows,
  fromJSON(object: unknown): pb.OAuthFlows {
    if (object != null && typeof object === 'object') {
      const rec = object as Record<string, unknown>;
      if (isSet(rec.flow) && typeof rec.flow === 'object' && '$case' in (rec.flow as object)) {
        const flowObj = rec.flow as { $case: string; value: unknown };
        const caseName = flowObj.$case;
        const val = flowObj.value;
        if (caseName === 'authorizationCode') {
          return {
            flow: {
              $case: 'authorizationCode',
              value: pb.AuthorizationCodeOAuthFlow.fromJSON(val),
            },
          };
        }
        if (caseName === 'clientCredentials') {
          return {
            flow: {
              $case: 'clientCredentials',
              value: pb.ClientCredentialsOAuthFlow.fromJSON(val),
            },
          };
        }
        if (caseName === 'implicit') {
          return {
            flow: { $case: 'implicit', value: pb.ImplicitOAuthFlow.fromJSON(val) },
          };
        }
        if (caseName === 'password') {
          return {
            flow: { $case: 'password', value: pb.PasswordOAuthFlow.fromJSON(val) },
          };
        }
        if (caseName === 'deviceCode') {
          return {
            flow: { $case: 'deviceCode', value: pb.DeviceCodeOAuthFlow.fromJSON(val) },
          };
        }
      }
    }
    return pb.OAuthFlows.fromJSON(object);
  },
};

export const OAuth2SecurityScheme: MessageFns<pb.OAuth2SecurityScheme> = {
  ...pb.OAuth2SecurityScheme,
  fromJSON(object: unknown): pb.OAuth2SecurityScheme {
    const scheme = pb.OAuth2SecurityScheme.fromJSON(object);
    if (object != null && typeof object === 'object') {
      const rec = object as Record<string, unknown>;
      if (rec.flows != null) {
        scheme.flows = OAuthFlows.fromJSON(rec.flows);
      }
    }
    return scheme;
  },
};

export const SecurityScheme: MessageFns<pb.SecurityScheme> = {
  ...pb.SecurityScheme,
  fromJSON(object: unknown): pb.SecurityScheme {
    if (object != null && typeof object === 'object') {
      const rec = object as Record<string, unknown>;
      if (
        isSet(rec.scheme) &&
        typeof rec.scheme === 'object' &&
        '$case' in (rec.scheme as object)
      ) {
        const schemeObj = rec.scheme as { $case: string; value: unknown };
        const caseName = schemeObj.$case;
        const val = schemeObj.value;
        if (caseName === 'apiKeySecurityScheme') {
          return {
            scheme: {
              $case: 'apiKeySecurityScheme',
              value: pb.APIKeySecurityScheme.fromJSON(val),
            },
          };
        }
        if (caseName === 'httpAuthSecurityScheme') {
          return {
            scheme: {
              $case: 'httpAuthSecurityScheme',
              value: pb.HTTPAuthSecurityScheme.fromJSON(val),
            },
          };
        }
        if (caseName === 'oauth2SecurityScheme') {
          return {
            scheme: {
              $case: 'oauth2SecurityScheme',
              value: OAuth2SecurityScheme.fromJSON(val),
            },
          };
        }
        if (caseName === 'openIdConnectSecurityScheme') {
          return {
            scheme: {
              $case: 'openIdConnectSecurityScheme',
              value: pb.OpenIdConnectSecurityScheme.fromJSON(val),
            },
          };
        }
        if (caseName === 'mtlsSecurityScheme') {
          return {
            scheme: {
              $case: 'mtlsSecurityScheme',
              value: pb.MutualTlsSecurityScheme.fromJSON(val),
            },
          };
        }
      }
    }
    return pb.SecurityScheme.fromJSON(object);
  },
};

export const AgentCard: MessageFns<pb.AgentCard> = {
  ...pb.AgentCard,
  fromJSON(object: unknown): pb.AgentCard {
    const card = pb.AgentCard.fromJSON(object);
    if (object != null && typeof object === 'object') {
      const rec = object as Record<string, unknown>;
      const rawSchemes = rec.securitySchemes ?? rec.security_schemes;
      if (rawSchemes != null && typeof rawSchemes === 'object') {
        card.securitySchemes = Object.entries(rawSchemes as Record<string, unknown>).reduce<{
          [key: string]: pb.SecurityScheme;
        }>((acc, [key, value]) => {
          acc[key] = SecurityScheme.fromJSON(value);
          return acc;
        }, {});
      }
    }
    return card;
  },
};
