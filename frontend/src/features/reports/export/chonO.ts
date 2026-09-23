import { CHART_TYPE_LABELS, type ReportDto, type ReportVisualDto } from '@bi/shared';

/**
 * "Xuất những biểu đồ nào?" — phần TÍNH của hộp chọn, không dính React.
 *
 * ═══ Hỏi cái gì thì phải đúng phạm vi của định dạng đã chọn ═════════════════
 *
 * Mỗi định dạng vốn đã có phạm vi riêng: PNG và PDF chụp TRANG ĐANG XEM, còn
 * "PDF tất cả trang" và Excel đi qua CẢ báo cáo. Hộp chọn chỉ được THU HẸP
 * phạm vi đó, không được nới ra — bày cả mười hai ô của bốn trang rồi xuất PNG
 * chỉ ra được ô của một trang là hứa một đằng làm một nẻo.
 *
 * ═══ Tên ô: nhãn thật nếu ĐÃ CÓ, không thì thứ tự và loại biểu đồ ══════════
 *
 * Tiêu đề tự sinh ("Doanh thu theo Nhóm") chỉ có trong câu trả lời của backend.
 * Chờ số liệu của cả báo cáo về rồi mới hiện danh sách nghĩa là bấm "Xuất" xong
 * ngồi nhìn một hộp trống vài giây — đúng lúc người dùng muốn nhanh nhất.
 *
 * Nên hộp mở ra NGAY với tên tạm ("Biểu đồ 3 · Bảng số liệu"), rồi `themNhanThat`
 * thay bằng nhãn thật cho những trang đã có số liệu trong cache — luôn gồm trang
 * đang xem, tức những ô người dùng đang nhìn. Đo trên Chromium: thiếu bước này
 * thì thẻ ghi "Doanh thu v3 theo Nhóm hàng" còn hộp chọn ghi "Biểu đồ 3", và
 * người dùng phải đếm ô trên màn hình mới biết mình đang bỏ tích cái nào.
 */

/** Định dạng xuất — cùng tập với menu của `XuatBaoCao`. */
export type KieuXuat = 'png' | 'pdf' | 'pdf-tat-ca' | 'excel';

/** Một ô biểu đồ nhìn từ phía hộp chọn. */
export interface OXuat {
  /**
   * Khoá chọn: mã trang + mã ô.
   *
   * Mã ô là UUID nên tự nó đã đủ phân biệt, nhưng khung §10.12 cho phép nhân
   * bản cả một trang, và một ngày nào đó hai trang mang cùng mã ô thì chọn ô
   * này sẽ lặng lẽ xuất luôn ô kia. Ghép thêm mã trang là chặn hẳn đường đó.
   */
  khoa: string;
  pageId: string;
  visualId: string;
  /** Tên trang — `null` khi báo cáo chỉ một trang, khỏi lặp một cái tên vô ích. */
  tenTrang: string | null;
  ten: string;
  /** Tên là tạm (do ta đặt) chứ không phải tên người dùng đặt — xem `themNhanThat`. */
  tuSinh: boolean;
}

export const khoaO = (pageId: string, visualId: string): string => `${pageId}:${visualId}`;

/** Tên hiện trong hộp chọn cho ô thứ `thuTu` (đếm từ 1) của trang. */
export function tenO(visual: ReportVisualDto, thuTu: number): string {
  const rieng = (visual.title ?? '').trim();
  return rieng !== '' ? rieng : `Biểu đồ ${thuTu} · ${CHART_TYPE_LABELS[visual.chartType]}`;
}

/**
 * Những ô mà `kieu` sẽ đụng tới.
 *
 * Trả về mảng RỖNG khi không có gì để chọn (báo cáo một biểu đồ §7.6 không có
 * khung, hay trang đang xem không có ô nào) — nơi gọi hiểu đó là "đừng hỏi".
 */
