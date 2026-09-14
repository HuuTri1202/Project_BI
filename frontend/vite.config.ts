import tailwindcss from '@tailwindcss/vite';
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

  /**
   * Proxy sang backend, và NÓI ĐÚNG khi không nối được.
   *
   * ═══ Vì sao cần `configure` chứ không để mặc định ═══════════════════════════
   *
   * Khi backend chưa bật — hoặc đang khởi động lại, chuyện `tsx watch` làm sau
   * MỖI lần lưu file — http-proxy không nối được và Vite tự trả lời thay:
   *
   *     HTTP/1.1 500 Internal Server Error
   *     Content-Type: text/plain
   *     (thân RỖNG)
   *
   * Với axios thì đó là một phản hồi hợp lệ, nên `getApiError` đi vào nhánh "có
   * response" rồi không tìm thấy `message` nào để đọc — và người dùng nhận đúng
   * câu "Có lỗi không xác định. Vui lòng thử lại.", một câu không dẫn tới bất kỳ
   * hành động nào. Nó xuất hiện *thỉnh thoảng* vì nó chỉ trúng những request bay
   * đúng vào khe một hai giây backend đang restart.
   *
   * Bốn dòng dưới đây đổi câu trả lời đó thành đúng khuôn lỗi của API, nên mọi
   * màn hình hiện nó ra như một lỗi bình thường — có chữ, và chữ đó nói thật.
   *
   * ⚠️ Vite đăng ký handler `error` của nó NGAY SAU khi gọi `configure`, và
   * handler đó có chốt `if (!res.headersSent && !res.writableEnded)`. Nên thứ
   * tự này là thứ làm cả đoạn chạy được: ta ghi trước, Vite thấy đã ghi rồi thì
   * không đè lên nữa (nó vẫn log ra terminal, và log đó vẫn đáng có).
   *
   * ⚠️ 503 chứ không phải 502: backend không hỏng, nó chỉ chưa sẵn sàng và sẽ
   * quay lại sau vài giây. Mã đó cũng là thứ `queryClient` đọc để quyết định
   * thử lại — 5xx thì thử lại, 4xx thì không.
   */
  const proxyToBackend = {
    target: apiTarget,
    changeOrigin: true,
    configure: (proxy: {
      on: (event: 'error', handler: (err: Error, req: unknown, res: unknown) => void) => void;
    }): void => {
      proxy.on('error', (_err, _req, res) => {
        // `res` là Socket khi lỗi xảy ra trên một kết nối WebSocket — không có
        // `writeHead` để mà trả lời bằng HTTP. Bỏ qua, để Vite tự đóng socket.
        const http = res as {
          writeHead?: (code: number, headers: Record<string, string>) => void;
          end?: (chunk: string) => void;
          headersSent?: boolean;
          writableEnded?: boolean;
        };
        if (typeof http.writeHead !== 'function' || typeof http.end !== 'function') return;
        if (http.headersSent === true || http.writableEnded === true) return;

        http.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        http.end(
          JSON.stringify({
            error: 'BackendUnreachable',
            message: `Không nối được tới backend ở ${apiTarget}. Nếu nó đang khởi động lại thì chờ vài giây rồi thử lại; nếu chưa chạy thì mở terminal khác và chạy: npm run dev`,
          }),
        );
      });
    },
  };

  return {
    // Tailwind v4 chạy như plugin Vite: không cần tailwind.config.js, không cần
    // PostCSS, không phải khai `content` globs — nó tự quét source lúc build.
    plugins: [react(), tailwindcss()],
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
