/**
 * Cụm thời gian trong lời nói thành một khoảng ngày cụ thể — "tháng này" -> hai mốc.
 *
 * ═══ Lỗ mà file này bịt ════════════════════════════════════════════════════
 *
 * "Doanh thu tháng này" là câu hỏi phổ biến nhất của một công cụ BI, và trước
 * file này khung trả lời được **không câu nào** như thế. Lý do nằm ở cấu trúc
 * chứ không ở từ vựng: `giuNguyenLoi` buộc mọi giá trị lọc phải có mặt nguyên
 * văn trong lời người dùng, nên mô hình KHÔNG BAO GIỜ viết ra được
 * `2026-10-01`. Toán tử `gte`/`lte` có sẵn mà không có đường nào dùng tới.
 *
 * ═══ Vì sao CODE giải, không phải mô hình ═════════════════════════════════
 *
 * Mô hình chỉ chọn MỘT cụm trong danh sách đóng dưới đây, cộng với chiều ngày
 * nào. Hai thứ đó nó biết mà code không biết: câu nói dùng cụm gì, và mô hình
 * dữ liệu có mấy cột ngày thì cột nào là cột người ta đang nói tới.
 *
 * Còn việc "tháng này là từ ngày nào tới ngày nào" thì code biết chắc, và mô
 * hình chỉ đoán được. Để nó tự viết ngày là mở lại đúng cái lỗ mà
 * `giuNguyenLoi` bịt — một ngày lệch một tháng vẫn là một truy vấn chạy được,
 * trả về số thật, cho một khoảng thời gian không ai yêu cầu.
 *
 * Nên không gian đầu ra vẫn ĐÓNG: mô hình trả về một chuỗi trong
 * `CUM_CO_DINH`, hoặc một trong ba khuôn `thang-N` / `quy-N` / `nam-YYYY` mà
 * phần thay đổi toàn là SỐ.
 *
 * ═══ Mấy quyết định phải nói ra, vì chúng không hiển nhiên ════════════════
 *
 *   - **Tuần bắt đầu THỨ HAI.** `Date.getDay()` trả 0 cho Chủ nhật, nên tính
 *     thẳng theo nó là tuần bắt đầu Chủ nhật — đúng với Mỹ, sai với mọi người
 *     dùng của hệ này.
 *   - **Quý theo LỊCH, không theo năm tài chính.** Năm tài chính là cấu hình
 *     của từng tổ chức, mà hệ này chưa có chỗ nào khai nó; đoán bừa một
 *     tháng bắt đầu là đổi mọi con số của mọi báo cáo.
 *   - **`thang-3` nghĩa là tháng 3 của NĂM NAY.** Người nói "tháng 3" gần như
 *     luôn ý năm nay. Muốn năm khác thì nói "năm 2024" và nhận cả năm — thô,
 *     nhưng `hieuLa` in ra hai mốc thật nên một giả định sai NHÌN THẤY ĐƯỢC
 *     ngay, thay vì âm thầm trả số của năm sai.
 *   - **`truocKhi` là mốc HỞ (exclusive).** Cột có thể là `DateTime`, và khi
 *     đó `lte '2026-10-31'` cắt mất mọi dòng của ngày 31 sau 00:00:00 — mất
 *     gần một ngày dữ liệu mà không có dấu hiệu nào. `< 2026-11-01` thì đúng
 *     với cả `Date` lẫn `DateTime`.
 */

/** Cụm không mang số — danh sách ĐÓNG, và cũng là thứ gửi cho mô hình chọn. */
export const CUM_CO_DINH = [
  'hom-nay',
  'hom-qua',
  'tuan-nay',
  'tuan-truoc',
  'thang-nay',
  'thang-truoc',
  'quy-nay',
  'quy-truoc',
  'nam-nay',
  'nam-truoc',
  '7-ngay-qua',
  '30-ngay-qua',
  '90-ngay-qua',
] as const;

export type CumCoDinh = (typeof CUM_CO_DINH)[number];

export interface KhoangNgay {
  /** Mốc đầu, ĐÓNG — `>= tu`. */
  tu: string;
  /** Mốc cuối, HỞ — `< truocKhi`. Xem khối chú thích đầu tệp. */
  truocKhi: string;
}

/** `YYYY-MM-DD` theo lịch địa phương của máy chạy backend. */
function ngay(d: Date): string {
  const hai = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
}

