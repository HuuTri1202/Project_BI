import nodemailer, { type Transporter } from 'nodemailer';

import { env, isProduction, isTest } from '../../config/env';

/**
 * Gửi email — một cửa duy nhất, ba chế độ.
 *
 * ─── Vì sao có chế độ "in ra log" ───────────────────────────────────────────
 *
 * README từng ghi "chưa có quên mật khẩu vì chưa có SMTP". Câu đó biến một nút
 * thắt CẤU HÌNH thành một tính năng bị cắt: không ai có tài khoản SMTP nên
 * không ai viết luồng, và vì không có luồng nên chẳng ai đi xin SMTP.
 *
 * Cắt nút thắt bằng cách tách hai việc vốn không liên quan: SINH và KIỂM một vé
 * đặt lại mật khẩu là logic của ta, còn ĐƯA lá thư tới hộp thư là việc của nhà
 * cung cấp. Thiếu phần sau thì phần trước vẫn phải chạy được và phải test được.
 *
 * Nên khi chưa khai `SMTP_HOST`, `guiMail` in toàn bộ lá thư ra console kèm
 * đường liên kết. Người dev copy liên kết đó, dán vào trình duyệt, và đi hết
 * luồng y như người dùng thật.
 *
 * ─── Ba chế độ ──────────────────────────────────────────────────────────────
 *
 *   'smtp'    Có SMTP_HOST -> gửi thật.
 *   'log'     Không có SMTP_HOST, và KHÔNG phải production -> in ra console.
 *   'tat'     Không có SMTP_HOST, ở production -> NÉM lỗi.
 *
 * Chế độ thứ ba là chỗ quan trọng: log ở production thường được gom về một nơi
 * mà cả đội đọc được. In một vé đặt lại mật khẩu vào đó là phát quyền chiếm tài
 * khoản cho bất kỳ ai mở log lên xem. Thà hỏng ồn ào lúc khởi động còn hơn.
 */

export interface Thu {
  to: string;
  subject: string;
  /** Bản chữ thuần. Bắt buộc — nhiều hộp thư doanh nghiệp chặn HTML. */
  text: string;
  html?: string;
}

export type CheDoMail = 'smtp' | 'log' | 'tat';

export function cheDoMail(): CheDoMail {
  if (env.SMTP_HOST !== undefined) return 'smtp';
  return isProduction ? 'tat' : 'log';
}

/**
 * Transporter dựng LƯỜI và giữ lại.
 *
 * nodemailer gộp chung kết nối (pool tắt mặc định nhưng vẫn tái dùng cấu hình),
 * và dựng lại mỗi lần gửi là mỗi lần bắt tay TLS lại từ đầu. Dựng lười chứ
 * không dựng lúc nạp module: máy chạy test không có SMTP nào cả, và một lần
 * `createTransport` lúc import sẽ chạy trong mọi bài test dù không bài nào gửi
 * thư.
 */
let transporter: Transporter | null = null;

function layTransporter(): Transporter {
  if (transporter !== null) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    // 587 là cổng submission chuẩn (STARTTLS). Đặt mặc định ở đây chứ không ở
    // schema env để `SMTP_PORT` giữ đúng nghĩa "chưa khai" khi vắng mặt.
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE === 'true',
    auth:
      env.SMTP_USER === undefined
        ? undefined
        : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' },
  });

  return transporter;
}

/** Chỉ dùng trong test — thả transporter để bài sau dựng lại từ env mới. */
export function resetMailer(): void {
  transporter = null;
}

function nguoiGui(): string {
  return env.MAIL_FROM ?? env.SMTP_USER ?? 'no-reply@open-insight.local';
}

export async function guiMail(thu: Thu): Promise<void> {
  const che = cheDoMail();

  if (che === 'tat') {
    throw new Error(
      'Chưa cấu hình SMTP_HOST. Ở production, hệ thống KHÔNG in thư ra log — ' +
        'xem ghi chú ở services/mail/mailer.ts.',
    );
  }

  if (che === 'log') {
    // `isTest` thì im lặng: bộ test gọi luồng này hàng chục lần và một bức
    // tường chữ giữa các dòng kết quả chỉ làm người ta thôi đọc kết quả.
    if (!isTest) {
      console.info(
        [
          '',
          '┌─ THƯ (chế độ log — chưa cấu hình SMTP_HOST) ───────────────────────',
          `│ Tới    : ${thu.to}`,
          `│ Từ     : ${nguoiGui()}`,
          `│ Chủ đề : ${thu.subject}`,
          '├────────────────────────────────────────────────────────────────────',
          ...thu.text.split('\n').map((d) => `│ ${d}`),
          '└────────────────────────────────────────────────────────────────────',
          '',
        ].join('\n'),
      );
    }
    return;
  }

  await layTransporter().sendMail({
    from: nguoiGui(),
    to: thu.to,
    subject: thu.subject,
    text: thu.text,
    ...(thu.html === undefined ? {} : { html: thu.html }),
  });
}
