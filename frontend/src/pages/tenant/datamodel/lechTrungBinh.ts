import type { ExplorerResultDto, MeasureFormat } from '@bi/shared';

/**
 * Phát hiện trung bình đang bị kéo lệch — §10.7.
 *
 * Tách khỏi `ExplorerTab.tsx` vì đây là logic thuần: nó nhận hai kết quả truy
 * vấn và trả về một kết luận, không đụng React. Việc ghép dòng ở dưới có đúng
 * một cái bẫy rất kín, nên nó cần được kiểm bằng test chứ không bằng mắt.
 */

/**
 * Trung bình lệch bao nhiêu so với trung vị thì đáng nói ra.
 *
 * 50% là ngưỡng chọn theo dữ liệu thật chứ không phải con số tròn cho đẹp: trên
 * `Global-Superstore`, `Profit` lệch 3,1 lần (28,61 so với 9,24) và mọi ngành
 * hàng đều lệch trên 2 lần, trong khi các cột đều đặn như `Quantity` gần như
 * không lệch. Đặt thấp hơn thì khối gợi ý hiện gần như mọi lúc và thành thứ
 * người ta học cách phớt lờ — đúng cái phải tránh.
 */
const NGUONG_LECH = 0.5;

/**
 * Quá nửa số nhóm phải lệch thì mới nói.
 *
 * Một nhóm lệch trong hai mươi nhóm là chuyện bình thường của dữ liệu, không
 * phải dấu hiệu chọn sai phép tính.
 */
const TY_LE_NHOM_LECH = 0.5;

export interface LechDto {
  /** Tên thước đo đang dùng trung bình. */
  label: string;
  /** Nhãn nhóm lệch nhất, `null` khi truy vấn không gộp theo chiều nào. */
  nhom: string | null;
  trungBinh: number;
  trungVi: number;
  soNhomLech: number;
  tongNhom: number;
  /**
   * Đi kèm để hai con số trong lời cảnh báo đọc GIỐNG HỆT hai con số trên
   * bảng. Thiếu nó thì một thước đo phần trăm sẽ hiện `0,28` ở đây và `28 %` ở
   * kia — người dùng phải tự đoán xem có phải cùng một thứ không.
   */
  format: MeasureFormat | undefined;
}

/** Vị trí và id của các cột chiều, theo đúng thứ tự chúng xuất hiện. */
function cotChieu(kq: ExplorerResultDto): { id: number; viTri: number }[] {
  return kq.columns.flatMap((c, viTri) => (c.kind === 'dimension' ? [{ id: c.id, viTri }] : []));
}

/**
 * So kết quả trung bình với kết quả trung vị của cùng một câu hỏi.
 *
 * ⚠️ Ghép dòng theo GIÁ TRỊ CHIỀU, không theo chỉ số dòng. `explorer.ts` đặt
 * `order` theo thước đo đầu tiên giảm dần, nên đổi `avg` sang `median` đổi luôn
 * thứ tự dòng trả về — ghép theo chỉ số sẽ so nhầm Technology với Furniture và
 * báo lệch ở chỗ không hề lệch.
 *
 * Trả về thước đo có nhóm lệch nặng nhất, hoặc `null` khi không có gì đáng nói.
 */
export function doLech(
  tb: ExplorerResultDto,
  tv: ExplorerResultDto,
  idDaDoi: ReadonlySet<number>,
): LechDto | null {
  const chieuTb = cotChieu(tb);
  const viTriChieuTv = new Map(cotChieu(tv).map((c) => [c.id, c.viTri]));
  const khoa = (row: readonly (string | number | null)[], viTri: number[]): string =>
    JSON.stringify(viTri.map((i) => row[i]));

  const thuTuTv = chieuTb.map((c) => viTriChieuTv.get(c.id) ?? -1);
  if (thuTuTv.includes(-1)) return null;
  const thuTuTb = chieuTb.map((c) => c.viTri);
  const dongTv = new Map(tv.rows.map((r) => [khoa(r, thuTuTv), r]));

  let nang: LechDto | null = null;
  let nangGap = -1;

  for (const [viTri, cot] of tb.columns.entries()) {
    if (cot.kind !== 'measure' || !idDaDoi.has(cot.id)) continue;
    const viTriTv = tv.columns.findIndex((c) => c.kind === 'measure' && c.id === cot.id);
    if (viTriTv === -1) continue;

    let soNhomLech = 0;
    let tongNhom = 0;
    let dinh: { nhom: string | null; tb: number; tv: number; gap: number } | null = null;

    for (const row of tb.rows) {
      const kia = dongTv.get(khoa(row, thuTuTb));
      if (kia === undefined) continue;
      // Cube trả số dưới dạng CHUỖI qua JSON — xem ghi chú của `formatCell`.
      const a = Number(row[viTri]);
      const m = Number(kia[viTriTv]);
      if (!Number.isFinite(a) || !Number.isFinite(m)) continue;

      tongNhom += 1;
      // Trung vị bằng 0 mà trung bình khác 0 là lệch tuyệt đối — không lập được
      // tỷ lệ, nhưng bỏ qua thì mất đúng ca lệch nặng nhất.
      const gap = m === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - m) / Math.abs(m);
      if (gap <= NGUONG_LECH) continue;
      soNhomLech += 1;
      if (dinh === null || gap > dinh.gap) {
        const nhan = chieuTb.map((c) => String(row[c.viTri] ?? '—')).join(' · ');
        dinh = { nhom: nhan === '' ? null : nhan, tb: a, tv: m, gap };
      }
    }

    if (dinh === null || tongNhom === 0) continue;
    if (soNhomLech < tongNhom * TY_LE_NHOM_LECH) continue;
    // Nhiều thước đo cùng lệch thì chỉ nói về cái lệch nặng nhất. So bằng TỶ LỆ
    // `gap`, không bằng hiệu tuyệt đối — hai thước đo khác đơn vị (tiền và số
    // lượng) thì hiệu tuyệt đối của chúng không so được với nhau.
    if (dinh.gap <= nangGap) continue;
    nangGap = dinh.gap;
    nang = {
      label: cot.label,
      nhom: dinh.nhom,
      trungBinh: dinh.tb,
      trungVi: dinh.tv,
      soNhomLech,
      tongNhom,
      format: cot.format,
    };
  }

  return nang;
}
