import { APP_NAME } from '@bi/shared';
import { createHash, randomBytes } from 'node:crypto';

import { env } from '../../config/env';
import * as resetsRepo from '../../repositories/passwordResets';
import * as usersRepo from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import { guiMail } from '../mail/mailer';
import { hashPassword } from './password';

/**
 * Quên mật khẩu — sinh vé, gửi thư, đổi mật khẩu.
 *
 * ═══ Luật số một: KHÔNG tiết lộ email nào có trong hệ thống ══════════════════
 *
 * `POST /auth/forgot-password` trả về CÙNG MỘT phản hồi cho email có thật, email
 * không tồn tại, và tài khoản đã bị khoá. Nếu phân biệt, bất kỳ ai cũng gõ được
 * một danh sách email vào đó để biết ai là khách hàng của hệ thống — đúng loại
 * rò rỉ mà `POST /login` đã cẩn thận tránh bằng một thông báo lỗi duy nhất.
 *
 * Cái giá phải trả là người gõ nhầm email sẽ ngồi chờ một lá thư không bao giờ
 * tới. Bù lại bằng câu chữ ở màn hình: nói rõ "nếu email này có tài khoản" chứ
 * không nói "đã gửi".
 *
 * ═══ Vé trông như thế nào ═══════════════════════════════════════════════════
 *
 * 32 byte từ `randomBytes` -> base64url -> 43 ký tự. Không dùng `randomUUID`:
 * UUIDv4 chỉ có 122 bit ngẫu nhiên và mang cả phiên bản lẫn biến thể trong
 * chuỗi. 256 bit thì không ai dò được, kể cả khi vé sống một giờ.
 *
 * Database chỉ giữ SHA-256 của nó — xem ghi chú ở migration 36.
 */

/** Cùng một câu cho mọi kết cục, xem luật số một ở trên. */
export const DA_GUI_NEU_CO =
  'Nếu email này có tài khoản, chúng tôi vừa gửi hướng dẫn đặt lại mật khẩu. Kiểm tra cả hộp thư rác.';

const SO_BYTE_VE = 32;

export function bamVe(ve: string): string {
  return createHash('sha256').update(ve).digest('hex');
}

/*
 * ─── Vì sao KHÔNG có phép so sánh thời-gian-hằng-định ở đây ─────────────────
 *
 * Tra vé bằng `WHERE token_hash = ?`, tức để chỉ mục của MySQL so khớp. Cách
 * viết "an toàn" quen thuộc là đọc hết rồi so bằng `timingSafeEqual`, nhưng ở
 * đây nó không mua được gì: thứ đem so là BĂM SHA-256 của một chuỗi 256 bit
 * ngẫu nhiên. Muốn khai thác rò rỉ thời gian, kẻ tấn công phải đoán được băm
 * theo từng byte rồi từ băm tìm ngược ra vé — cả hai đều là bài toán không giải
 * được, chứ không phải bài toán chậm.
 *
 * Ghi ra đây vì thiếu `timingSafeEqual` ở một file về mật khẩu trông như một
 * thiếu sót, và người đọc sau xứng đáng biết đó là lựa chọn chứ không phải quên.
 */

function duongDanDatLai(ve: string): string {
  // Dùng CORS_ORIGIN chứ không thêm một biến APP_URL nữa: nó đã là địa chỉ của
  // frontend, bắt buộc phải khai, và đã được zod kiểm là URL hợp lệ. Thêm biến
  // thứ hai chỉ tạo thêm một cặp phải nhớ đồng bộ bằng tay.
  const base = env.CORS_ORIGIN.replace(/\/+$/, '');
  return `${base}/dat-lai-mat-khau?token=${encodeURIComponent(ve)}`;
}

/**
 * Nhận yêu cầu quên mật khẩu.
 *
 * KHÔNG ném khi email không tồn tại — xem luật số một. Chỉ ném khi không gửi
 * được thư, vì khi đó im lặng sẽ để người dùng chờ mãi một thứ ta biết chắc
 * không bao giờ tới.
 */
