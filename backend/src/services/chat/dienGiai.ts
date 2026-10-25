import {
  FILTER_OPERATOR_LABELS,
  type ExplorerQueryDto,
  type ExplorerResultDto,
  type MeasureFormat,
} from '@bi/shared';

function docSo(value: number, format: MeasureFormat | undefined): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }
  return value.toLocaleString('vi-VN');
}

function docO(value: string | number | null, format: MeasureFormat | undefined): string {
  if (value === null) return '(trống)';
  if (typeof value === 'number') return docSo(value, format);
  // Cube trả thước đo về dạng chuỗi số khá thường xuyên. Đọc lại thành số để
  // câu trả lời dùng cùng dấu phân cách với mọi chỗ khác trên màn hình.
  const n = Number(value);
  return value.trim() !== '' && !Number.isNaN(n) && format !== undefined ? docSo(n, format) : value;
}

function noi(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

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

const TRAN_DONG = 15;

export interface TraLoiTruyVan {
  cau: string;
  so: string[];
  hieuLa: string;
}

export function docKetQua(
  kq: ExplorerResultDto,
  truyVan: ExplorerQueryDto,
  nhanCua: Map<number, string>,
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
