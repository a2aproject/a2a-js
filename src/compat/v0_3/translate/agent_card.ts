/**
 * `AgentCard` translators. The big shape differences:
 *  - Endpoints: v0.3 has `url` + `preferredTransport` + an
 *    `additionalInterfaces[]` sidecar; v1.0 has one
 *    `supportedInterfaces[]` with per-entry version.
 *  - `protocolVersion`: card-level in v0.3, per-interface in v1.0.
 *  - Extended-card flag: card-level in v0.3, on `capabilities` in v1.0.
 *  - `AgentSkill.security`: plain `{ [k]: string[] }[]` in v0.3, wrapped
 *    `SecurityRequirement[]` in v1.0.
 *
 * v1.0 → v0.3 filters interfaces to the legacy range and throws
 * `VersionNotSupportedError` if none remain.
 */

import { VersionNotSupportedError } from '../../../errors.js';
import { PROTOCOL_VERSION_0_3, isLegacyVersion } from './versions.js';
import {
  toCompatSecurityRequirement,
  toCompatSecurityScheme,
  toCoreSecurityRequirement,
  toCoreSecurityScheme,
} from './security.js';
import type {
  AgentCapabilities as V1AgentCapabilities,
  AgentCard as V1AgentCard,
  AgentCardSignature as V1AgentCardSignature,
  AgentExtension as V1AgentExtension,
  AgentInterface as V1AgentInterface,
  AgentProvider as V1AgentProvider,
  AgentSkill as V1AgentSkill,
} from '../../../types/pb/a2a.js';
import type * as legacy from '../types/types.js';
import { deepCloneMetadata } from './_clone.js';

// Default when the v0.3 card omits `preferredTransport`.
const DEFAULT_PREFERRED_TRANSPORT = 'JSONRPC';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

export function toCoreAgentInterface(compat: legacy.AgentInterface): V1AgentInterface {
  return {
    url: compat.url,
    protocolBinding: compat.transport,
    tenant: '',
    protocolVersion: PROTOCOL_VERSION_0_3,
  };
}

export function toCompatAgentInterface(core: V1AgentInterface): legacy.AgentInterface {
  return { url: core.url, transport: core.protocolBinding };
}

export function toCoreAgentProvider(compat: legacy.AgentProvider): V1AgentProvider {
  return { url: compat.url, organization: compat.organization };
}

export function toCompatAgentProvider(core: V1AgentProvider): legacy.AgentProvider {
  return { url: core.url, organization: core.organization };
}

export function toCoreAgentExtension(compat: legacy.AgentExtension): V1AgentExtension {
  return {
    uri: compat.uri,
    description: compat.description ?? '',
    required: compat.required ?? false,
    params: deepCloneMetadata(compat.params),
  };
}

export function toCompatAgentExtension(core: V1AgentExtension): legacy.AgentExtension {
  const result: legacy.AgentExtension = { uri: core.uri };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  // Always emit `required` so the consumer sees the explicit declaration.
  result.required = core.required;
  const params = deepCloneMetadata(core.params);
  if (params !== undefined) result.params = params;
  return result;
}

export function toCoreAgentCapabilities(
  compat: legacy.AgentCapabilities | legacy.AgentCapabilities1
): V1AgentCapabilities {
  return {
    streaming: compat.streaming,
    pushNotifications: compat.pushNotifications,
    extensions: compat.extensions ? compat.extensions.map(toCoreAgentExtension) : [],
    // `extendedAgentCard` is filled in by `toCoreAgentCard` from the
    // card-level `supportsAuthenticatedExtendedCard` flag.
    extendedAgentCard: undefined,
  };
}

/**
 * `stateTransitionHistory` has no v1.0 equivalent (left undefined).
 * `extendedAgentCard` is surfaced at card level by `toCompatAgentCard`.
 */
export function toCompatAgentCapabilities(core: V1AgentCapabilities): legacy.AgentCapabilities1 {
  const result: legacy.AgentCapabilities1 = {};
  if (core.streaming !== undefined) result.streaming = core.streaming;
  if (core.pushNotifications !== undefined) result.pushNotifications = core.pushNotifications;
  if (core.extensions.length > 0) {
    result.extensions = core.extensions.map(toCompatAgentExtension);
  }
  return result;
}

