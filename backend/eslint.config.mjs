import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 "flat config".
 *
 * Cố ý KHÔNG bật bộ rule cần type-information (`recommendedTypeChecked`):
 * lỗi kiểu đã do `npm run typecheck` bắt, còn ESLint ở đây chỉ lo lỗi logic và
 * quy ước. Đổi lại lint chạy nhanh và không phụ thuộc trạng thái tsconfig.
 *
 * `eslint-config-prettier` phải đứng CUỐI để tắt các rule format đụng Prettier.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Tham số/biến bắt đầu bằng "_" là cố ý không dùng (vd: _next của
      // Express error handler, vốn bắt buộc phải có đủ 4 tham số).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  prettier,
);
