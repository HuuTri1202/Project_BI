import { execFileSync } from 'node:child_process';

/**
 * Dọn bộ đếm chặn dò mật khẩu trước MỖI LƯỢT chạy e2e.
 *
 * ═══ Vì sao cần, và vì sao nó không làm yếu chốt chặn ═══════════════════════
 *
 * Chốt cho 10 lần đăng nhập mỗi 15 phút trên một IP (`middleware/rateLimit.ts`).
 * Mỗi lượt e2e đăng nhập thật một lần, nên chạy lại hơn mười lượt trong 15 phút
 * — đúng việc người ta làm khi đang viết test — là tự khoá mình, và ca đỏ với
 * một lý do KHÔNG liên quan gì tới thứ nó định kiểm. Gặp thật khi viết ca đầu
 * tiên: panel chưa bao giờ hiện, h1 vẫn là "Open Insight", và thông báo
 * "Bạn thao tác quá nhanh" nằm trong ảnh chụp.
 *
 * Bản thân chốt có bộ test riêng (`XT-21` trong `docs/kiem-thu/kich-ban/`), nên
 * dọn ở đây không bỏ trống phép kiểm nào.
 *
 * ═══ Hai khoá, và cái thứ hai mất một lúc mới tìm ra ════════════════════════
 *
 * Khoá là `ratelimit:login:<ip>`, với `<ip>` đúng như Express nhìn thấy:
 *
 *   ratelimit:login:::ffff:127.0.0.1   gọi thẳng vào 4000 bằng IPv4
 *                                      (bộ kịch bản `docs/kiem-thu` đi đường này)
 *   ratelimit:login:::1                qua Vite proxy từ trình duyệt — IPv6 loopback
 *
 * Bộ e2e đi đường thứ hai. Lúc chẩn đoán, kiểm khoá IPv4 thấy TRỐNG nên tưởng
 * không phải rate limit, trong khi khoá `::1` đang giữ. Nên ở đây xoá theo MẪU,
 * không liệt kê tay: đường vào có thể đổi, và một khoá bị bỏ sót sẽ hiện ra
 * dưới dạng một ca đỏ chập chờn.
 */
async function globalSetup(): Promise<void> {
  try {
    // `--scan` thay vì `KEYS`: không chặn Redis, và ở đây số khoá rất nhỏ.
    const khoa = execFileSync(
      'docker',
      [
        'exec',
        'bi-redis',
        'redis-cli',
        '-a',
        'redispassword',
        '--no-auth-warning',
        '--scan',
        '--pattern',
        'ratelimit:login:*',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((d) => d.trim())
      .filter((d) => d !== '');

    if (khoa.length === 0) return;

    execFileSync(
      'docker',
      ['exec', 'bi-redis', 'redis-cli', '-a', 'redispassword', '--no-auth-warning', 'DEL', ...khoa],
      { stdio: 'ignore' },
    );
    console.log(`[e2e] đã dọn ${String(khoa.length)} bộ đếm đăng nhập`);
  } catch {
    // Không với tới được Redis thì vẫn chạy: nếu đó là vấn đề thật, ca test sẽ
    // đỏ kèm thông báo của chính nó, rõ hơn một lỗi docker ở đây.
  }
}

export default globalSetup;
