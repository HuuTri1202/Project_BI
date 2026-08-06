import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // loadEnv đọc .env / .env.[mode] trong thư mục frontend. Tiền tố '' nghĩa là
  // lấy cả biến không mang tiền tố VITE_ (chỉ dùng ở tầng config, không lộ ra
  // bundle — chỉ biến VITE_* mới được nhúng vào code chạy trên trình duyệt).
  const env = loadEnv(mode, rootDir, '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

  const proxyToBackend = { target: apiTarget, changeOrigin: true };

  return {
    plugins: [react()],
    resolve: {
      // Alias '@' chỉ dùng ở frontend vì Vite giải quyết được lúc bundle.
      // Backend cố ý KHÔNG dùng alias (xem backend/tsconfig.json).
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Proxy khi dev -> gọi /api/... và /health từ frontend không dính CORS.
      proxy: {
        '/api': proxyToBackend,
        '/health': proxyToBackend,
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
