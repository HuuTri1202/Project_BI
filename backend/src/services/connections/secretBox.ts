import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Mã hoá mật khẩu CSDL của khách hàng.
 *
 * ─── Vì sao KHÔNG dùng bcrypt như mật khẩu người dùng ───────────────────────
 *
 * Hai bài toán khác hẳn nhau, và nhầm lẫn giữa chúng là lỗi kinh điển:
 *
 *   Mật khẩu người dùng  -> chỉ cần TRẢ LỜI "có khớp không"  -> băm một chiều
 *   Mật khẩu CSDL nguồn  -> phải LẤY LẠI ĐƯỢC để mở kết nối  -> mã hoá đối xứng
 *
 * Nên ở đây là AES chứ không phải bcrypt. Hệ quả phải chấp nhận và nói ra: ai
 * đọc được cả database LẪN `CONNECTION_ENCRYPTION_KEY` thì đọc được mọi mật
 * khẩu. Lớp này chống việc rò rỉ MỘT MÌNH database (dump SQL, backup lạc, một
 * lỗi SQL injection ở nơi khác) — nó không chống được kẻ đã vào tới máy chủ.
 *
 * ─── Vì sao GCM chứ không CBC ───────────────────────────────────────────────
 *
 * GCM có thẻ xác thực (auth tag). Sửa một byte trong bản mã thì `final()` NÉM
 * LỖI. Với CBC, cùng thao tác đó cho ra một chuỗi rác trông như mật khẩu, và ta
 * sẽ mang nó đi mở kết nối rồi báo "sai mật khẩu" — che mất việc dữ liệu đã bị
 * can thiệp.
 *
 * ─── Định dạng lưu trữ ──────────────────────────────────────────────────────
 *
 *   v1.<iv>.<authTag>.<ciphertext>      (mỗi phần base64url)
 *
 * Tiền tố phiên bản có mặt ngay từ bản đầu vì thêm nó SAU thì bất khả thi: lúc
 * đó trong bảng đã có hàng loạt chuỗi không tự khai mình thuộc định dạng nào.
 * Khi cần xoay khoá hoặc đổi thuật toán, `v2.` sống song song với `v1.` và việc
 * di trú thành đọc-giải-mã-hoá-lại từng dòng.
 *
 * Dấu chấm làm dấu phân tách chứ không phải dấu hai chấm: base64url không sinh
 * ra ký tự `.`, nên tách chuỗi không bao giờ nhầm.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
/** GCM khuyến nghị IV 96 bit — đúng kích thước mà chuẩn NIST tối ưu cho. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Khoá đọc một lần lúc nạp module.
 *
 * `env` đã validate độ dài chuỗi base64, nhưng độ dài SAU KHI GIẢI MÃ mới là
 * thứ quyết định — và đó là bất biến của module này, nên kiểm ở đây. Sai khoá
 * thì process chết lúc boot, không phải lúc admin đầu tiên bấm Lưu kết nối.
 */
const key = (() => {
  const raw = Buffer.from(env.CONNECTION_ENCRYPTION_KEY, 'base64');
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `CONNECTION_ENCRYPTION_KEY phải giải mã base64 ra đúng ${KEY_BYTES} byte, ` +
        `hiện là ${raw.length}. Sinh khoá mới bằng: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return raw;
})();

/** Mã hoá một chuỗi bí mật để ghi xuống cột `connections.password_cipher`. */
export function seal(plaintext: string): string {
  // IV mới cho MỖI lần mã hoá. Dùng lại IV với GCM không chỉ làm lộ việc hai
  // bản rõ giống nhau — nó phá vỡ hoàn toàn phần xác thực và cho phép khôi phục
  // khoá xác thực. Đây là cách sai duy nhất có thể giết cả thuật toán.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(body)].join('.');
}

/**
 * Giải mã chuỗi đã lưu.
 *
 * Ném lỗi khi định dạng sai, phiên bản lạ, hoặc thẻ xác thực không khớp — tất
 * cả đều là "dữ liệu này không tin được", và nuốt lỗi ở đây nghĩa là mang một
 * mật khẩu rác đi mở kết nối rồi báo nhầm thành "sai mật khẩu".
 */
export function open(sealed: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4) {
    throw new Error('Chuỗi mã hoá sai định dạng.');
  }

  const [version, ivPart, tagPart, bodyPart] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`Không hỗ trợ phiên bản mã hoá '${version}'.`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}
