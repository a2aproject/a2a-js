import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as jose from 'jose';
import {
  generateAgentCardSignature,
  verifyAgentCardSignature,
  canonicalizeAgentCard,
} from '../src/signature.js';
import { AgentCard } from '../src/index.js';

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
      name: 'Test Agent',
      description: 'An agent for testing purposes',
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true,
        extensions: [],
      },
      supportedInterfaces: [
        {
          url: 'http://localhost:8080',
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
      ],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      provider: { organization: 'Test', url: '' },
      securitySchemes: {},
      securityRequirements: [],
      signatures: [],
    };
  });

  describe('canonicalizeAgentCard', () => {
    it('should remove empty values and sort keys recursively (JCS)', () => {
      const input = {
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
        version: '1.0.0',
        supportedInterfaces: [],
        provider: { organization: '', url: '' },
        securitySchemes: {},
        securityRequirements: [],
      } as Omit<AgentCard, 'signatures'>;

      const result = canonicalizeAgentCard(input);
      const parsed = JSON.parse(result);

      expect(parsed.description).toBeUndefined();
      expect(parsed.skills).toBeUndefined();
      expect(parsed.defaultInputModes).toBeUndefined();

      expect(parsed.name).toBe('Example Agent');
      expect(parsed.version).toBe('1.0.0');

      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    it('should produce deterministic output regardless of key order', () => {
      const card1 = { name: 'Agent', version: '1.0', capabilities: { streaming: true } };
      const card2 = { capabilities: { streaming: true }, version: '1.0', name: 'Agent' };

      expect(canonicalizeAgentCard(card1 as any)).toBe(canonicalizeAgentCard(card2 as any));
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

      const sig = signedCard.signatures[0];
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

      const signed1 = await signer(mockAgentCard);
      const signed2 = await signer(signed1);
      expect(signed2.signatures).toHaveLength(2);
      expect(mockAgentCard.signatures).toHaveLength(0);
    });
  });

  describe('verifyAgentCardSignature', () => {
    const mockRetrieveKey = vi.fn();

    beforeEach(() => {
      mockRetrieveKey.mockReset();
      mockRetrieveKey.mockImplementation(async () => publicKey);
    });

    it('should successfully verify a valid signature', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      const signedCard = await signer(mockAgentCard);

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(signedCard)).resolves.not.toThrow();

      expect(mockRetrieveKey).toHaveBeenCalledWith('test-key-1', undefined);
    });

    it('should fail if the payload has been tampered with', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      const signedCard = await signer(mockAgentCard);

      const modifiedAgentCard = { ...signedCard, name: 'Modified Agent Name' };
      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(modifiedAgentCard)).rejects.toThrow('No valid signatures found');
    });

    it('should fail if the signature is invalid/malformed', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      const signedCard = await signer(mockAgentCard);

      (signedCard.signatures as any)[0].signature = 'invalid_signature_string';
      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(signedCard)).rejects.toThrow('No valid signatures found');
    });

    it('should throw if no signatures are present', async () => {
      mockAgentCard.signatures = [];
      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(mockAgentCard)).rejects.toThrow('No signatures found');
    });

    it('should pass if at least one signature is valid (multi-sig)', async () => {
      mockAgentCard.signatures = [
        {
          protected: 'invalid_value',
          signature: 'invalid_value',
          header: undefined,
        },
      ];

      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      const signedCard = await signer(mockAgentCard);

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(signedCard)).resolves.not.toThrow();
    });

    it('should verify cards with non-schema fields (cross-implementation compat)', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
      });
      const signedCard = await signer(mockAgentCard);

      // Simulates backward-compat fields injected by another SDK (e.g. Python v0.3 compat).
      const cardWithExtraFields = {
        ...signedCard,
        url: 'http://localhost:8080',
        preferredTransport: 'JSONRPC',
        protocolVersion: '0.3',
        supportsAuthenticatedExtendedCard: false,
      };

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await expect(verifier(cardWithExtraFields as AgentCard)).resolves.not.toThrow();
    });

    it('should pass jku to retrievePublicKey when present in header', async () => {
      const signer = generateAgentCardSignature(privateKey, {
        alg: ALG,
        kid: 'test-key-1',
        typ: 'JOSE',
        jku: 'https://example.com/.well-known/jwks.json',
      });
      const signedCard = await signer(mockAgentCard);

      const verifier = verifyAgentCardSignature(mockRetrieveKey);
      await verifier(signedCard);

      expect(mockRetrieveKey).toHaveBeenCalledWith(
        'test-key-1',
        'https://example.com/.well-known/jwks.json'
      );
    });
  });
});
