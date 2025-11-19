// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginPrettier, // Automatically disables eslint formatting rules and enables `prettier`
  {
    ignores: ['dist/', 'node_modules/', 'src/types.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // Ignore error for unused args and caught errors if with '_' prefix
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'src/samples/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow the usage of `any` in the test files and in samples
      '@typescript-eslint/no-unused-expressions': 'off', // Allow unused expressions in test files, for compatibility with 'chai'
    },
  },
  {
    languageOptions: {
      globals: {
        // Define global variables for Node.js environment
        ...globals.node,
      },
    },
  }
);
