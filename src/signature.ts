import { AgentCard, AgentCardSignature } from './types.js';
import * as jose from 'jose';

export type AgentCardSignatureGenerator = (agentCard: AgentCard) => Promise<AgentCard>;

export function generateAgentCardSignature(
  privateKey: jose.CryptoKey | jose.KeyObject | jose.JWK,
  protectedHeader: jose.JWSHeaderParameters,
  header?: jose.JWSHeaderParameters
): AgentCardSignatureGenerator {
  return async (agentCard: AgentCard): Promise<AgentCard> => {
    const cardCopy = JSON.parse(JSON.stringify(agentCard));
    delete cardCopy.signatures;
    const canonicalPayload = canonicalizeAgentCard(cardCopy);

    const jws = await new jose.FlattenedSign(new TextEncoder().encode(canonicalPayload))
      .setProtectedHeader(protectedHeader)
      .setUnprotectedHeader(header)
      .sign(privateKey);

    const agentCardSignature: AgentCardSignature = {
      protected: jws.protected,
      signature: jws.signature,
      header: jws.header,
    };

    if (!agentCard.signatures) agentCard.signatures = [];
    agentCard.signatures.push(agentCardSignature);

    return agentCard;
  };
}

export type AgentCardSignatureVerifier = (agentCard: AgentCard) => Promise<void>;

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
    const cardCopy = JSON.parse(JSON.stringify(agentCard));
    delete cardCopy.signatures;
    const canonicalPayload = canonicalizeAgentCard(cardCopy);
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
          header: signatureEntry.header,
        };
        await jose.flattenedVerify(jws, publicKey);
        return;
      } catch (error) {
        console.warn('Signature verification failed:', error);
      }
    }
    throw new Error('No valid signatures found on agent card.');
  };
}

function cleanEmpty(d: unknown): unknown {
  if (d === '' || d === null || d === undefined) {
    return null;
  }

  if (Array.isArray(d)) {
    const cleanedList = d.map((v) => cleanEmpty(v)).filter((v) => v !== null);
    return cleanedList.length > 0 ? cleanedList : null;
  }

  if (typeof d === 'object') {
    if (d instanceof Date) return d;
    const cleanedDict: { [key: string]: unknown } = {};
    for (const [key, v] of Object.entries(d)) {
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
 * JCS Canonicalization (RFC 8785)
 * Sorts keys recursively and serializes to string.
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
  const parts = keys.map((key) => {
    return `${JSON.stringify(key)}:${jcsStringify(record[key])}`;
  });

  return '{' + parts.join(',') + '}';
}

export function canonicalizeAgentCard(agentCard: Omit<AgentCard, 'signatures'>): string {
  const cleaned = cleanEmpty(agentCard);
  if (!cleaned) {
    return '{}';
  }

  return jcsStringify(cleaned);
}
