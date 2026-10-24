import {
  FILTER_OPERATOR_LABELS,
  type ExplorerQueryDto,
  type ExplorerResultDto,
  type MeasureFormat,
} from '@bi/shared';

/**
 * Đọc kết quả một truy vấn thành câu tiếng Việt — bằng CODE, không bằng mô hình.
 *
 * ═══ Vì sao chỗ này tồn tại ════════════════════════════════════════════════
 *
 * `datCauHoi` để mô hình điền form, và form đó chạy ra một bảng số. Nếu mô hình
 * cũng được đọc bảng số đó thành câu thì toàn bộ lời hứa "không bịa con số" mất
 * sạch ở bước cuối — nó chỉ cần làm tròn một lần là xong.
 *
 * Nên bảng số đi qua đây. Mọi con số trong câu là `docSo` của một ô trong
 * `rows`, và `so[]` mang chúng ra để lớp `dienDat` (nếu có) bị đối chiếu lại.
 *
 * ═══ `hieuLa`: nói lại CÁCH NÓ HIỂU, không chỉ nói kết quả ═════════════════
 *
 * Đây là phần quan trọng nhất của file này.
 *
 * Ở `hieuY`, thứ tệ nhất mô hình làm được là chọn nhầm nhãn — và câu trả lời
 * hiện ra kèm nguyên văn cái nhãn đó, nên người đọc thấy ngay là nó đang nói
 * chuyện khác. Lớp điền form KHÔNG có sẵn tính chất ấy: một truy vấn sai trường
 * vẫn ra một con số đẹp, và không gì trên màn hình nói nó được tính thế nào.
 *
 * `hieuLa` trả lại tính chất đó, bằng chữ: "Doanh thu theo Khu vực, lọc Khu vực
 * bằng Miền Bắc". Người đọc đối chiếu được câu đó với câu họ vừa hỏi. Không có
 * nó thì lớp này là chỗ duy nhất trong cả khung hỏi đáp mà một câu trả lời sai
 * không có dấu hiệu nào.
 */

/** Đọc một con số theo đúng cách `formatValue` bên frontend đọc. */
function docSo(value: number, format: MeasureFormat | undefined): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }
  return value.toLocaleString('vi-VN');
}

/** Một ô bất kỳ thành chữ. `null` là ô TRỐNG, và phải nói ra chứ không bỏ qua. */
function docO(value: string | number | null, format: MeasureFormat | undefined): string {
  if (value === null) return '(trống)';
  if (typeof value === 'number') return docSo(value, format);
  // Cube trả thước đo về dạng chuỗi số khá thường xuyên. Đọc lại thành số để
  // câu trả lời dùng cùng dấu phân cách với mọi chỗ khác trên màn hình.
  const n = Number(value);
  return value.trim() !== '' && !Number.isNaN(n) && format !== undefined ? docSo(n, format) : value;
}

