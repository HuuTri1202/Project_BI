import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Config riêng cho test, KHÔNG dùng lại vite.config.ts.
 *
 * Lý do: `vite.config.ts` khai `server.proxy` và `strictPort` — thứ chỉ có nghĩa
 * với dev server thật, và `strictPort` sẽ làm test chết nếu cổng 5173 đang bận.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(rootDir, 'src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    env: {
      // Phải khớp `frontend/.env`. Giá trị cũ '/api/v1' là từ thời auth còn nằm
      // dưới /api/v1; để nguyên thì mọi test mock URL sẽ lệch một cách im lặng —
      // mock không khớp, request thật không xảy ra, và test vẫn xanh vì nó chỉ
      // kiểm cái nó tự dựng ra.
      VITE_API_BASE_URL: '/api',
    },
  },
});