export function oTrongTam(report: ReportDto, kieu: KieuXuat, activePageId: string | null): OXuat[] {
  const pages = report.canvas?.pages ?? [];
  if (pages.length === 0) return [];

  const caBaoCao = kieu === 'excel' || kieu === 'pdf-tat-ca';
  const dangXem = pages.find((p) => p.id === activePageId) ?? pages[0];
  const trong = caBaoCao ? pages : dangXem === undefined ? [] : [dangXem];
  const nhieuTrang = pages.length > 1;

  return trong.flatMap((page) =>
    page.visuals.map((v, i) => ({
      khoa: khoaO(page.id, v.id),
      pageId: page.id,
      visualId: v.id,
      // Nhãn trang chỉ có ý nghĩa khi danh sách trải qua nhiều trang: hộp chọn
      // của PNG luôn nằm gọn trong một trang, dù báo cáo có bao nhiêu trang.
      tenTrang: caBaoCao && nhieuTrang ? page.name : null,
      ten: tenO(v, i + 1),
      tuSinh: (v.title ?? '').trim() === '',
    })),
  );
}

/**
 * Tên ĐANG in trên đầu ô, đọc thẳng từ màn hình — `null` nếu ô không ở đó.
 *
 * Nguồn chắc chắn nhất, vì nó đúng bằng định nghĩa: cái tên hộp chọn đưa ra là
 * cái tên người dùng đang nhìn. Cache có thể trượt khoá, có thể chưa về, có thể
 * rỗng vì ô đang lỗi — màn hình thì không.
 */
export function tenTrenManHinh(goc: HTMLElement, visualId: string): string | null {
  for (const el of goc.querySelectorAll<HTMLElement>('[data-visual-id]')) {
    if (el.getAttribute('data-visual-id') !== visualId) continue;
    const ten = (el.getAttribute('data-visual-ten') ?? '').trim();
    return ten === '' ? null : ten;
  }
  return null;
}

/**
 * Thay tên tạm bằng nhãn thật, ở những ô mà `nhan` trả lời được.
 *
 * Nơi gọi tra trong cache của react-query chứ không gọi mạng: hộp chọn phải mở
 * ra tức thì, và một ô chưa có số liệu thì giữ tên tạm chứ không để trống.
 */
export function themNhanThat(
  danhSach: readonly OXuat[],
  nhan: (pageId: string, visualId: string) => string | null,
): OXuat[] {
  return danhSach.map((o) => {
    if (!o.tuSinh) return o;
    const that = nhan(o.pageId, o.visualId);
    return that === null || that.trim() === '' ? o : { ...o, ten: that };
  });
}

/** Đã chọn hết mọi ô trong tầm chưa — lúc đó việc xuất đi đường cũ, nguyên vẹn. */
export function chonHet(danhSach: readonly OXuat[], chon: ReadonlySet<string>): boolean {
  return danhSach.every((o) => chon.has(o.khoa));
}

/**
 * Các phần tử DOM của những ô đã chọn, theo đúng thứ tự trong trang.
 *
 * Thứ tự lấy từ CẤU HÌNH chứ không từ thứ tự trong DOM: khung là một lưới, ô ở
 * hàng dưới vẫn có thể đứng trước trong DOM. Ảnh xuất xếp dọc, nên nó phải theo
 * thứ tự người dựng đã đặt.
 */
export function oTrenManHinh(goc: HTMLElement, thuTuVisualId: readonly string[]): HTMLElement[] {
  const theoId = new Map<string, HTMLElement>();
  for (const el of goc.querySelectorAll<HTMLElement>('[data-visual-id]')) {
    const id = el.getAttribute('data-visual-id');
    // Ô đầu tiên thắng: một ô lồng trong ô khác không xảy ra, nhưng nếu xảy ra
    // thì cái ngoài mới là cái người dùng nhìn thấy.
    if (id !== null && !theoId.has(id)) theoId.set(id, el);
  }
  return thuTuVisualId
    .map((id) => theoId.get(id))
    .filter((el): el is HTMLElement => el !== undefined);
}
