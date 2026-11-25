import { createHash } from 'node:crypto';

import { redis } from '../../config/redis';

/**
 * ═══ BỘ NHỚ ĐỆM CỦA KHUNG HỎI ĐÁP — một chỗ cho cả ba lớp ══════════════════
 *
 * Hạn mức của nhà cung cấp đo bằng TOKEN MỖI PHÚT. Đo ngày 24/11/2026 trên
 * Groq: trần 8.000 token/phút, một câu hỏi tốn 842 token lời nhắc + ~200 token
 * trả lời. Tức bảy câu một phút là hết lượt.
 *
 * `datCauHoi` đã có bộ đệm từ bản trước. Hai lớp còn lại thì CHỈ được đệm trong
 * bộ nhớ của MỘT TAB trình duyệt (`features/chat/api.ts`), nên:
 *
 *   - Bấm F5 là mất sạch — và `dien-dat` chạy ở MỌI câu trả lời thành công, kể
 *     cả câu mà form đã lấy từ đệm, nên nó là lớp tiêu token nhiều nhất.
 *   - Tab khác không dùng được, người thứ hai trong buổi demo cũng không.
 *
 * Đưa xuống Redis thì một câu đã hỏi là miễn phí cho mọi người, mọi tab, và
 * sống qua F5.
 *
 * ─── Đệm cái gì thì AN TOÀN ─────────────────────────────────────────────────
 *
 * Luật chung, giống hệt lập luận ở `datCauHoi`: chỉ đệm thứ KHÔNG mang con số
 * của kho dữ liệu, hoặc đệm ở dạng còn phải kiểm lại mỗi lần đọc.
 *
 *   - `datCauHoi`: đệm nguyên văn CHUỖI mô hình trả về, không đệm form đã kiểm
 *     — nhờ vậy `kiemForm` chạy lại đầy đủ mỗi lượt đọc, và truy vấn vẫn chạy
 *     trên kho nên con số luôn mới.
 *   - `hieuY`: đệm CHỈ SỐ nhãn. Danh sách nhãn nằm trong khoá, nên một chỉ số
 *     đọc ra từ đệm luôn trỏ vào đúng danh sách đã sinh ra nó.
 *   - `dienDat`: đệm câu đã viết lại. Nó mang con số — nhưng là con số của
 *     CHÍNH câu gốc nằm trong khoá, nên đọc đệm ra không bao giờ ghép một câu
 *     chữ cũ với một con số mới. Luật `giuNguyenSo` vẫn chạy lại khi đọc.
 *
 * ⚠️ CHỈ ghi khi lượt gọi THÀNH CÔNG. Đệm cả thất bại là khoá chặt một câu hỏi
 * ở trạng thái bế tắc suốt một tiếng, kể cả khi nhà cung cấp đã sống lại.
 */
const TTL_GIAY = 60 * 60;

/**
 * Khoá đệm: `chat:<lớp>:v1:<phạm vi>:<băm>`.
 *
 * `pham` là PHẠM VI CÁCH LY, và nó luôn có `tenantId`: hai tổ chức không bao
 * giờ được chạm vào cùng một khoá, và một khoá nói rõ nó thuộc tổ chức nào thì
 * đọc log Redis cũng thấy.
 *
 * `v1` là số hiệu HÌNH DẠNG lời nhắc. Sửa lời nhắc của một lớp thì tăng số của
 * lớp đó, vì mọi bản đệm cũ đã được sinh bởi một bộ luật khác.
 *
 * Băm vì phần biến thiên có thể dài hàng nghìn ký tự (danh sách 60 nhãn), mà
 * khoá Redis thì nên ngắn và một dòng.
 */
export function khoaDem(lop: string, pham: string, bienThien: unknown): string {
  const bam = createHash('sha1').update(JSON.stringify(bienThien)).digest('base64url');
  return `chat:${lop}:v1:${pham}:${bam}`;
}

export async function docDem(khoa: string): Promise<string | null> {
  try {
    return await redis.get(khoa);
  } catch (err) {
    // Redis hỏng thì CHO QUA, y như `middleware/rateLimit`: đệm là lớp tăng
    // tốc, không phải lớp chức năng. Hỏng nó chỉ nên làm chậm, không làm tắt.
    console.warn('[chat] không đọc được đệm:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function ghiDem(khoa: string, noiDung: string): Promise<void> {
  try {
    await redis.set(khoa, noiDung, 'EX', TTL_GIAY);
  } catch (err) {
    console.warn('[chat] không ghi được đệm:', err instanceof Error ? err.message : err);
  }
}
