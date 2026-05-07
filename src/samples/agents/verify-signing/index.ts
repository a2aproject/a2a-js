/**
 * Agent Card Signing Verification Client
 *
 * This sample demonstrates verifying agent card signatures from a remote A2A server.
 * It uses the a2a-js SDK's verifyAgentCardSignature to validate JWS signatures
 * on agent cards, fetching the public key from the server's jku endpoint.
 *
 * Designed to work against the Python signing_and_verifying sample server:
 *   https://github.com/a2a-samples/samples/python/agents/signing_and_verifying
 *
 * Usage:
 *   npx tsx src/samples/agents/verify-signing/index.ts [server-url]
 *
 * Default server URL: http://localhost:9999
 */

import crypto from 'node:crypto';
import {
  AgentCard,
  AGENT_CARD_PATH,
  verifyAgentCardSignature,
  canonicalizeAgentCard,
} from '../../../index.js';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '../../../client/index.js';

// --- Configuration ---
const serverUrl = process.argv[2] || 'http://localhost:9999';

// --- Key Provider ---

/**
 * Retrieves the public key for signature verification.
 *
 * The Python signing server serves PEM-encoded public keys at its jku endpoint
 * in a simple {kid: pem_string} JSON format. This function fetches the key
 * and imports it as a CryptoKey for use with the jose library.
 */
async function retrievePublicKey(kid: string, jku?: string): Promise<crypto.webcrypto.CryptoKey> {
  if (!jku) {
    throw new Error(`No jku (JWK Set URL) provided for kid "${kid}"`);
  }

  console.log(`  Fetching public key: kid="${kid}" from jku="${jku}"`);
  const response = await fetch(jku);
  if (!response.ok) {
    throw new Error(`Failed to fetch public keys from ${jku}: ${response.status}`);
  }

  const keys: Record<string, string> = await response.json();
  const pemData = keys[kid];
  if (!pemData) {
    throw new Error(
      `Key "${kid}" not found at ${jku}. Available keys: ${Object.keys(keys).join(', ')}`
    );
  }

  // Import the PEM public key as a CryptoKey
  const key = crypto.createPublicKey(pemData);
  const jwk = key.export({ format: 'jwk' });

  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

// --- Main ---

async function main() {
  console.log('=== Agent Card Signing Verification Client ===\n');
  console.log(`Server URL: ${serverUrl}\n`);

  // Step 1: Fetch the raw agent card to inspect it
  console.log('--- Step 1: Fetch raw agent card ---');
  const agentCardUrl = new URL(AGENT_CARD_PATH, serverUrl);
  const rawResponse = await fetch(agentCardUrl);
  if (!rawResponse.ok) {
    throw new Error(`Failed to fetch agent card from ${agentCardUrl}: ${rawResponse.status}`);
  }
  const rawCard: AgentCard = await rawResponse.json();

  console.log(`  Agent Name: ${rawCard.name}`);
  console.log(`  Description: ${rawCard.description}`);
  console.log(`  Version: ${rawCard.version}`);
  console.log(`  Signatures found: ${rawCard.signatures?.length ?? 0}`);

  if (rawCard.signatures?.length) {
    for (let i = 0; i < rawCard.signatures.length; i++) {
      const sig = rawCard.signatures[i];
      const header = JSON.parse(Buffer.from(sig.protected, 'base64url').toString());
      console.log(`  Signature ${i + 1}:`);
      console.log(`    Algorithm: ${header.alg}`);
      console.log(`    Key ID: ${header.kid}`);
      console.log(`    Type: ${header.typ}`);
      console.log(`    JKU: ${header.jku}`);
    }
  }

  // Step 2: Verify the signature
  console.log('\n--- Step 2: Verify agent card signature ---');
  const verifier = verifyAgentCardSignature(retrievePublicKey);
  try {
    await verifier(rawCard);
    console.log('  PASS: Agent card signature is valid!\n');
  } catch (error) {
    console.error(`  FAIL: Signature verification failed: ${error}\n`);
    process.exit(1);
  }

  // Step 3: Verify canonicalization produces deterministic output
  console.log('--- Step 3: Verify canonicalization ---');
  const { signatures: _, ...cardWithoutSignatures } = rawCard;
  void _;
  const canonical = canonicalizeAgentCard(cardWithoutSignatures);
  console.log(`  Canonical form (first 200 chars): ${canonical.substring(0, 200)}...`);
  // Run it twice to confirm determinism
  const canonical2 = canonicalizeAgentCard(cardWithoutSignatures);
  if (canonical === canonical2) {
    console.log('  PASS: Canonicalization is deterministic.\n');
  } else {
    console.error('  FAIL: Canonicalization produced different results!\n');
    process.exit(1);
  }

  // Step 4: Verify tamper detection
  console.log('--- Step 4: Verify tamper detection ---');
  const tamperedCard = { ...rawCard, name: 'TAMPERED Agent Name' };
  try {
    await verifier(tamperedCard);
    console.error('  FAIL: Tampered card was accepted (should have been rejected)!\n');
    process.exit(1);
  } catch {
    console.log('  PASS: Tampered card was correctly rejected.\n');
  }

  // Step 5: Use the SDK client to fetch + verify in one step
  console.log('--- Step 5: Fetch and verify via SDK Client ---');
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver(),
      transports: [new JsonRpcTransportFactory(), new RestTransportFactory()],
    })
  );

  const client = await factory.createFromUrl(serverUrl);
  const verifiedCard = await client.getAgentCard(undefined, verifier);
  console.log(`  PASS: SDK client fetched and verified agent card: "${verifiedCard.name}"\n`);

  // Step 6: Test extended agent card verification (if supported)
  if (rawCard.capabilities?.extendedAgentCard) {
    console.log('--- Step 6: Verify extended agent card signature ---');
    try {
      // getAgentCard will fetch the extended card since the capability is set
      const extendedCard = await client.getAgentCard(undefined, verifier);
      console.log(`  PASS: Extended agent card verified: "${extendedCard.name}"`);
      console.log(`  Skills: ${extendedCard.skills?.map((s) => s.name).join(', ')}\n`);
    } catch (error) {
      console.error(`  FAIL: Extended card verification failed: ${error}\n`);
      process.exit(1);
    }
  } else {
    console.log('--- Step 6: Skipped (server does not support extended agent card) ---\n');
  }

  // Summary
  console.log('=== All verification checks passed! ===');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