/** Nửa đêm đầu ngày, bỏ hết phần giờ — mọi phép dưới đây đứng trên mốc này. */
function dauNgay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function themNgay(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Thứ Hai của tuần chứa `d`. `getDay()` trả 0 cho Chủ nhật — xem chú thích. */
function thuHai(d: Date): Date {
  const thu = d.getDay();
  return themNgay(d, thu === 0 ? -6 : 1 - thu);
}

function thang(nam: number, thangTu0: number): KhoangNgay {
  return {
    tu: ngay(new Date(nam, thangTu0, 1)),
    truocKhi: ngay(new Date(nam, thangTu0 + 1, 1)),
  };
}

function quy(nam: number, quyTu0: number): KhoangNgay {
  return {
    tu: ngay(new Date(nam, quyTu0 * 3, 1)),
    truocKhi: ngay(new Date(nam, quyTu0 * 3 + 3, 1)),
  };
}

function nam(n: number): KhoangNgay {
  return { tu: ngay(new Date(n, 0, 1)), truocKhi: ngay(new Date(n + 1, 0, 1)) };
}

/** `n` ngày gần nhất, TÍNH CẢ hôm nay — "7 ngày qua" là hôm nay và 6 ngày trước. */
function nNgayQua(moc: Date, n: number): KhoangNgay {
  return { tu: ngay(themNgay(moc, -(n - 1))), truocKhi: ngay(themNgay(moc, 1)) };
}

/**
 * Giải một cụm thành khoảng ngày. `null` = không nhận ra, và khi đó người gọi
 * BỎ CẢ FORM thay vì đoán — cùng luật với mọi ô khác của `kiemForm`.
 *
 * `moc` là "bây giờ", truyền vào chứ không đọc `Date.now()` bên trong: một hàm
 * ngày tháng mà không chốt được mốc thì không kiểm được, và nó sẽ đỏ đúng vào
 * ngày cuối tháng.
 */
export function giaiCum(cum: string, moc: Date): KhoangNgay | null {
  const homNay = dauNgay(moc);
  const y = homNay.getFullYear();
  const m = homNay.getMonth();

  switch (cum) {
    case 'hom-nay':
      return { tu: ngay(homNay), truocKhi: ngay(themNgay(homNay, 1)) };
    case 'hom-qua':
      return { tu: ngay(themNgay(homNay, -1)), truocKhi: ngay(homNay) };

    case 'tuan-nay': {
      const d = thuHai(homNay);
      return { tu: ngay(d), truocKhi: ngay(themNgay(d, 7)) };
    }
    case 'tuan-truoc': {
      const d = themNgay(thuHai(homNay), -7);
      return { tu: ngay(d), truocKhi: ngay(themNgay(d, 7)) };
    }

    case 'thang-nay':
      return thang(y, m);
    // `thang(y, m - 1)` chạy đúng cả khi `m === 0`: `new Date(2026, -1, 1)` là
    // tháng 12 năm 2025. Không cần nhánh riêng cho tháng Một.
    case 'thang-truoc':
      return thang(y, m - 1);

    case 'quy-nay':
      return quy(y, Math.floor(m / 3));
    case 'quy-truoc':
      return quy(y, Math.floor(m / 3) - 1);

    case 'nam-nay':
      return nam(y);
    case 'nam-truoc':
      return nam(y - 1);

    case '7-ngay-qua':
      return nNgayQua(homNay, 7);
    case '30-ngay-qua':
      return nNgayQua(homNay, 30);
    case '90-ngay-qua':
      return nNgayQua(homNay, 90);

    default:
      break;
  }

  // Ba khuôn mang số. Phần thay đổi toàn là chữ số, nên không gian vẫn đóng.
  const thangN = /^thang-([1-9]|1[0-2])$/.exec(cum);
  if (thangN?.[1] !== undefined) return thang(y, Number(thangN[1]) - 1);

  const quyN = /^quy-([1-4])$/.exec(cum);
  if (quyN?.[1] !== undefined) return quy(y, Number(quyN[1]) - 1);

  /*
   * Kẹp năm vào 2000–2100.
   *
   * Không phải vì sợ tràn số, mà vì `nam-0` và `nam-99999` là dấu hiệu mô
   * hình đang bịa chứ không phải người dùng đang hỏi — và đoạn dữ liệu nào
   * cũng không nằm ngoài khoảng đó.
   */
  const namN = /^nam-(\d{4})$/.exec(cum);
  if (namN?.[1] !== undefined) {
    const n = Number(namN[1]);
    return n >= 2000 && n <= 2100 ? nam(n) : null;
  }

  return null;
}
