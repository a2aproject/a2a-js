import { googleAI } from '@genkit-ai/google-genai';
import { genkit } from 'genkit';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-flash-latest'),
  promptDir: dirname(fileURLToPath(import.meta.url)),
});

export { z } from 'genkit';
