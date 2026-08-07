import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Giống cấu hình của backend, chỉ khác phần globals: code ở đây chạy CẢ trên
 * Node lẫn trong trình duyệt, nên không được phép dùng API riêng của một bên
 * (`process`, `window`, `document`...). Chỉ khai `globals.es2022` để ESLint báo
 * lỗi ngay nếu ai đó lỡ tay.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.es2022, TextEncoder: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  prettier,
);
