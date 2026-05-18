/**
 * `AgentCard` (and its sub-types) translators between v1.0 proto and v0.3
 * JSON.
 *
 * The most disruptive shape differences:
 *
 *  - **Endpoint surface.** v0.3 stores a single primary endpoint
 *    (`url` + `preferredTransport`) plus an `additionalInterfaces[]`
 *    sidecar. v1.0 collapses everything into a single
 *    `supportedInterfaces[]` array where each entry carries its own
 *    `(url, protocolBinding, tenant, protocolVersion)`.
 *  - **Protocol version placement.** v0.3 stores `protocolVersion` once at
 *    the card level. v1.0 stores it per-interface, so multiple versions
 *    can be advertised side-by-side.
 *  - **Extended-card flag.** v0.3 has a card-level
 *    `supportsAuthenticatedExtendedCard`; v1.0 folds the same flag into
 *    `capabilities.extendedAgentCard`.
 *  - **`stateTransitionHistory`.** Only v0.3 has this capability flag; the
 *    v1.0 → v0.3 direction always leaves it `undefined`.
 *  - **AgentSkill security shape.** v0.3 uses `security?: { [k]: string[]
 *    }[]`; v1.0 uses `securityRequirements: SecurityRequirement[]` with
 *    `StringList` wrappers.
 *
 * Going v1.0 → v0.3 we filter `supportedInterfaces` to those whose
 * `protocolVersion` is empty or falls inside `[0.3, 1.0)` (via
 * `isLegacyVersion`) and throw `VersionNotSupportedError` if no interface
 * remains.
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

/** Default transport advertised when the v0.3 card omits `preferredTransport`. */
const DEFAULT_PREFERRED_TRANSPORT = 'JSONRPC';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/** v0.3 `AgentInterface` → v1.0 proto `AgentInterface`. */
export function toCoreAgentInterface(compat: legacy.AgentInterface): V1AgentInterface {
  return {
    url: compat.url,
    protocolBinding: compat.transport,
    tenant: '',
    protocolVersion: PROTOCOL_VERSION_0_3,
  };
}

/** v1.0 proto `AgentInterface` → v0.3 `AgentInterface`. */
export function toCompatAgentInterface(core: V1AgentInterface): legacy.AgentInterface {
  return { url: core.url, transport: core.protocolBinding };
}

/** v0.3 `AgentProvider` → v1.0 proto `AgentProvider`. */
export function toCoreAgentProvider(compat: legacy.AgentProvider): V1AgentProvider {
  return { url: compat.url, organization: compat.organization };
}

/** v1.0 proto `AgentProvider` → v0.3 `AgentProvider`. */
export function toCompatAgentProvider(core: V1AgentProvider): legacy.AgentProvider {
  return { url: core.url, organization: core.organization };
}

/** v0.3 `AgentExtension` → v1.0 proto `AgentExtension`. */
export function toCoreAgentExtension(compat: legacy.AgentExtension): V1AgentExtension {
  return {
    uri: compat.uri,
    description: compat.description ?? '',
    required: compat.required ?? false,
    params: deepCloneMetadata(compat.params),
  };
}

/** v1.0 proto `AgentExtension` → v0.3 `AgentExtension`. */
export function toCompatAgentExtension(core: V1AgentExtension): legacy.AgentExtension {
  const result: legacy.AgentExtension = { uri: core.uri };
  const description = nonEmpty(core.description);
  if (description !== undefined) result.description = description;
  // Always emit `required` so the v0.3 consumer sees the agent's explicit
  // declaration (even when it's the default `false`).
  result.required = core.required;
  const params = deepCloneMetadata(core.params);
  if (params !== undefined) result.params = params;
  return result;
}

/** v0.3 `AgentCapabilities` → v1.0 proto `AgentCapabilities`. */
export function toCoreAgentCapabilities(
  compat: legacy.AgentCapabilities | legacy.AgentCapabilities1
): V1AgentCapabilities {
  return {
    streaming: compat.streaming,
    pushNotifications: compat.pushNotifications,
    extensions: compat.extensions ? compat.extensions.map(toCoreAgentExtension) : [],
    // `extendedAgentCard` is set later by `toCoreAgentCard` based on the
    // card-level `supportsAuthenticatedExtendedCard` flag.
    extendedAgentCard: undefined,
  };
}

/**
 * v1.0 proto `AgentCapabilities` → v0.3 `AgentCapabilities`.
 *
 * `stateTransitionHistory` has no v1.0 equivalent and is left `undefined`.
 * `extendedAgentCard` is intentionally NOT propagated here: it is
 * surfaced on the card level by `toCompatAgentCard`.
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

/** v0.3 `AgentSkill` → v1.0 proto `AgentSkill`. */
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

/** v1.0 proto `AgentSkill` → v0.3 `AgentSkill`. */
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

/** v0.3 `AgentCardSignature` → v1.0 proto `AgentCardSignature`. */
export function toCoreAgentCardSignature(compat: legacy.AgentCardSignature): V1AgentCardSignature {
  return {
    protected: compat.protected,
    signature: compat.signature,
    header: deepCloneMetadata(compat.header),
  };
}

/** v1.0 proto `AgentCardSignature` → v0.3 `AgentCardSignature`. */
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
 * Converts a v0.3 JSON `AgentCard` into a v1.0 proto `AgentCard`.
 *
 * The card-level `(url, preferredTransport, protocolVersion)` becomes
 * the first entry in `supportedInterfaces`; `additionalInterfaces` are
 * appended afterwards. `supportsAuthenticatedExtendedCard` is folded into
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

/**
 * Converts a v1.0 proto `AgentCard` into a v0.3 JSON `AgentCard`.
 *
 * Filters `supportedInterfaces` to those whose `protocolVersion` is
 * empty or in `[0.3, 1.0)`; the first surviving entry becomes the v0.3
 * primary `(url, preferredTransport)`, and the rest become
 * `additionalInterfaces`. Throws `VersionNotSupportedError` if no
 * interface qualifies.
 *
 * `capabilities.extendedAgentCard` is pulled back out to the card-level
 * `supportsAuthenticatedExtendedCard` field.
 */
export function toCompatAgentCard(core: V1AgentCard): legacy.AgentCard {
  const compatInterfaces = core.supportedInterfaces.filter(
    (intf) => !intf.protocolVersion || isLegacyVersion(intf.protocolVersion)
  );
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

  const result: legacy.AgentCard = {
    name: core.name,
    description: core.description,
    version: core.version,
    url: primary.url,
    preferredTransport: primary.protocolBinding,
    protocolVersion: primary.protocolVersion || PROTOCOL_VERSION_0_3,
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

  return result;
}
