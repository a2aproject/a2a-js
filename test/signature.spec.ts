import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as jose from 'jose';
import {
  generateAgentCardSignature,
  verifyAgentCardSignature,
  canonicalizeAgentCard,
} from '../src/signature.js';
import { AgentCard } from '../src/types.js';

let mockAgentCard: AgentCard;
let privateKey: jose.CryptoKey;
let publicKey: jose.CryptoKey;
const ALG = 'ES256';

describe('Agent Card Signature', () => {
  beforeAll(async () => {
    const keys = await jose.generateKeyPair(ALG, { extractable: true });
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;
  });

  beforeEach(() => {
    mockAgentCard = {
      protocolVersion: '0.3.0',
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      url: 'http://localhost:8080',
      preferredTransport: 'JSONRPC',
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true,
      },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    };
  });

  describe('canonicalizeAgentCard', () => {
    it('should remove empty values and sort keys recursively (JCS)', () => {
      const input: AgentCard = {
        name: 'Example Agent',
        description: '',
        capabilities: {
          streaming: false,
          pushNotifications: false,
          extensions: [],
        },
        skills: [],
        defaultInputModes: [],
        defaultOutputModes: [],
        protocolVersion: '',
        url: '',
        version: '1.0.0',
      };

      const expected = `{"capabilities":{"pushNotifications":false,"streaming":false},"name":"Example Agent","version":"1.0.0"}`;
      const result = canonicalizeAgentCard(input);
      expect(result).toBe(expected);
    });
  });

  describe('generateAgentCardSignature', () => {
    it('should add a signature to the agent card', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });

      const signedCard = await signer(mockAgentCard);

      expect(signedCard.signatures).toBeDefined();
      expect(signedCard.signatures).toHaveLength(1);

      const sig = signedCard.signatures![0];
      expect(sig.protected).toBeDefined();
      expect(sig.signature).toBeDefined();

      const decodedHeader = jose.decodeProtectedHeader(sig);
      expect(decodedHeader.kid).toBe('test-key-1');
      expect(decodedHeader.alg).toBe(ALG);
    });

    it('should append signatures if one already exists', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'key-1',
        typ: 'JOSE',
      });

      await signer(mockAgentCard);
      await signer(mockAgentCard);
      expect(mockAgentCard.signatures).toHaveLength(2);
    });
  });

  describe('verifyAgentCardSignature', () => {
    const mockRetrieveKey = vi.fn();

    beforeAll(() => {
      mockRetrieveKey.mockImplementation(async (_kid: string) => {
        return publicKey;
      });
    });

    it('should successfully verify a valid signature', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      await signer(mockAgentCard);

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(mockAgentCard)).resolves.not.toThrow();

      expect(mockRetrieveKey).toHaveBeenCalledWith('test-key-1', undefined);
    });

    it('should fail if the payload has been tampered with', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      await signer(mockAgentCard);

      mockAgentCard.name = 'Modified Agent Name';
      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(mockAgentCard)).rejects.toThrow();
    });

    it('should fail if the signature is invalid/malformed', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      await signer(mockAgentCard);

      mockAgentCard.signatures![0].signature = 'invalid_signature_string';
      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(mockAgentCard)).rejects.toThrow();
    });

    it('should pass if at least one signature is valid (Multi-sig support)', async () => {
      mockAgentCard.signatures = [];
      mockAgentCard.signatures.push({
        protected: 'invalid value',
        signature: 'invalid value',
      });

      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      await signer(mockAgentCard);

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(mockAgentCard)).resolves.not.toThrow();
    });
  });
});