export function toCoreAgentSkill(compat: legacy.AgentSkill): V1AgentSkill {
  return {
    id: compat.id,
    name: compat.name,
    description: compat.description,
    tags: [...compat.tags],
    examples: compat.examples ? [...compat.examples] : [],
    inputModes: compat.inputModes ? [...compat.inputModes] : [],
    outputModes: compat.outputModes ? [...compat.outputModes] : [],
    securityRequirements: compat.security ? compat.security.map(toCoreSecurityRequirement) : [],
  };
}

export function toCompatAgentSkill(core: V1AgentSkill): legacy.AgentSkill {
  const result: legacy.AgentSkill = {
    id: core.id,
    name: core.name,
    description: core.description,
    tags: [...core.tags],
  };
  if (core.examples.length > 0) result.examples = [...core.examples];
  if (core.inputModes.length > 0) result.inputModes = [...core.inputModes];
  if (core.outputModes.length > 0) result.outputModes = [...core.outputModes];
  if (core.securityRequirements.length > 0) {
    result.security = core.securityRequirements.map(toCompatSecurityRequirement);
  }
  return result;
}

export function toCoreAgentCardSignature(compat: legacy.AgentCardSignature): V1AgentCardSignature {
  return {
    protected: compat.protected,
    signature: compat.signature,
    header: deepCloneMetadata(compat.header),
  };
}

export function toCompatAgentCardSignature(core: V1AgentCardSignature): legacy.AgentCardSignature {
  const result: legacy.AgentCardSignature = {
    protected: core.protected,
    signature: core.signature,
  };
  const header = deepCloneMetadata(core.header);
  if (header !== undefined) result.header = header;
  return result;
}

/**
 * The card-level `(url, preferredTransport, protocolVersion)` becomes
 * the first `supportedInterfaces` entry; `additionalInterfaces` are
 * appended. `supportsAuthenticatedExtendedCard` folds into
 * `capabilities.extendedAgentCard`.
 */
export function toCoreAgentCard(compat: legacy.AgentCard): V1AgentCard {
  const primary: V1AgentInterface = {
    url: compat.url,
    protocolBinding: compat.preferredTransport ?? DEFAULT_PREFERRED_TRANSPORT,
    tenant: '',
    protocolVersion: compat.protocolVersion || PROTOCOL_VERSION_0_3,
  };
  const additional = compat.additionalInterfaces?.map(toCoreAgentInterface) ?? [];
  const supportedInterfaces = [primary, ...additional];

  const capabilities = toCoreAgentCapabilities(compat.capabilities);
  if (compat.supportsAuthenticatedExtendedCard !== undefined) {
    capabilities.extendedAgentCard = compat.supportsAuthenticatedExtendedCard;
  }

  const result: V1AgentCard = {
    name: compat.name,
    description: compat.description,
    supportedInterfaces,
    provider: compat.provider ? toCoreAgentProvider(compat.provider) : undefined,
    version: compat.version,
    capabilities,
    securitySchemes: compat.securitySchemes
      ? Object.fromEntries(
          Object.entries(compat.securitySchemes).map(([key, scheme]) => [
            key,
            toCoreSecurityScheme(scheme),
          ])
        )
      : {},
    securityRequirements: compat.security ? compat.security.map(toCoreSecurityRequirement) : [],
    defaultInputModes: [...compat.defaultInputModes],
    defaultOutputModes: [...compat.defaultOutputModes],
    skills: compat.skills.map(toCoreAgentSkill),
    signatures: compat.signatures ? compat.signatures.map(toCoreAgentCardSignature) : [],
  };

  if (compat.documentationUrl !== undefined) result.documentationUrl = compat.documentationUrl;
  if (compat.iconUrl !== undefined) result.iconUrl = compat.iconUrl;

  return result;
}

export interface ToCompatAgentCardOptions {
  /**
   * Accept every interface regardless of `protocolVersion` and stamp
   * the emitted card as `'0.3'`. Lets a v1.0-only server with
   * `legacyCompat` opted in still serve a discoverable card to v0.3
   * clients. Default: `false` (strict — throws if no legacy-range
   * interface exists).
   */
  synthesize?: boolean;
  /**
   * Also copy the source v1.0 `supportedInterfaces[]` onto the emitted
   * card. Produces a "superset" document parseable by both v0.3 and
   * v1.0 resolvers (their top-level fields are disjoint), so a v1.0
   * peer that lacks per-binding v0.3 compat can still discover the
   * native v1.0 endpoints. Default: `false`.
   */
  embedV1Interfaces?: boolean;
}

