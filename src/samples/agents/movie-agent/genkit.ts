import { googleAI } from '@genkit-ai/google-genai';
import { genkit } from 'genkit';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-3.1-flash-lite'),
  promptDir: dirname(fileURLToPath(import.meta.url)),
});

export { z } from 'genkit';
