import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['dist/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', require: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.cjs', 'tools/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Browser tests run some callbacks inside the page through Playwright.
    files: ['tests/ui.test.cjs'],
    languageOptions: { globals: { ...globals.browser, RaceLab: 'readonly', RaceModel: 'readonly' } },
  },
];
