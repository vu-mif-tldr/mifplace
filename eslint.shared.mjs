// Shared parts of the backend and frontend ESLint configs. No imports on purpose:
// dependencies (@eslint/js, typescript-eslint) must resolve from the package, not the root.
export const rules = {
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-explicit-any': 'warn',
};

export const ignores = ['dist/**', 'node_modules/**'];
