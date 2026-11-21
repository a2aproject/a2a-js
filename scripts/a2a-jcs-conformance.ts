// Answers one vector of the a2a-jcs-v01 canonicalization corpus for the
// conformance workflow: `tsx scripts/a2a-jcs-conformance.ts <target> <input.json>`.
// Exit 0 with the canonical bytes as hex, or exit 1 when the input has no
// canonical form. The contract is in the corpus README of agent-evidence-vectors.
import { readFileSync } from 'node:fs';
import { jcsStringify } from '../src/signature.js';

const [target, file] = process.argv.slice(2);

let value: unknown;
try {
  value = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  process.exit(1);
}

// The signature covers the card without its top-level `signatures` member.
if (
  target === 'card-signing-input' &&
  value &&
  typeof value === 'object' &&
  !Array.isArray(value)
) {
  delete (value as Record<string, unknown>).signatures;
}

let canonical: string;
try {
  canonical = jcsStringify(value);
} catch {
  process.exit(1);
}
console.log(JSON.stringify({ canonical_utf8_hex: Buffer.from(canonical, 'utf8').toString('hex') }));