/**
 * In `embedV1Interfaces` mode the result also carries the v1.0
 * `supportedInterfaces[]`; the v0.3 and v1.0 schemas share no top-level
 * fields, so one document satisfies both.
 */
export type CompatAgentCardResult = legacy.AgentCard & {
  supportedInterfaces?: V1AgentInterface[];
};

/**
 * Strict mode (default): keep only interfaces with `protocolVersion`
 * empty or in `[0.3, 1.0)`; throw `VersionNotSupportedError` if none.
 * See `ToCompatAgentCardOptions` for `synthesize` and
 * `embedV1Interfaces`.
 */
export function toCompatAgentCard(
  core: V1AgentCard,
  options?: ToCompatAgentCardOptions
): CompatAgentCardResult {
  const allInterfaces = core.supportedInterfaces ?? [];
  const legacyInterfaces = allInterfaces.filter(
    (intf) => !intf.protocolVersion || isLegacyVersion(intf.protocolVersion)
  );
  // Synthesis only falls back to non-legacy interfaces when there are no
  // legacy ones — dual-version deployments keep their existing v0.3
  // primary URL.
  const compatInterfaces =
    options?.synthesize && legacyInterfaces.length === 0 ? allInterfaces : legacyInterfaces;
  if (compatInterfaces.length === 0) {
    throw new VersionNotSupportedError(
      'AgentCard must have at least one interface with a protocol version in [0.3, 1.0).'
    );
  }

  const primary = compatInterfaces[0]!;
  const additionalInterfaces = compatInterfaces.slice(1).map(toCompatAgentInterface);

  const capabilities = core.capabilities
    ? toCompatAgentCapabilities(core.capabilities)
    : ({} as legacy.AgentCapabilities1);
  const supportsExtendedCard =
    core.capabilities && core.capabilities.extendedAgentCard !== undefined
      ? core.capabilities.extendedAgentCard
      : undefined;

  const securitySchemes =
    Object.keys(core.securitySchemes).length > 0
      ? Object.fromEntries(
          Object.entries(core.securitySchemes).map(([key, scheme]) => [
            key,
            toCompatSecurityScheme(scheme),
          ])
        )
      : undefined;

  // Under synthesize-fallback the emitted card always presents as v0.3
  // regardless of the underlying interface's declared version.
  const synthesizedFallback = options?.synthesize && legacyInterfaces.length === 0;
  const emittedProtocolVersion = synthesizedFallback
    ? PROTOCOL_VERSION_0_3
    : primary.protocolVersion || PROTOCOL_VERSION_0_3;

  const result: CompatAgentCardResult = {
    name: core.name,
    description: core.description,
    version: core.version,
    url: primary.url,
    preferredTransport: primary.protocolBinding,
    protocolVersion: emittedProtocolVersion,
    capabilities,
    defaultInputModes: [...core.defaultInputModes],
    defaultOutputModes: [...core.defaultOutputModes],
    skills: core.skills.map(toCompatAgentSkill),
  };

  if (additionalInterfaces.length > 0) {
    result.additionalInterfaces = additionalInterfaces;
  }
  if (core.provider) result.provider = toCompatAgentProvider(core.provider);
  if (core.documentationUrl !== undefined && core.documentationUrl !== '') {
    result.documentationUrl = core.documentationUrl;
  }
  if (core.iconUrl !== undefined && core.iconUrl !== '') result.iconUrl = core.iconUrl;
  if (supportsExtendedCard !== undefined) {
    result.supportsAuthenticatedExtendedCard = supportsExtendedCard;
  }
  if (securitySchemes !== undefined) result.securitySchemes = securitySchemes;
  if (core.securityRequirements.length > 0) {
    result.security = core.securityRequirements.map(toCompatSecurityRequirement);
  }
  if (core.signatures.length > 0) {
    result.signatures = core.signatures.map(toCompatAgentCardSignature);
  }

  // Hybrid-card embedding: see `embedV1Interfaces` on the options type.
  if (options?.embedV1Interfaces && allInterfaces.length > 0) {
    result.supportedInterfaces = allInterfaces.map((intf) => ({ ...intf }));
  }

  return result;
}
