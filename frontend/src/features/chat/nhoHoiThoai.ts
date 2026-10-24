/**
 * Giữ cuộc trò chuyện qua một lần F5 — và CHỈ qua đó.
 *
 * ═══ Vấn đề ════════════════════════════════════════════════════════════════
 *
 * `tinNhan` là state React, nên mọi thứ đã hỏi biến mất khi tải lại trang. Mà
 * tải lại trang là thao tác thường nhất ở đây: người dùng hỏi một con số, đi
 * sửa dữ liệu, F5 để xem số mới — và mất cả đoạn đối chiếu họ vừa dựng.
 *
 * Nó còn cắt một thứ đắt hơn: `boiCanh` giữ form truy vấn của lượt trước, tức
 * là thứ làm cho "còn tháng 4 thì sao" có nghĩa. Mất nó thì lượt hỏi tiếp
 * thành một câu hỏi cụt, và backend đã dựng sẵn cả đường cho nó rồi
 * (`DatCauHoiInput.boiCanh`).
 *
 * ═══ `sessionStorage`, không phải `localStorage` ═══════════════════════════
 *
 * Vòng đời của nó đúng bằng nghĩa chữ "phiên" mà khung này vẫn dùng — cùng
 * phạm vi với cache trong `api.ts`. `localStorage` thì sống qua cả lần đóng
 * trình duyệt, và một cuộc trò chuyện về số liệu của tuần trước hiện lại vào
 * sáng thứ Hai là thứ gây hiểu nhầm chứ không phải tiện lợi.
 *
 * ⚠️ Mọi lối vào đều bọc `try/catch`: cửa sổ ẩn danh, site data bị chặn, hết
 * quota — cả ba đều NÉM chứ không trả về rỗng. Mất lịch sử là hậu quả duy
 * nhất chấp nhận được; làm hỏng một lần gõ câu hỏi thì không.
 */

const KHOA = 'bi:chat:phien';

/**
 * Đổi số này mỗi khi `TinNhan` đổi hình dạng.
 *
 * Đọc lại là một phép ÉP KIỂU — không có cách nào kiểm được toàn bộ cây dữ
 * liệu mà không viết lại cả bộ schema. Con số này làm phép ép đó an toàn: một
 * bản dựng chỉ đọc đúng thứ chính nó đã ghi. Quên tăng nó khi đổi `TinNhan`
 * nghĩa là bản mới đọc dữ liệu của bản cũ, và một trường thiếu sẽ nổ ở lúc vẽ.
 */
const BAN = 1;

/**
 * Trần số tin giữ lại.
 *
 * `sessionStorage` thường chỉ có 5MB cho cả gốc, và khung này không phải thứ
 * duy nhất dùng nó. 60 tin là dài hơn hẳn mọi cuộc trò chuyện thật, mà vẫn
 * chặn được một tab mở cả ngày ăn hết chỗ của phần còn lại.
 */
const TRAN_TIN = 60;

export interface PhienChat {
  /** `TinNhan[]` của `HoiDapPanel` — xem `BAN` về chuyện vì sao là `unknown`. */
  tinNhan: unknown[];
  /** Bộ đếm id tin, để id không đụng nhau sau khi tải lại. */
  demId: number;
  /** Form truy vấn của lượt trước, cho câu hỏi tiếp. */
  boiCanh: unknown;
}

export function ghiPhien(p: PhienChat): void {
  try {
    /*
     * Bỏ mấy tin ĐANG SOẠN.
     *
     * Một bong bóng ba chấm được ghi lại sẽ nhấp nháy mãi mãi sau khi tải
     * lại: lời gọi sinh ra nó đã chết cùng trang cũ, nên không còn gì tới để
     * thay nó. Câu hỏi của người dùng thì vẫn giữ — họ đã hỏi thật, và một
     * câu hỏi không có trả lời là mô tả đúng chuyện vừa xảy ra.
     */
    const xong = p.tinNhan.filter((t) => (t as { dangSoan?: unknown }).dangSoan !== true);

    sessionStorage.setItem(
      KHOA,
      JSON.stringify({
        ban: BAN,
        demId: p.demId,
        boiCanh: p.boiCanh,
        tinNhan: xong.slice(-TRAN_TIN),
      }),
    );
  } catch {
    // Xem khối chú thích đầu tệp: mất lịch sử là hậu quả duy nhất.
  }
}

export function docPhien(): PhienChat | null {
  try {
    const tho = sessionStorage.getItem(KHOA);
    if (tho === null) return null;

    const o = JSON.parse(tho) as {
      ban?: unknown;
      tinNhan?: unknown;
      demId?: unknown;
      boiCanh?: unknown;
    };
    if (o.ban !== BAN || !Array.isArray(o.tinNhan)) return null;

    return {
      tinNhan: o.tinNhan,
      demId: typeof o.demId === 'number' ? o.demId : 0,
      boiCanh: o.boiCanh ?? null,
    };
  } catch {
    // JSON hỏng (bị sửa tay, bị cắt giữa chừng) đọc ra như chưa có gì.
    return null;
  }
}

/**
 * Xoá hẳn phiên đã lưu.
 *
 * Khung không gọi hàm này: nút "đổi nguồn" xoá đoạn chat bằng `setTinNhan([])`
 * và hiệu ứng ghi lại trạng thái rỗng ngay sau đó. Nó có mặt để test đặt lại
 * đúng KHOÁ này mà không quét sạch `sessionStorage` của cả bộ.
 */
export function xoaPhien(): void {
  try {
    sessionStorage.removeItem(KHOA);
  } catch {
    // Không xoá được thì lần ghi sau cũng không ghi được. Không có gì để làm.
  }
}
