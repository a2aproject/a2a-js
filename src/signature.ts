/**
 * Agent Card Signature utilities per §8.4.
 *
 * Provides JWS signing and verification for Agent Cards using
 * JCS (RFC 8785) canonicalization and the `jose` library.
 *
 * Agent Cards MAY be signed using JWS. Canonicalization MUST use JCS.
 * Clients SHOULD verify signatures when present.
 */

import * as jose from 'jose';
import { AgentCard, AgentCardSignature } from './index.js';

/**
 * A function that signs an agent card and returns the card with signatures attached.
 */
export type AgentCardSignatureGenerator = (agentCard: AgentCard) => Promise<AgentCard>;

/**
 * Creates an {@link AgentCardSignatureGenerator} that signs an agent card using JWS
 * (Flattened JSON Serialization) with the provided private key.
 *
 * The agent card is canonicalized using JCS (RFC 8785) before signing.
 * The `signatures` field is excluded from the payload before canonicalization.
 *
 * @param privateKey - The private key used for signing.
 * @param protectedHeader - JWS protected header (MUST include `alg`, `kid`, `typ`).
 * @param header - Optional unprotected JWS header values.
 * @returns A function that signs an agent card and appends the signature.
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

/**
 * A function that verifies an agent card's signatures.
 * Throws if no valid signature is found.
 */
export type AgentCardSignatureVerifier = (agentCard: AgentCard) => Promise<void>;

/**
 * Creates an {@link AgentCardSignatureVerifier} that verifies agent card signatures.
 *
 * The verifier iterates through all signatures on the card and succeeds if at least
 * one signature is valid (multi-signature support). The agent card is canonicalized
 * using JCS (RFC 8785) and compared against each signature's payload.
 *
 * @param retrievePublicKey - A function that retrieves the public key for a given `kid`
 *   and optional `jku` (JWK Set URL). Called for each signature's protected header.
 * @returns A function that verifies an agent card's signatures.
 *
 * @example
 * ```ts
 * const verifier = verifyAgentCardSignature(async (kid, jku) => {
 *   // Fetch the public key from your key store
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
    // fromJSON strips non-schema fields (e.g., backward-compatibility fields
    // injected by other SDK implementations), and toJSON omits fields with
    // default values. This mirrors the Python SDK's MessageToDict behavior.
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
        return; // At least one valid signature found
      } catch (error) {
        console.debug('Signature verification on entry was not successful:', signatureEntry, error);
      }
    }

    throw new Error('No valid signatures found on agent card.');
  };
}

/**
 * Removes empty values (empty strings, null, undefined, empty arrays, empty objects)
 * recursively from a value, preparing it for JCS canonicalization.
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
 * JCS Canonicalization (RFC 8785).
 * Sorts object keys recursively and serializes to a deterministic JSON string.
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
 * Canonicalizes an agent card using JCS (RFC 8785) for signing/verification.
 *
 * The `signatures` field MUST be excluded from the agent card before calling this.
 * Empty values are cleaned recursively, then keys are sorted deterministically.
 *
 * @param agentCard - The agent card without the `signatures` field.
 * @returns The canonical JSON string representation.
 */
export function canonicalizeAgentCard(agentCard: Omit<AgentCard, 'signatures'>): string {
  const cleaned = cleanEmpty(agentCard);
  if (!cleaned) {
    return '{}';
  }
  return jcsStringify(cleaned);
}
