import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Nơi MinIO nghe khi chạy dev — trình duyệt gọi THẲNG vào đây.
 *
 * Tệp tải lên đi bằng presigned URL, không qua Express (§7.4), nên origin này
 * phải nằm trong `connect-src`; thiếu nó thì CSP chặn và lỗi hiện ra dưới dạng
 * "tải lên thất bại" không rõ nguyên nhân.
 *
 * Khớp `MINIO_API_PORT` trong `infrastructure/.env` (mặc định 9000). Đổi cổng
 * đó thì đổi cả ở đây. Production không dùng hằng này — xem Caddyfile.
 */
const MINIO_DEV = 'http://localhost:9000';

/**
 * Header an toàn cho TRANG HTML.
 *
 * ═══ Vì sao không để `helmet()` lo ═════════════════════════════════════════
 *
 * `helmet()` gắn header cho phản hồi của Express, và Express chỉ trả JSON. Thứ
 * trình duyệt MỞ — nhúng được vào iframe, chạy được script — là trang do Vite
 * hoặc Caddy phục vụ. `X-Frame-Options` trên một endpoint JSON không bảo vệ
 * điều gì: không ai nhúng `/health` vào iframe để lừa người dùng bấm.
 *
 * ═══ Từng chỉ thị, và vì sao ═══════════════════════════════════════════════
 *
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY` — CÙNG một việc, giữ cả
 *   hai: `frame-ancestors` là chuẩn hiện hành và thắng khi cả hai cùng có, còn
 *   XFO là đường lui cho trình duyệt cũ không hiểu CSP cấp 2.
 *
 * - `script-src 'self'` + Google — chốt chính chống XSS. React đã tự escape mọi
 *   chuỗi đưa vào JSX, nên một payload `<img onerror>` chỉ hiện ra dưới dạng
 *   chữ; dòng này là lớp thứ hai cho ngày ai đó viết một
 *   `dangerouslySetInnerHTML` mới. `https://accounts.google.com` vì nút đăng
 *   nhập Google nạp `gsi/client` từ đó (`features/auth/NutGoogle.tsx`).
 *
 * - `'unsafe-inline'` cho `script-src` CHỈ ở dev: `@vitejs/plugin-react` chèn
 *   một đoạn script inline vào `index.html` để bật React Refresh. Bản build
 *   production không có nó, nên ở đó chỉ thị này KHÔNG có — đó là điểm khác
 *   nhau quan trọng nhất giữa hai bản, và cũng là lý do phải thử tấn công trên
 *   bản build chứ không chỉ trên dev.
 *
 * - `style-src 'unsafe-inline'` ở CẢ HAI: Tailwind v4 bơm thẻ `<style>` lúc
 *   chạy, và `vega-tooltip` cũng làm vậy (`style.innerHTML` trong `Handler.ts`).
 *   Bỏ nó là mất sạch giao diện. Rủi ro thấp hơn hẳn script: CSS không chạy mã.
 *
 * - `object-src 'none'` — chặn `<object>`/`<embed>`, đường chạy Flash/PDF
 *   plugin cũ mà không trang nào ở đây cần.
 *
 * - `base-uri 'self'` — chặn `<base href>` bị chèn để đổi đích của mọi URL
 *   tương đối, một cách lách `script-src 'self'` rất hay bị quên.
 *
 * - `img-src ... blob:` — `modern-screenshot` dựng ảnh xuất báo cáo qua canvas
 *   rồi `URL.createObjectURL` (`features/reports/export/chupBaoCao.ts`).
 *
 * ⚠️ Khối này là bản SONG SINH của khối `header` trong `infrastructure/Caddyfile`.
 * Hai bên phải nói cùng một chính sách; lệch nhau thì lỗi chỉ lộ ra ở
 * production, nơi không còn ai ngồi thử tấn công nữa.
 */
function capHeaderAnToan({ dev, api }: { dev: boolean; api: string }): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    // Hai dòng chống nhúng. `'none'` chứ không `'self'`: app này không tự nhúng
    // chính nó ở đâu cả, nên không có gì để mất.
    "frame-ancestors 'none'",
    `script-src 'self' https://accounts.google.com${dev ? " 'unsafe-inline'" : ''}`,
    // `accounts.google.com`: nút đăng nhập Google nạp thêm MỘT stylesheet
    // (`/gsi/style`) ngoài script. ĐO ĐƯỢC — thiếu nó thì console báo
    // "Loading the stylesheet 'https://accounts.google.com/gsi/style' violates…"
    // và nút hiện ra không có định dạng. Một trang chỉ thử `script-src` sẽ
    // không bao giờ thấy lỗi này.
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Google: iframe của One Tap + lượt gọi lấy khoá công khai.
    'frame-src https://accounts.google.com',
    [
      "connect-src 'self' https://accounts.google.com",
      // Dev: websocket của Vite HMR, backend qua proxy, và MinIO gọi thẳng.
      dev ? `ws://localhost:5173 ${api} ${MINIO_DEV}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  ].join('; ');

  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

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
      /*
       * ═══ Header an toàn cho TRANG HTML ═════════════════════════════════════
       *
       * ⚠️ `helmet()` ở backend KHÔNG che được trang này. Nó gắn header cho phản
       * hồi của Express, mà Express chỉ trả JSON — còn thứ trình duyệt MỞ, nhúng
       * được vào iframe và chạy script, là trang do Vite (dev) hoặc Caddy
       * (production) phục vụ. Hai tầng khác nhau, và tầng thứ hai trước đây
       * không có một header nào.
       *
       * ĐÃ TÁI HIỆN 24/11/2026: một trang ở `localhost:8899` nhúng
       * `localhost:5173` vào iframe và toàn bộ màn đăng nhập hiện ra bên trong,
       * nút mồi đè đúng lên ô mật khẩu. Không có dòng "Refused to display" nào.
       *
       * Khối này là bản SONG SINH của khối header trong `infrastructure/Caddyfile`.
       * Sửa một bên thì phải sửa bên kia — khác nhau thì lỗi chỉ lộ ra ở
       * production, nơi không ai thử tấn công nữa.
       */
      headers: capHeaderAnToan({ dev: true, api: apiTarget }),
      // Proxy khi dev -> gọi /api/... và /health từ frontend không dính CORS.
      proxy: {
        '/api': proxyToBackend,
        '/health': proxyToBackend,
      },
    },
    build: {
      outDir: 'dist',
      /*
       * TẮT ở bản phát hành — đo được: 69 file `.map`, `dist` từ 12MB còn ~3MB.
       *
       * Source map là TOÀN BỘ mã nguồn frontend ở dạng đọc được: mở devtools là
       * thấy đủ cây `src/`, kèm mọi chú thích và tên biến. Với một sản phẩm có
       * phần quản trị và phân quyền thì đó là bản đồ miễn phí cho người đi dò.
       *
       * Đổi lại: stack trace từ trình duyệt thành tên hàm đã rút gọn. Cần đọc
       * một lỗi production thật thì bật `'hidden'` — vẫn sinh file map nhưng
       * KHÔNG nhúng `sourceMappingURL`, nên trình duyệt người dùng không tải,
       * còn ta thì nạp tay vào devtools được.
       */
      sourcemap: false,
    },
  };
});
