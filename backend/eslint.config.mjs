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
  /*
   * `tmp/**` — file do MÁY sinh, không phải mã của ta.
   *
   * Lane test ghi cube schema vào `tmp/cube-schema-test/` (xem `CUBE_SCHEMA_DIR`
   * trong `vitest.config.ts`). Chúng là mã Cube.js chạy trong container, nơi
   * `cube()` và `CUBE` là biến toàn cục có sẵn — nên eslint báo `no-undef` cho
   * từng dòng, hàng trăm lỗi, và `npm run lint` đỏ trên mọi máy đã từng chạy
   * test tích hợp. Thư mục cũ nằm ngoài `backend/` nên chưa bao giờ gặp chuyện
   * này; dòng này là phần phải đi kèm lần chuyển thư mục đó.
   */
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'tmp/**'] },

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
