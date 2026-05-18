/**
 * Security-related translators between v1.0 proto and v0.3 JSON:
 * `SecurityRequirement`, `SecurityScheme`, and `OAuthFlows`.
 *
 * Key shape differences handled here:
 *
 *  - **SecurityRequirement.** v1.0 wraps scope lists in a `StringList`
 *    proto message (`{ schemes: { [k]: { list: string[] } } }`); v0.3
 *    JSON stores plain `{ [k]: string[] }`.
 *  - **SecurityScheme discriminator.** v1.0 uses
 *    `scheme.$case: 'apiKeySecurityScheme' | ...`; v0.3 JSON uses a flat
 *    `type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS'`
 *    string.
 *  - **OAuthFlows.** v1.0 expresses the four classic flows plus
 *    `deviceCode` via a `flow.$case` oneof; v0.3 JSON keeps each flow as
 *    an optional sibling field. **`deviceCode` is silently dropped going
 *    v1.0 → v0.3** (v0.3 has no equivalent).
 */

import { A2AError } from '../server/error.js';
import type {
  APIKeySecurityScheme as V1APIKeySecurityScheme,
  AuthorizationCodeOAuthFlow as V1AuthorizationCodeOAuthFlow,
  ClientCredentialsOAuthFlow as V1ClientCredentialsOAuthFlow,
  HTTPAuthSecurityScheme as V1HTTPAuthSecurityScheme,
  ImplicitOAuthFlow as V1ImplicitOAuthFlow,
  MutualTlsSecurityScheme as V1MutualTlsSecurityScheme,
  OAuth2SecurityScheme as V1OAuth2SecurityScheme,
  OAuthFlows as V1OAuthFlows,
  OpenIdConnectSecurityScheme as V1OpenIdConnectSecurityScheme,
  PasswordOAuthFlow as V1PasswordOAuthFlow,
  SecurityRequirement as V1SecurityRequirement,
  SecurityScheme as V1SecurityScheme,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Converts a v0.3 JSON security-requirement entry (`{ [k]: string[] }`)
 * into a v1.0 proto `SecurityRequirement` (with `StringList` wrappers).
 */
export function toCoreSecurityRequirement(compat: {
  [k: string]: string[];
}): V1SecurityRequirement {
  return {
    schemes: Object.fromEntries(
      Object.entries(compat).map(([scheme, scopes]) => [scheme, { list: [...scopes] }])
    ),
  };
}

/**
 * Converts a v1.0 proto `SecurityRequirement` into the v0.3 JSON
 * `{ [k]: string[] }` shape by unwrapping the `StringList` records.
 */
export function toCompatSecurityRequirement(core: V1SecurityRequirement): {
  [k: string]: string[];
} {
  return Object.fromEntries(
    Object.entries(core.schemes).map(([scheme, stringList]) => [scheme, [...stringList.list]])
  );
}

function buildV1ApiKeyScheme(scheme: legacy.APIKeySecurityScheme): V1APIKeySecurityScheme {
  return {
    description: scheme.description ?? '',
    location: scheme.in,
    name: scheme.name,
  };
}

function buildV1HttpScheme(scheme: legacy.HTTPAuthSecurityScheme): V1HTTPAuthSecurityScheme {
  return {
    description: scheme.description ?? '',
    scheme: scheme.scheme,
    bearerFormat: scheme.bearerFormat ?? '',
  };
}

function buildV1MtlsScheme(scheme: legacy.MutualTLSSecurityScheme): V1MutualTlsSecurityScheme {
  return { description: scheme.description ?? '' };
}

function buildV1Oauth2Scheme(scheme: legacy.OAuth2SecurityScheme): V1OAuth2SecurityScheme {
  return {
    description: scheme.description ?? '',
    flows: toCoreOAuthFlows(scheme.flows),
    oauth2MetadataUrl: scheme.oauth2MetadataUrl ?? '',
  };
}

function buildV1OidcScheme(
  scheme: legacy.OpenIdConnectSecurityScheme
): V1OpenIdConnectSecurityScheme {
  return {
    description: scheme.description ?? '',
    openIdConnectUrl: scheme.openIdConnectUrl,
  };
}

/**
 * Converts a v0.3 JSON `SecurityScheme` (a `type`-tagged union) into a
 * v1.0 proto `SecurityScheme` (a `$case`-tagged oneof).
 */
export function toCoreSecurityScheme(compat: legacy.SecurityScheme): V1SecurityScheme {
  switch (compat.type) {
    case 'apiKey':
      return {
        scheme: { $case: 'apiKeySecurityScheme', value: buildV1ApiKeyScheme(compat) },
      };
    case 'http':
      return {
        scheme: { $case: 'httpAuthSecurityScheme', value: buildV1HttpScheme(compat) },
      };
    case 'oauth2':
      return {
        scheme: { $case: 'oauth2SecurityScheme', value: buildV1Oauth2Scheme(compat) },
      };
    case 'openIdConnect':
      return {
        scheme: { $case: 'openIdConnectSecurityScheme', value: buildV1OidcScheme(compat) },
      };
    case 'mutualTLS':
      return {
        scheme: { $case: 'mtlsSecurityScheme', value: buildV1MtlsScheme(compat) },
      };
    default:
      throw A2AError.invalidParams(
        `Unsupported v0.3 security scheme type: ${String((compat as { type?: string }).type)}`
      );
  }
}

function buildCompatApiKey(core: V1APIKeySecurityScheme): legacy.APIKeySecurityScheme {
  const result: legacy.APIKeySecurityScheme = {
    type: 'apiKey',
    name: core.name,
    // v1 proto widens `location` to a free-form `string`; v0.3 narrows it to a
    // literal union. Unknown / empty values silently map to `'header'` (the most
    // common API-key location and the effective OpenAPI default) so a
    // misconfigured v1 server doesn't break the entire v0.3 translation path.
    in: core.location === 'cookie' || core.location === 'query' ? core.location : 'header',
  };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  return result;
}

function buildCompatHttp(core: V1HTTPAuthSecurityScheme): legacy.HTTPAuthSecurityScheme {
  const result: legacy.HTTPAuthSecurityScheme = { type: 'http', scheme: core.scheme };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  const bearerFormat = nonEmpty(core.bearerFormat);
  if (bearerFormat !== undefined) result.bearerFormat = bearerFormat;
  return result;
}

function buildCompatMtls(core: V1MutualTlsSecurityScheme): legacy.MutualTLSSecurityScheme {
  const result: legacy.MutualTLSSecurityScheme = { type: 'mutualTLS' };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  return result;
}

function buildCompatOauth2(core: V1OAuth2SecurityScheme): legacy.OAuth2SecurityScheme {
  if (!core.flows) {
    throw A2AError.invalidParams('OAuth2 security scheme missing flows');
  }
  const result: legacy.OAuth2SecurityScheme = {
    type: 'oauth2',
    flows: toCompatOAuthFlows(core.flows),
  };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  const meta = nonEmpty(core.oauth2MetadataUrl);
  if (meta !== undefined) result.oauth2MetadataUrl = meta;
  return result;
}

function buildCompatOidc(core: V1OpenIdConnectSecurityScheme): legacy.OpenIdConnectSecurityScheme {
  const result: legacy.OpenIdConnectSecurityScheme = {
    type: 'openIdConnect',
    openIdConnectUrl: core.openIdConnectUrl,
  };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  return result;
}

/**
 * Converts a v1.0 proto `SecurityScheme` into a v0.3 JSON `SecurityScheme`.
 */
export function toCompatSecurityScheme(core: V1SecurityScheme): legacy.SecurityScheme {
  const scheme = core.scheme;
  if (!scheme) {
    throw A2AError.invalidParams('Invalid v1.0 SecurityScheme: missing inner scheme');
  }
  switch (scheme.$case) {
    case 'apiKeySecurityScheme':
      return buildCompatApiKey(scheme.value);
    case 'httpAuthSecurityScheme':
      return buildCompatHttp(scheme.value);
    case 'mtlsSecurityScheme':
      return buildCompatMtls(scheme.value);
    case 'oauth2SecurityScheme':
      return buildCompatOauth2(scheme.value);
    case 'openIdConnectSecurityScheme':
      return buildCompatOidc(scheme.value);
    default:
      throw A2AError.invalidParams(
        `Unsupported v1.0 SecurityScheme $case: ${(scheme as { $case?: string }).$case ?? 'unknown'}`
      );
  }
}

/**
 * Converts a v0.3 JSON `OAuthFlows` (a record of optional flows) into a
 * v1.0 proto `OAuthFlows` (a `flow.$case` oneof).
 *
 * The v0.3 schema permits at most one flow to be set in practice, but
 * the JSON shape allows any combination. We pick in a deterministic order
 * (authorization code → client credentials → implicit → password) and
 * throw if none are present (the proto oneof leaves no representation for
 * "all flows empty").
 */
export function toCoreOAuthFlows(compat: legacy.OAuthFlows): V1OAuthFlows {
  if (compat.authorizationCode) {
    const authCode = compat.authorizationCode;
    const value: V1AuthorizationCodeOAuthFlow = {
      authorizationUrl: authCode.authorizationUrl,
      tokenUrl: authCode.tokenUrl,
      refreshUrl: authCode.refreshUrl ?? '',
      scopes: { ...authCode.scopes },
      pkceRequired: false,
    };
    return { flow: { $case: 'authorizationCode', value } };
  }
  if (compat.clientCredentials) {
    const clientCreds = compat.clientCredentials;
    const value: V1ClientCredentialsOAuthFlow = {
      tokenUrl: clientCreds.tokenUrl,
      refreshUrl: clientCreds.refreshUrl ?? '',
      scopes: { ...clientCreds.scopes },
    };
    return { flow: { $case: 'clientCredentials', value } };
  }
  if (compat.implicit) {
    const value: V1ImplicitOAuthFlow = {
      authorizationUrl: compat.implicit.authorizationUrl,
      refreshUrl: compat.implicit.refreshUrl ?? '',
      scopes: { ...compat.implicit.scopes },
    };
    return { flow: { $case: 'implicit', value } };
  }
  if (compat.password) {
    const value: V1PasswordOAuthFlow = {
      tokenUrl: compat.password.tokenUrl,
      refreshUrl: compat.password.refreshUrl ?? '',
      scopes: { ...compat.password.scopes },
    };
    return { flow: { $case: 'password', value } };
  }
  throw A2AError.invalidParams('OAuthFlows must declare at least one flow');
}

/**
 * Converts a v1.0 proto `OAuthFlows` into a v0.3 JSON `OAuthFlows`.
 *
 * v1.0's `deviceCode` flow has no v0.3 equivalent and is **silently
 * dropped**. When `deviceCode` is the only declared flow the result is an
 * empty `{}` object — callers that need to reject this can guard via
 * `Object.keys(result).length === 0`.
 */
export function toCompatOAuthFlows(core: V1OAuthFlows): legacy.OAuthFlows {
  const result: legacy.OAuthFlows = {};
  const flow = core.flow;
  if (!flow) return result;

  switch (flow.$case) {
    case 'authorizationCode': {
      const v = flow.value;
      result.authorizationCode = {
        authorizationUrl: v.authorizationUrl,
        tokenUrl: v.tokenUrl,
        scopes: { ...v.scopes },
      };
      const refresh = nonEmpty(v.refreshUrl);
      if (refresh !== undefined) result.authorizationCode.refreshUrl = refresh;
      break;
    }
    case 'clientCredentials': {
      const v = flow.value;
      result.clientCredentials = {
        tokenUrl: v.tokenUrl,
        scopes: { ...v.scopes },
      };
      const refresh = nonEmpty(v.refreshUrl);
      if (refresh !== undefined) result.clientCredentials.refreshUrl = refresh;
      break;
    }
    case 'implicit': {
      const v = flow.value;
      result.implicit = {
        authorizationUrl: v.authorizationUrl,
        scopes: { ...v.scopes },
      };
      const refresh = nonEmpty(v.refreshUrl);
      if (refresh !== undefined) result.implicit.refreshUrl = refresh;
      break;
    }
    case 'password': {
      const v = flow.value;
      result.password = {
        tokenUrl: v.tokenUrl,
        scopes: { ...v.scopes },
      };
      const refresh = nonEmpty(v.refreshUrl);
      if (refresh !== undefined) result.password.refreshUrl = refresh;
      break;
    }
    case 'deviceCode':
      // Intentionally dropped: v0.3 has no `deviceCode` flow representation.
      break;
    default:
      // Unknown / future flow $case — also silently dropped.
      break;
  }
  return result;
}
