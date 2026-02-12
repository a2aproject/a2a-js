import { typescript } from '@betterer/typescript';

export default {
  'TypeScript Strict Mode': () =>
    typescript('./tsconfig.json', {
      strict: true,
    }).include('./src/**/*.ts', './tck/**/*.ts'),
};