/** "A, B và C" — không phải "A và B và C". */
function noi(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

/**
 * Câu nói lại cách truy vấn đã được hiểu — đọc được mà không cần nhìn bảng số.
 *
 * Dùng NHÃN của trường, không dùng id: id không nói gì với người đọc, và cả
 * mục đích của câu này là để họ đối chiếu với câu họ vừa hỏi.
 */
export function moTaTruyVan(truyVan: ExplorerQueryDto, nhanCua: Map<number, string>): string {
  const ten = (id: number): string => nhanCua.get(id) ?? `trường #${String(id)}`;

  const do_ = truyVan.measureIds.map(ten);
  const chieu = truyVan.dimensionIds.map(ten);

  const phan: string[] = [];
  if (do_.length > 0) phan.push(noi(do_));
  if (chieu.length > 0) phan.push(`theo ${noi(chieu)}`);
  if (truyVan.timeDimension !== undefined) {
    phan.push(
      `theo ${ten(truyVan.timeDimension.dimensionId)} (${truyVan.timeDimension.granularity})`,
    );
  }

  /*
   * Cặp `gte`/`lt` trên CÙNG một chiều đọc thành MỘT câu.
   *
   * Một mốc thời gian sinh ra đúng cặp đó (xem `khoangThoiGian.ts`), và để
   * nguyên hai dòng thì `hieuLa` nói "Ngày đặt từ … trở lên 2026-10-01, Ngày
   * đặt nhỏ hơn 2026-11-01" — đúng từng chữ mà không ai đọc nổi. Dòng này là
   * chỗ DUY NHẤT người dùng kiểm được "máy hiểu khoảng nào", nên nó phải đọc
   * được, nếu không nó chỉ còn là chữ cho có.
   *
   * "đến trước" chứ không phải "đến": mốc cuối HỞ, và nói "đến 2026-11-01"
   * là nói sai một ngày về phía rộng hơn.
   */
  const daGop = new Set<number>();
  const boLoc = truyVan.filters ?? [];

  boLoc.forEach((f, i) => {
    if (f.operator !== 'gte' || daGop.has(i)) return;
    const j = boLoc.findIndex(
      (g, k) => k !== i && !daGop.has(k) && g.dimensionId === f.dimensionId && g.operator === 'lt',
    );
    if (j < 0) return;
    daGop.add(i);
    daGop.add(j);
    phan.push(
      `lọc ${ten(f.dimensionId)} từ ${f.values.join(', ')} đến trước ${boLoc[j]?.values.join(', ') ?? ''}`,
    );
  });

  boLoc.forEach((f, i) => {
    if (daGop.has(i)) return;
    const dieu = FILTER_OPERATOR_LABELS[f.operator];
    phan.push(
      f.values.length === 0
        ? `lọc ${ten(f.dimensionId)} ${dieu}`
        : `lọc ${ten(f.dimensionId)} ${dieu} ${f.values.join(', ')}`,
    );
  });

  /*
   * `limit` PHẢI được nói ra. Nó quyết định tập dữ liệu nào được lấy về, nên
   * một "top 5" mà mô hình tự nghĩ ra từ câu hỏi là thứ người đọc cần thấy —
   * y hệt lý do mấy bộ lọc ở trên có mặt trong câu này.
   *
   * Phép gộp thì KHÔNG cần dòng riêng: `buildQuery` đã gắn tên phép vào nhãn
   * cột khi phép bị đổi ("Doanh thu (Trung bình)"), và `nhanCua` lấy nhãn từ
   * chính kết quả, nên nó đã nằm sẵn trong `ten(...)` ở trên.
   */
  if (truyVan.limit !== undefined) phan.push(`lấy ${String(truyVan.limit)} dòng đầu`);

  return phan.join(', ');
}

/** Trần số dòng đọc ra thành chữ. Dài hơn thế thì câu trả lời thành một bảng đổ. */
const TRAN_DONG = 15;

export interface TraLoiTruyVan {
  cau: string;
  /** Những con số ĐÃ định dạng mà câu trả lời đứng trên — xem `giuNguyenSo`. */
  so: string[];
  /** Cách truy vấn đã được hiểu, bằng chữ. Luôn hiện cùng câu trả lời. */
  hieuLa: string;
}

/**
 * Bảng kết quả thành câu.
 *
 * Ba hình dạng, vì ba hình dạng này đọc ra ba câu khác nhau:
 *
 *   - Không chiều nào: một con số duy nhất. "Tổng Doanh thu: 2.180.000."
 *   - Có chiều, một dòng: nói thẳng dòng đó.
 *   - Có chiều, nhiều dòng: liệt kê, có trần.
 *
 * `truncated` PHẢI được nói ra. Nó nghĩa là truy vấn đã chạm trần số dòng, nên
 * "cao nhất" trong danh sách này có thể không phải cao nhất thật — cùng lý do
 * `luuYCat` tồn tại ở nhánh biểu đồ bên frontend.
 */
export function docKetQua(
  kq: ExplorerResultDto,
  truyVan: ExplorerQueryDto,
  nhanCua: Map<number, string>,
  /**
   * Hướng đã sắp — xem `huongSap`. Vắng mặt = không nói gì về thứ tự.
   *
   * ⚠️ Phải nói ra CẢ KHI hướng là mặc định. Chỉ nói lúc nó bị lật thì người
   * đọc không phân biệt được "máy hiểu là cao nhất" với "máy không nghĩ tới
   * chuyện đó" — mà cả tác dụng của `hieuLa` nằm ở chỗ phân biệt ấy.
   */
  huong?: 'asc' | 'desc',
): TraLoiTruyVan {
  const cat = kq.truncated ? ` — truy vấn đã chạm trần số dòng nên đây chưa phải toàn bộ` : '';

  /*
   * Thứ tự chỉ đáng nói khi có NHIỀU dòng để mà xếp.
   *
   * Một con số duy nhất thì "xếp từ cao xuống" là chữ thừa, và chữ thừa trong
   * `hieuLa` làm loãng đúng cái dòng mà người đọc phải soi.
   */
  const noiThuTu =
    huong !== undefined && kq.columns.some((c) => c.kind === 'dimension') && kq.rows.length > 1;
  const hieuLa =
    moTaTruyVan(truyVan, nhanCua) +
    (noiThuTu ? `, xếp ${huong === 'asc' ? 'từ thấp lên' : 'từ cao xuống'}` : '');

  if (kq.rows.length === 0) {
    return { cau: `Không có dòng nào thoả điều kiện này.`, so: [], hieuLa };
  }

  const dinhDang = kq.columns.map((c) => c.format);
  const nhan = kq.columns.map((c) => c.label);
  const chiSoDo = kq.columns.flatMap((c, i) => (c.kind === 'measure' ? [i] : []));
  const chiSoChieu = kq.columns.flatMap((c, i) => (c.kind === 'dimension' ? [i] : []));

  /** Một dòng thành "Miền Bắc: Doanh thu 1.200.000". */
  const docDong = (dong: (string | number | null)[]): { chu: string; so: string[] } => {
    const tenDong = chiSoChieu.map((i) => docO(dong[i] ?? null, undefined)).join(' · ');
    const soDong = chiSoDo.map((i) => docO(dong[i] ?? null, dinhDang[i]));
    const veDo = chiSoDo.map((i, k) => `${nhan[i] ?? ''} ${soDong[k] ?? ''}`).join(', ');
    return { chu: tenDong === '' ? veDo : `${tenDong}: ${veDo}`, so: soDong };
  };

  // Không chiều nào: đúng một dòng, đúng một con số — không có gì để liệt kê.
  if (chiSoChieu.length === 0) {
    const d = docDong(kq.rows[0] ?? []);
    return { cau: `${d.chu}.${cat}`, so: d.so, hieuLa };
  }

  const hien = kq.rows.slice(0, TRAN_DONG).map(docDong);
  const con = kq.rows.length - hien.length;

  if (hien.length === 1) {
    const d = hien[0];
    return { cau: `${d?.chu ?? ''}.${cat}`, so: d?.so ?? [], hieuLa };
  }

  return {
    cau:
      `${String(kq.rows.length)} ${noi(chiSoChieu.map((i) => nhan[i] ?? ''))}: ` +
      `${hien.map((d) => d.chu).join('; ')}` +
      `${con > 0 ? `; … và ${String(con)} dòng nữa` : ''}.${cat}`,
    /*
     * Số dòng đứng ĐẦU danh sách `so`: nó là con số mà câu mở đầu bằng, nên lớp
     * viết lại không được phép làm tròn nó. Mấy con số của từng dòng theo sau.
     */
    so: [String(kq.rows.length), ...hien.flatMap((d) => d.so)],
    hieuLa,
  };
}
