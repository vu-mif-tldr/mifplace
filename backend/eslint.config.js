import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { ignores, rules } from '../eslint.shared.mjs';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Explicit for every file, because the IDE lints backend and mcp in one process.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
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
