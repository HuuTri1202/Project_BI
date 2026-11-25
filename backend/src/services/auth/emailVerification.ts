import { APP_NAME } from '@bi/shared';
import { createHash, randomBytes } from 'node:crypto';

import { env } from '../../config/env';
import * as vesRepo from '../../repositories/emailVerifications';
import * as usersRepo from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import { guiMail } from '../mail/mailer';

/**
 * Xác minh email — §1.10.
 *
 * ═══ Vì sao tính năng này tồn tại ══════════════════════════════════════════
 *
 * Tới migration 41, cột `users.email_verified_at` có trong schema nhưng không
 * ai ghi và không ai đọc. Nghĩa là quyền sở hữu một tài khoản không dựa trên
 * gì: ai cũng đăng ký được bằng email của người khác. Lý lẽ đầy đủ, kèm đường
 * tấn công pre-hijacking mà việc này chặn, nằm ở migration 42.
 *
 * ═══ Lá thư NÀY là một lớp phòng thủ, không chỉ là một thủ tục ══════════════
 *
 * Pre-hijacking sống được nhờ IM LẶNG. Khi kẻ tấn công đăng ký bằng email của
 * người khác, lá thư này đi tới hộp thư của NGƯỜI THẬT — nên nạn nhân biết ngay
 * trong vòng vài giây, chứ không phải sau khi đã nạp dữ liệu công ty lên.
 *
 * Vì vậy thân thư phải nói rõ TÀI KHOẢN NÀO vừa được tạo (họ tên, công ty) và
 * phải cảnh báo đừng bấm nếu không tự đăng ký. Đó không phải câu chữ lịch sự —
 * đó là thứ duy nhất phân biệt được "tôi vừa đăng ký" với "có người vừa đăng ký
 * bằng email của tôi", vì hệ thống thì không phân biệt được.
 *
 * ⚠️ RỦI RO CÒN LẠI, nói thẳng: một người bấm liên kết trong lá thư về một tài
 * khoản họ KHÔNG tạo sẽ xác minh hộ kẻ tấn công, và mật khẩu của kẻ đó sống lại.
 * Chặn hẳn việc này đòi bước xác minh phải kiêm luôn việc ĐẶT mật khẩu — tức
 * `/register` không nhận mật khẩu nữa, và trang đăng ký phải làm lại. Đã cân và
 * để ngoài phạm vi; cảnh báo trong thân thư là phần bù.
 *
 * ponytail: cảnh báo trong thư thay cho "đặt mật khẩu lúc xác minh"; nâng lên
 * khi nào trang đăng ký bỏ ô mật khẩu.
 */

/** Cùng một câu cho mọi kết cục của `resend` — xem `yeuCauGuiLai`. */
export const DA_GUI_NEU_CAN =
  'Nếu email này có tài khoản chưa xác minh, chúng tôi vừa gửi lại liên kết xác minh. Kiểm tra cả hộp thư rác.';

const SO_BYTE_VE = 32;

export function bamVe(ve: string): string {
  return createHash('sha256').update(ve).digest('hex');
}

function duongDanXacMinh(ve: string): string {
  // Dùng CORS_ORIGIN — nó đã là địa chỉ frontend, bắt buộc khai, và đã được zod
  // kiểm là URL. Y như `passwordReset.ts`; thêm một biến APP_URL nữa chỉ tạo
  // thêm một cặp phải nhớ đồng bộ bằng tay.
  const base = env.CORS_ORIGIN.replace(/\/+$/, '');
  return `${base}/xac-minh-email?token=${encodeURIComponent(ve)}`;
}

interface NguoiNhan {
  id: number;
  email: string;
  fullName: string;
}

/**
 * Phát vé mới và gửi thư.
 *
 * KHÔNG bắt lỗi gửi thư ở đây. Nơi gọi quyết định: `/register` thì bỏ qua (tài
 * khoản đã tạo xong, không được rollback vì một lá thư), còn `resend` thì để
 * lỗi nổi lên vì người dùng đang CHỜ chính lá thư đó.
 */
