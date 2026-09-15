/**
 * ESLint configuration (flat config format).
 *
 * WHY: the project previously had no linter — `npm run lint` only ran
 * `tsc --noEmit`, which checks types but says nothing about React correctness.
 * The most valuable rule here is `react-hooks/exhaustive-deps`: the original
 * App.tsx shipped a `useEffect` with an empty dependency array that read three
 * pieces of state, a classic stale-closure bug that a type checker cannot see.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // Build output and dependencies are never linted.
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'assets/**'],
  },

  // Baseline JavaScript correctness rules.
  js.configs.recommended,

  // TypeScript rules that do not require type information (fast).
  ...tseslint.configs.recommended,

  // React-specific rules for the client source only.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Project-wide rule tuning.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Unused variables are errors, but an underscore prefix marks a
      // deliberate placeholder (e.g. unused callback parameters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is banned in new code; the surviving uses are narrowed over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Catch accidental debugging left in a commit.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  // The server runs in Node and legitimately logs to stdout.
  {
    files: ['server.ts'],
    rules: {
      'no-console': 'off',
    },
  }
);
