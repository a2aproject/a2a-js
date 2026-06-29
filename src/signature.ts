/**
 * Agent Card signing and verification utilities. Uses JWS over a JCS
 * (RFC 8785) canonicalization of the card, backed by the `jose` library.
 */

import * as jose from 'jose';
import { AgentCard, AgentCardSignature } from './index.js';

/** Signs an agent card and returns the card with signatures attached. */
export type AgentCardSignatureGenerator = (agentCard: AgentCard) => Promise<AgentCard>;

/**
 * Creates an {@link AgentCardSignatureGenerator} that signs an agent card
 * using JWS (Flattened JSON Serialization) with the provided private key.
 * The `signatures` field is excluded from the payload before
 * canonicalization. The `protectedHeader` MUST include `alg`, `kid`, `typ`.
 *
 * @example
 * ```ts
 * const signer = generateAgentCardSignature(privateKey, {
 *   alg: 'ES256',
 *   kid: 'my-key-id',
 *   typ: 'JOSE',
 * });
 * const signedCard = await signer(agentCard);
 * ```
 */
export function generateAgentCardSignature(
  privateKey: jose.CryptoKey | jose.KeyObject | jose.JWK,
  protectedHeader: jose.JWSHeaderParameters,
  header?: jose.JWSHeaderParameters
): AgentCardSignatureGenerator {
  return async (agentCard: AgentCard): Promise<AgentCard> => {
    const { signatures: existingSignatures, ...cardWithoutSignatures } = agentCard;
    const canonicalPayload = canonicalizeAgentCard(cardWithoutSignatures);

    const signBuilder = new jose.FlattenedSign(
      new TextEncoder().encode(canonicalPayload)
    ).setProtectedHeader(protectedHeader);

    if (header) {
      signBuilder.setUnprotectedHeader(header);
    }

    const jws = await signBuilder.sign(privateKey);

    const agentCardSignature: AgentCardSignature = {
      protected: jws.protected!,
      signature: jws.signature,
      header: jws.header,
    };

    return {
      ...agentCard,
      signatures: [...(existingSignatures ?? []), agentCardSignature],
    };
  };
}

/** Verifies an agent card's signatures, throwing if none are valid. */
export type AgentCardSignatureVerifier = (agentCard: AgentCard) => Promise<void>;

/**
 * Creates an {@link AgentCardSignatureVerifier} that succeeds if at least
 * one signature on the card verifies against a key returned by
 * `retrievePublicKey(kid, jku)`.
 *
 * @example
 * ```ts
 * const verifier = verifyAgentCardSignature(async (kid, jku) => {
 *   return await fetchPublicKey(kid, jku);
 * });
 * await verifier(agentCard); // throws if no valid signature
 * ```
 */
export function verifyAgentCardSignature(
  retrievePublicKey: (
    kid: string,
    jku?: string
  ) => Promise<jose.CryptoKey | jose.KeyObject | jose.JWK>
): AgentCardSignatureVerifier {
  return async (agentCard: AgentCard): Promise<void> => {
    if (!agentCard.signatures?.length) {
      throw new Error('No signatures found on agent card to verify.');
    }

    // Round-trip through AgentCard.fromJSON/toJSON to normalize the card:
    // strip non-schema fields and omit fields with default values. Mirrors
    // the Python SDK's MessageToDict behaviour.
    const normalizedCard = AgentCard.toJSON(AgentCard.fromJSON(agentCard)) as Record<
      string,
      unknown
    >;
    delete normalizedCard.signatures;
    const canonicalPayload = canonicalizeAgentCard(normalizedCard as Omit<AgentCard, 'signatures'>);
    const payloadBytes = new TextEncoder().encode(canonicalPayload);
    const encodedPayload = jose.base64url.encode(payloadBytes);

    for (const signatureEntry of agentCard.signatures) {
      try {
        const protectedHeader = jose.decodeProtectedHeader(signatureEntry);
        if (!protectedHeader.kid || !protectedHeader.typ || !protectedHeader.alg) {
          throw new Error('Missing required header parameters (kid, typ, alg)');
        }

        const publicKey = await retrievePublicKey(protectedHeader.kid, protectedHeader.jku);
        const jws: jose.FlattenedJWS = {
          payload: encodedPayload,
          protected: signatureEntry.protected,
          signature: signatureEntry.signature,
          header: signatureEntry.header as jose.JWSHeaderParameters,
        };

        await jose.flattenedVerify(jws, publicKey);
        return;
      } catch (error) {
        console.debug('Signature verification on entry was not successful:', signatureEntry, error);
      }
    }

    throw new Error('No valid signatures found on agent card.');
  };
}

/**
 * Recursively strips empty values (empty strings, null, undefined, empty
 * arrays, empty objects) from `d` in preparation for JCS canonicalization.
 */
function cleanEmpty(d: unknown): unknown {
  if (d === '' || d === null || d === undefined) {
    return null;
  }

  if (Array.isArray(d)) {
    const cleanedList = d.map((v) => cleanEmpty(v)).filter((v) => v !== null);
    return cleanedList.length > 0 ? cleanedList : null;
  }

  if (typeof d === 'object') {
    if (d instanceof Date) return d.toISOString();
    const cleanedDict: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(d as Record<string, unknown>)) {
      const cleanedValue = cleanEmpty(v);
      if (cleanedValue !== null) {
        cleanedDict[key] = cleanedValue;
      }
    }
    return Object.keys(cleanedDict).length > 0 ? cleanedDict : null;
  }

  return d;
}

/**
 * JCS canonicalization (RFC 8785): sorts object keys recursively and
 * serializes to a deterministic JSON string.
 */
function jcsStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => jcsStringify(item)).join(',') + ']';
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${jcsStringify(record[key])}`);

  return '{' + parts.join(',') + '}';
}

/**
 * Canonicalizes an agent card using JCS (RFC 8785) for signing /
 * verification. The `signatures` field MUST be excluded from `agentCard`
 * before calling this.
 */
export function canonicalizeAgentCard(agentCard: Omit<AgentCard, 'signatures'>): string {
  const cleaned = cleanEmpty(agentCard);
  if (!cleaned) {
    return '{}';
  }
  return jcsStringify(cleaned);
}
