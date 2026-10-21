// Общие части ESLint-конфигов backend и frontend. Без импортов: зависимости
// (@eslint/js, typescript-eslint) резолвятся из пакета, а не из корня.
export const rules = {
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-explicit-any': 'warn',
};

export const ignores = ['dist/**', 'node_modules/**'];
