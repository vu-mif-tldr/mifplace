import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// One config for the whole repository. A new package gets its globals in a block below.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'frontend/public/**', 'release/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['backend/**', 'db/**', 'server-lib/**', 'tools/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/**'],
    languageOptions: { globals: globals.browser },
  }
);
