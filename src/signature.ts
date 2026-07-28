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
 * The payload is produced by {@link canonicalizeAgentCard}, which excludes
 * the `signatures` field. The `protectedHeader` MUST include `alg`, `kid`,
 * `typ`.
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
    const canonicalPayload = canonicalizeAgentCard(agentCard);

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
      signatures: [...(agentCard.signatures ?? []), agentCardSignature],
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
 * Note that the payload is normalized by {@link canonicalizeAgentCard}, so
 * fields outside the v1.0 schema are not covered by the signature and a
 * successful verification says nothing about them.
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

    const canonicalPayload = canonicalizeAgentCard(agentCard);
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
 * Canonicalizes an agent card for signing / verification, per spec §8.4.1.
 *
 * The card is first round-tripped through `AgentCard.fromJSON` /
 * `AgentCard.toJSON`, which drops fields outside the v1.0 schema and omits
 * fields whose value equals the protobuf default (the JS equivalent of the
 * Python SDK's `MessageToDict`). The `signatures` field is then excluded to
 * avoid a circular dependency, and the result is serialized with JCS
 * (RFC 8785).
 *
 * Both the signing and the verification path MUST go through this function.
 *
 * Passing a card that still carries `signatures` is fine; they are stripped
 * here.
 */
export function canonicalizeAgentCard(
  agentCard: AgentCard | Omit<AgentCard, 'signatures'>
): string {
  const normalized = AgentCard.toJSON(AgentCard.fromJSON(agentCard)) as Record<string, unknown>;
  delete normalized.signatures;

  const cleaned = cleanEmpty(normalized);
  if (!cleaned) {
    return '{}';
  }
  return jcsStringify(cleaned);
}
