/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2023: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:astro/recommended',
  ],
  ignorePatterns: [
    'dist/',
    '.astro/',
    '.wrangler/',
    'node_modules/',
    'public/assets/vendor/',
    'reference/',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always'],
  },
  overrides: [
    {
      // Astro generates this file's reference directives; they are the
      // supported way to pull in its ambient types.
      files: ['src/env.d.ts'],
      rules: { '@typescript-eslint/triple-slash-reference': 'off' },
    },
    {
      files: ['*.astro'],
      parser: 'astro-eslint-parser',
      parserOptions: { parser: '@typescript-eslint/parser', extraFileExtensions: ['.astro'] },
    },
  ],
};