export async function guiVeXacMinh(nguoi: NguoiNhan, tenCongTy?: string): Promise<void> {
  const ve = randomBytes(SO_BYTE_VE).toString('base64url');
  const hetHan = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);

  await vesRepo.vohieuVeCu(nguoi.id);
  await vesRepo.taoVe(nguoi.id, bamVe(ve), hetHan);

  const lienKet = duongDanXacMinh(ve);
  await guiMail({
    to: nguoi.email,
    subject: `Xác minh email cho tài khoản ${APP_NAME}`,
    text: [
      `Chào ${nguoi.fullName},`,
      '',
      `Một tài khoản ${APP_NAME} vừa được tạo với email ${nguoi.email}:`,
      '',
      `    Họ tên:  ${nguoi.fullName}`,
      ...(tenCongTy === undefined ? [] : [`    Công ty: ${tenCongTy}`]),
      '',
      'Mở liên kết dưới đây để xác minh email và bắt đầu dùng tài khoản:',
      '',
      lienKet,
      '',
      `Liên kết sống ${env.EMAIL_VERIFICATION_TTL_HOURS} giờ và chỉ dùng được một lần.`,
      '',
      '⚠️ NẾU BẠN KHÔNG TỰ ĐĂNG KÝ tài khoản này, ĐỪNG bấm vào liên kết trên.',
      'Có người đã dùng email của bạn để đăng ký. Chưa xác minh thì tài khoản đó',
      'không đăng nhập được, nên bỏ qua thư này là đủ để nó vô hiệu.',
      '',
      `— ${APP_NAME}`,
    ].join('\n'),
  });
}

/**
 * Người dùng bấm "gửi lại thư xác minh".
 *
 * ═══ Luật số một, y như `forgot-password`: KHÔNG tiết lộ email nào có ═══════
 *
 * Trả về CÙNG MỘT câu cho email không tồn tại, email đã xác minh rồi, và email
 * có tài khoản chưa xác minh. Phân biệt là biến endpoint này thành máy dò danh
 * sách khách hàng — đúng thứ `/login` và `/forgot-password` đã cẩn thận tránh.
 *
 * Tài khoản ĐÃ xác minh cũng dừng ở đây mà không gửi gì: gửi thêm một lá thư
 * xác minh cho người đã xác minh chỉ làm họ tưởng tài khoản có vấn đề.
 */
export async function yeuCauGuiLai(email: string): Promise<void> {
  const found = await usersRepo.findByEmailForLogin(email);
  if (!found || !found.user.isActive || found.user.emailVerifiedAt !== null) return;

  await guiVeXacMinh(found.user);
}

/**
 * Tra một vé và trả về chủ của nó.
 *
 * Ba lý do hỏng được phân biệt rõ, và điều đó KHÔNG rò rỉ gì: người cầm vé đã
 * có nó trong tay, câu trả lời chỉ nói về chính cái vé đó. Gộp cả ba thành
 * "liên kết không hợp lệ" là bỏ đói người dùng đúng lúc họ cần biết nên bấm lại
 * hay đi xin liên kết mới.
 */
async function traVe(ve: string): Promise<vesRepo.VeXacMinh> {
  const found = await vesRepo.timTheoBam(bamVe(ve));

  if (!found) {
    throw new HttpError(
      400,
      'VerifyTokenInvalid',
      'Liên kết xác minh không đúng. Hãy yêu cầu một liên kết mới.',
    );
  }

  if (found.usedAt !== null) {
    throw new HttpError(
      410,
      'VerifyTokenUsed',
      'Liên kết này đã được dùng rồi. Email của bạn có thể đã xác minh — hãy thử đăng nhập.',
    );
  }

  if (found.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(
      410,
      'VerifyTokenExpired',
      'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới ở trang đăng nhập.',
    );
  }

  return found;
}

/**
 * Xác minh email bằng vé.
 *
 * Thứ tự CÓ Ý NGHĨA: chiếm vé TRƯỚC, đánh dấu email SAU — y như
 * `datLaiMatKhau`. `danhDauDaDung` chỉ thành công với một trong các request
 * đồng thời, nên hai lần bấm liên kết trong cùng một nhịp không ghi hai lần.
 */
export async function xacMinhBangVe(ve: string): Promise<void> {
  const found = await traVe(ve);

  const chiemDuoc = await vesRepo.danhDauDaDung(found.id);
  if (!chiemDuoc) {
    throw new HttpError(
      410,
      'VerifyTokenUsed',
      'Liên kết này vừa được dùng. Email của bạn có thể đã xác minh — hãy thử đăng nhập.',
    );
  }

  await usersRepo.markEmailVerified(found.userId);
}
