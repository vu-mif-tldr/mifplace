import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { ignores, rules } from '../eslint.shared.mjs';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules,
  },
  {
    ignores,
  }
);
