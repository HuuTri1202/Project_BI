import { createHash, randomBytes } from 'node:crypto';

import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as sharesRepo from '../../repositories/reportShares';
import { HttpError } from '../../utils/httpError';

/**
 * Liên kết xem báo cáo cho người KHÔNG có tài khoản — mong muốn D5.
 *
 * ═══ Đây là bề mặt KHÔNG XÁC THỰC đầu tiên của hệ thống ════════════════════
 *
 * Mọi route khác đều đứng sau `authenticate` + `requireFreshMembership`, nên
 * câu hỏi "người này được xem gì" luôn có một phiên để trả lời. Ở đây không có
 * phiên nào, nên toàn bộ phạm vi phải đến từ CHÍNH dòng liên kết:
 *
 *   · `tenant_id` và `report_id` đọc từ dòng, KHÔNG nhận từ client. Đường dẫn
 *     công khai chỉ mang một thứ duy nhất là chuỗi bí mật — không có tham số
 *     nào khác để ai đó đổi sang báo cáo của tổ chức khác.
 *   · chuỗi dài 32 byte ngẫu nhiên, database chỉ giữ SHA-256 (migration 45).
 *   · thu hồi và hết hạn kiểm ở ĐÂY, một chỗ, cho mọi nơi gọi.
 *
 * ═══ Vì sao chuỗi 32 byte, không phải một id ngắn ══════════════════════════
 *
 * Đường dẫn này sẽ bị dán vào Zalo, vào email, vào tin nhắn — tức là nó sẽ nằm
 * ở những nơi ta không kiểm soát. 256 bit nghĩa là không ai dò ra được bằng
 * cách thử, kể cả khi liên kết sống mãi. Cùng lập luận với vé đặt lại mật khẩu
 * (`passwordReset.ts`), và cùng cách sinh.
 */

/** Cùng số byte với vé đặt lại mật khẩu — xem `passwordReset.ts`. */
const SO_BYTE = 32;

export function bamChuoi(chuoi: string): string {
  return createHash('sha256').update(chuoi).digest('hex');
}

/**
 * Đường dẫn người dùng đem đi gửi.
 *
 * Dùng `CORS_ORIGIN` chứ không thêm một biến mới: nó đã là địa chỉ của frontend,
 * đã bắt buộc phải khai và đã được zod kiểm là URL hợp lệ — cùng lý lẽ đã ghi ở
 * `passwordReset.duongDanDatLai`.
 */
export function duongDan(chuoi: string): string {
  return `${env.CORS_ORIGIN.replace(/\/$/, '')}/xem/${chuoi}`;
}

export interface LienKetMoi {
  id: number;
  chuoi: string;
  url: string;
}

/**
 * Tạo một liên kết mới.
 *
 * Trả về chuỗi NGUYÊN VĂN, và đây là lần DUY NHẤT nó tồn tại ngoài đường dẫn:
 * database chỉ giữ băm, nên không có đường nào đọc lại nó. Giao diện phải hiện
 * nó ngay và nói rõ điều đó.
 */
export async function taoLienKet(input: {
  tenantId: number;
  reportId: number;
  createdBy: number;
  soNgay: number | null;
}): Promise<LienKetMoi> {
  const chuoi = randomBytes(SO_BYTE).toString('base64url');
  const expiresAt =
    input.soNgay === null ? null : new Date(Date.now() + input.soNgay * 24 * 60 * 60 * 1000);

  const id = await sharesRepo.tao(mysqlPool, {
    tenantId: input.tenantId,
    reportId: input.reportId,
    tokenHash: bamChuoi(chuoi),
    createdBy: input.createdBy,
    expiresAt,
  });

  return { id, chuoi, url: duongDan(chuoi) };
}

export interface LienKetDaMo {
  shareId: number;
  tenantId: number;
  reportId: number;
  createdBy: number;
}

/**
 * Mở một chuỗi thành phạm vi đọc được, hoặc ném lỗi NÓI ĐÚNG lý do.
 *
 * Ba kết cục khác nhau và người nhận liên kết cần phân biệt được chúng: không
 * có liên kết nào như thế (gõ sai, hoặc chưa bao giờ tồn tại), chủ báo cáo đã
 * THU HỒI, và liên kết đã HẾT HẠN. Gộp cả ba thành 404 làm người kế toán ngồi
 * đoán xem nên nhờ gửi lại hay tự gõ lại.
 *
 * ⚠️ KHÔNG nói gì về báo cáo trong các câu lỗi — không tên, không tổ chức. Một
 * chuỗi gõ sai không được phép tiết lộ rằng chuỗi đó "gần đúng".
 */
export async function moLienKet(chuoi: string): Promise<LienKetDaMo> {
  const row = await sharesRepo.timTheoBam(mysqlPool, bamChuoi(chuoi));
  if (row === null) {
    throw new HttpError(404, 'ShareNotFound', 'Liên kết này không tồn tại hoặc đã bị xoá.');
  }
  if (row.revokedAt !== null) {
    throw new HttpError(
      410,
      'ShareRevoked',
      'Liên kết này đã bị người chia sẻ thu hồi. Hãy hỏi họ gửi liên kết mới.',
    );
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(
      410,
      'ShareExpired',
      'Liên kết này đã hết hạn. Hãy hỏi người chia sẻ gửi liên kết mới.',
    );
  }

  /*
   * Đếm lượt mở KHÔNG chặn câu trả lời.
   *
   * `void` có chủ đích: người xem không có lý do gì phải chờ một câu UPDATE đếm
   * lượt, và một lần ghi hỏng (deadlock, bảng bị khoá) không được phép biến một
   * trang xem được thành một trang lỗi.
   */
  void sharesRepo.ghiLanMo(mysqlPool, row.id).catch((err: unknown) => {
    console.warn('[chiaSe] không ghi được lượt mở:', err instanceof Error ? err.message : err);
  });

  return {
    shareId: row.id,
    tenantId: row.tenantId,
    reportId: row.reportId,
    createdBy: row.createdBy,
  };
}
