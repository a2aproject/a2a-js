// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier, // Disable formatting eslint rules
  {
    ignores: ['dist/', 'node_modules/']
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow the usage of `any` in the project
      "@typescript-eslint/no-unused-vars": ["error", { 
        // Ignore error for unused args and caught errors if with '_' prefix
        "argsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_",
      }]
    },
  },
  {
    "files": ["test/**/*.spec.ts"],
    "rules": {
      '@typescript-eslint/no-unused-expressions': 'off', // Allow unused expressions in test files, for compatibility with 'chai'
    }
  },
  {
    languageOptions: {
      globals: {
        // Define global variables for Node.js environment
        ...globals.node,
      }
    }
  },
);