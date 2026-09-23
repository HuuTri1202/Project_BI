import type { ReportDataDto } from '@bi/shared';

import {
  canvasSangPng,
  canvasSangTrangPdf,
  chupCacVung,
  LoiXuat,
  taiXuong,
  tenTepXuat,
} from './chupBaoCao';
import { dungSheets } from './excelBaoCao';
import { taoPdf } from './pdfAnh';
import { taoXlsx } from './xlsx';

/**
 * Xuất MỘT ô biểu đồ — menu "⋮" trên đầu mỗi ô trong trình dựng, §10.23.
 *
 * ═══ Vì sao ở trình dựng thì KHÔNG hỏi "biểu đồ nào" ════════════════════════
 *
 * Trang xem có một nút "Xuất" cho cả báo cáo, nên nó phải hỏi. Ở trình dựng thì
 * câu hỏi đã được trả lời bằng chính cú bấm: menu này nằm trên đầu MỘT ô, và
 * người dùng vừa chỉ tay vào nó. Mở thêm một hộp thoại để hỏi lại điều vừa nói
 * là bắt người ta xác nhận thao tác của chính mình.
 *
 * ═══ Số liệu lấy từ BẢN XEM TRƯỚC, không phải từ báo cáo đã lưu ═════════════
 *
 * Ô trong trình dựng có thể đang mang cấu hình chưa lưu — đó là lý do người ta
 * ở trong trình dựng. Nên Excel đóng gói đúng `ReportDataDto` mà ô đang vẽ, và
 * sheet xuất xứ nói rõ tệp này ra từ trình dựng: người nhận mở tệp ra không có
 * cách nào tự biết con số trong đó chưa có trong báo cáo đã lưu.
 */

export type KieuMotO = 'png' | 'pdf' | 'excel';

/** Ghi vào sheet xuất xứ của tệp Excel — xem khối chú thích trên. */
const MOT_O = 'Một biểu đồ, xuất từ trình dựng (có thể chưa lưu vào báo cáo)';

/**
 * Ô chưa vẽ xong thì chưa xuất được.
 *
 * Lẽ ra không tới được đây — menu khoá mục xuất khi ô chưa có số liệu — nhưng
 * số liệu có thể biến mất giữa lúc menu đang mở (đổi cấu hình bằng bàn phím,
 * hoàn tác). Ném một câu đọc được vẫn hơn để `undefined` chạy tiếp thành một
 * tệp rỗng. Kế thừa `LoiXuat` để nơi gọi hiện thẳng câu này, như mọi lỗi xuất.
 */
class LoiChuaVeXong extends LoiXuat {
  constructor() {
    super('Biểu đồ chưa vẽ xong, chưa xuất được. Đợi số liệu hiện ra rồi thử lại.');
  }
}

/** Viền ô lúc KHÔNG được chọn — `border-slate-200`, đúng lớp Tailwind của `Card`. */
const VIEN_THUONG = '#e2e8f0';

/**
 * Chụp ô với vành "đang chọn" tắt đi, rồi trả thẻ về nguyên trạng.
 *
 * Vành sáng xanh là trạng thái của TRÌNH DỰNG, không phải của biểu đồ: để nó
 * lọt vào tệp thì ảnh đọc ra như ảnh chụp màn hình phần mềm chứ không phải một
 * biểu đồ để dán vào báo cáo. Không lọc được bằng `KHONG_XUAT` như cái nút "⋮"
 * hay tay nắm co giãn — vành nằm trên CHÍNH thẻ của ô, bỏ thẻ đó đi thì không
 * còn gì để chụp. Nên tắt bằng style nội tuyến, thứ thắng mọi lớp Tailwind.
 *
 * Trả lại bằng cách ghi nguyên thuộc tính `style` cũ: thẻ ô còn mang vị trí
 * lưới do React đặt, và xoá trắng là ô nhảy về góc trên-trái.
 */
async function chupOSach(
  el: HTMLElement,
  thongTin: Parameters<typeof chupCacVung>[1],
): ReturnType<typeof chupCacVung> {
  const cu = el.getAttribute('style');
  el.style.boxShadow = 'none';
  el.style.borderColor = VIEN_THUONG;
  try {
    return await chupCacVung([el], thongTin);
  } finally {
    if (cu === null) el.removeAttribute('style');
    else el.setAttribute('style', cu);
  }
}

export async function xuatMotO({
  kieu,
  el,
  ten,
  tenBaoCao,
  data,
}: {
  kieu: KieuMotO;
  /** Thẻ của ô trên màn hình — chỉ PNG/PDF cần tới. */
  el: HTMLElement | null;
  /** Tên ô, đúng chữ đang hiện trên đầu ô. */
  ten: string;
  /** Tên báo cáo — rỗng khi báo cáo còn chưa đặt tên. */
  tenBaoCao: string;
  data: ReportDataDto | undefined;
}): Promise<void> {
  const coTenBaoCao = tenBaoCao.trim() !== '';

  if (kieu === 'excel') {
    if (data === undefined) throw new LoiChuaVeXong();
    const blob = await taoXlsx(dungSheets(coTenBaoCao ? tenBaoCao : ten, [{ ten, data }], MOT_O));
    taiXuong(blob, tenTepXuat([tenBaoCao, ten], 'xlsx'));
    return;
  }

  if (el === null) throw new LoiChuaVeXong();

  /*
   * Dải tiêu đề giữ đúng thứ tự của trang xem: tên BÁO CÁO ở dòng lớn, phạm vi
   * ở dòng nhỏ. Ảnh một biểu đồ và ảnh cả báo cáo nằm cạnh nhau trong cùng một
   * thư mục, và đọc ngược được "cái này ra từ báo cáo nào" ở cùng một chỗ.
   */
  const { canvas, rongCss, caoCss } = await chupOSach(el, {
    tieuDe: coTenBaoCao ? tenBaoCao : ten,
    phu: [
      coTenBaoCao ? `Biểu đồ: ${ten}` : null,
      `Xuất lúc ${new Date().toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })}`,
    ]
      .filter((p) => p !== null)
      .join(' · '),
  });

  if (kieu === 'png') {
    taiXuong(await canvasSangPng(canvas), tenTepXuat([tenBaoCao, ten], 'png'));
    return;
  }

  const trang = await canvasSangTrangPdf(canvas, rongCss, caoCss);
  taiXuong(taoPdf([trang], coTenBaoCao ? tenBaoCao : ten), tenTepXuat([tenBaoCao, ten], 'pdf'));
}