export async function yeuCauDatLai(email: string): Promise<void> {
  const found = await usersRepo.findByEmailForLogin(email);

  // Tài khoản bị khoá cũng dừng ở đây. Đặt lại mật khẩu rồi vẫn không đăng nhập
  // được (login chặn `isActive`), nên lá thư chỉ tạo một vòng loay hoay.
  if (!found || !found.user.isActive) return;

  const ve = randomBytes(SO_BYTE_VE).toString('base64url');
  const hetHan = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);

  await resetsRepo.vohieuVeCu(found.user.id);
  await resetsRepo.taoVe(found.user.id, bamVe(ve), hetHan);

  const lienKet = duongDanDatLai(ve);
  await guiMail({
    to: found.user.email,
    subject: `Đặt lại mật khẩu ${APP_NAME}`,
    text: [
      `Chào ${found.user.fullName},`,
      '',
      `Có người vừa yêu cầu đặt lại mật khẩu cho tài khoản ${found.user.email}.`,
      'Mở liên kết dưới đây để đặt mật khẩu mới:',
      '',
      lienKet,
      '',
      `Liên kết sống ${env.PASSWORD_RESET_TTL_MINUTES} phút và chỉ dùng được một lần.`,
      '',
      'Nếu bạn không yêu cầu việc này, bỏ qua thư này — mật khẩu hiện tại của bạn',
      'không đổi, và không ai biết bạn đã nhận thư.',
      '',
      `— ${APP_NAME}`,
    ].join('\n'),
  });
}

/**
 * Tra một vé và trả về chủ của nó.
 *
 * Ba lý do hỏng được phân biệt rõ trong thông báo, và điều đó KHÔNG rò rỉ gì:
 * người cầm vé đã có nó trong tay rồi, câu trả lời chỉ nói về chính cái vé đó.
 * Gộp cả ba thành "liên kết không hợp lệ" là bỏ đói người dùng đúng lúc họ cần
 * biết nên bấm lại hay đi xin liên kết mới.
 */
async function traVe(ve: string): Promise<resetsRepo.VeDatLai> {
  const found = await resetsRepo.timTheoBam(bamVe(ve));

  if (!found) {
    throw new HttpError(
      400,
      'ResetTokenInvalid',
      'Liên kết đặt lại mật khẩu không đúng. Hãy yêu cầu một liên kết mới.',
    );
  }

  if (found.usedAt !== null) {
    throw new HttpError(
      410,
      'ResetTokenUsed',
      'Liên kết này đã được dùng rồi. Nếu bạn chưa đổi mật khẩu, hãy yêu cầu liên kết mới.',
    );
  }

  if (found.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(
      410,
      'ResetTokenExpired',
      'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.',
    );
  }

  return found;
}

/** Kiểm vé trước khi dựng form — để người dùng khỏi gõ mật khẩu vào một link chết. */
export async function kiemVe(ve: string): Promise<void> {
  await traVe(ve);
}

/**
 * Đổi mật khẩu bằng vé.
 *
 * Thứ tự CÓ Ý NGHĨA: chiếm vé TRƯỚC, đổi mật khẩu SAU.
 *
 * `danhDauDaDung` chỉ thành công với đúng một trong các request đồng thời (xem
 * ghi chú ở repository). Nếu đổi mật khẩu trước rồi mới đánh dấu, hai request
 * song song sẽ cùng ghi mật khẩu — và người dùng nhận về mật khẩu của request
 * nào tới sau, không phải cái họ vừa gõ.
 */
export async function datLaiMatKhau(ve: string, matKhauMoi: string): Promise<void> {
  const found = await traVe(ve);

  const chiemDuoc = await resetsRepo.danhDauDaDung(found.id);
  if (!chiemDuoc) {
    throw new HttpError(
      410,
      'ResetTokenUsed',
      'Liên kết này vừa được dùng. Nếu bạn chưa đổi mật khẩu, hãy yêu cầu liên kết mới.',
    );
  }

  // `mustChangePassword = false`: người vừa tự đặt mật khẩu thì không còn lý do
  // nào bắt họ đổi lại ở màn hình kế tiếp. Đây cũng là đường thoát cho tài khoản
  // được Admin cấp mật khẩu tạm rồi quên mất nó.
  await usersRepo.updatePassword(found.userId, await hashPassword(matKhauMoi), false);
}
