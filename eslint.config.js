'use strict';

const js = require('@eslint/js');
const globals = require('globals');

const ES_VERSION = 2023;

/** Rules shared by server and browser code. */
const sharedRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-shadow': 'error',
  'no-param-reassign': ['error', { props: false }],
  'prefer-template': 'error',
  'object-shorthand': 'error',
  'max-depth': ['error', 4],
  complexity: ['warn', 15],
};

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: ES_VERSION, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { ...sharedRules, 'no-console': 'error', curly: ['error', 'multi-line'] },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { ecmaVersion: ES_VERSION, sourceType: 'module', globals: { ...globals.browser } },
    rules: sharedRules,
  },
  {
    files: ['public/i18n.js'],
    languageOptions: { ecmaVersion: ES_VERSION, sourceType: 'script', globals: { ...globals.browser } },
    rules: sharedRules,
  },
];
