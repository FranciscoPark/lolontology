import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['dist/', '.cache/', 'node_modules/', '.claude/']},
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {ecmaVersion: 2024, sourceType: 'module', globals: globals.browser},
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {ecmaVersion: 2024, sourceType: 'module', globals: globals.node},
  },
  {
    rules: {
      'no-empty': ['error', {allowEmptyCatch: true}],
      'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
