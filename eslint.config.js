// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.angular/',
      '.nx/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'out-tsc/',
      'mockups/',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@angular-eslint/component-class-suffix': ['error', { suffixes: ['Component'] }],
      '@angular-eslint/directive-class-suffix': ['error', { suffixes: ['Directive'] }],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/prefer-standalone': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Decorator[expression.callee.name='Component'] Property[key.name='styleUrls']",
          message:
            'Component CSS is forbidden — use Tailwind classes in the .html (CLAUDE.md > Tailwind only — no component CSS).',
        },
        {
          selector:
            "Decorator[expression.callee.name='Component'] Property[key.name='styleUrl']",
          message:
            'Component CSS is forbidden — use Tailwind classes in the .html (CLAUDE.md > Tailwind only — no component CSS).',
        },
        {
          selector:
            "Decorator[expression.callee.name='Component'] Property[key.name='styles'][value.type='ArrayExpression'][value.elements.length>0]",
          message:
            'Component inline styles are forbidden — use Tailwind classes in the .html. Set `styles: []`.',
        },
        {
          selector: "Decorator[expression.callee.name='Component'] Property[key.name='template']",
          message:
            'Inline component templates are forbidden — use `templateUrl` (CLAUDE.md > Separate template files).',
        },
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Default exports are not allowed; use named exports (CLAUDE.md > Named exports only).',
        },
      ],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
  {
    files: ['bff/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    // Loosen rules for config files at the repo root.
    files: ['*.js', '*.cjs', '*.mjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'readonly', require: 'readonly', process: 'readonly' },
    },
  },
);
