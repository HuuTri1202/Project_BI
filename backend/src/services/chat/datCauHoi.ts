import {
  FILTER_OPERATORS,
  MEASURE_AGGS,
  TIME_GRANULARITIES,
  type ExplorerQueryDto,
  type FilterOperator,
  type MeasureAgg,
  type TimeGranularity,
} from '@bi/shared';

import { coCauHinhLlm, goiMoHinh } from './dienDat';
import { CUM_CO_DINH, giaiCum } from './khoangThoiGian';

export interface TruongChon {
  id: number;
  nhan: string;
  loai: 'chieu' | 'thuoc do';
  thoiGian?: boolean;
  phepGop?: readonly MeasureAgg[];
}

export interface DatCauHoiInput {
  cauHoi: string;
  truong: readonly TruongChon[];
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto } | undefined;
  moc?: Date | undefined;
}

export interface DatCauHoiKetQua {
  truyVan: ExplorerQueryDto | null;
  daHoi: boolean;
  lyDo: LyDoBoForm | null;
}

export const TRAN_TRUONG = 120;

const TRAN_LIMIT = 500;

export function chuanHoa(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function giuNguyenLoi(loiNguoiDung: string, values: readonly string[]): boolean {
  const q = chuanHoa(loiNguoiDung);
  return values.every((v) => {
    const c = chuanHoa(v);
    return c !== '' && q.includes(c);
  });
}

function docJson(raw: string): unknown {
  const dau = raw.indexOf('{');
  const cuoi = raw.lastIndexOf('}');
  if (dau < 0 || cuoi <= dau) return null;
  try {
    return JSON.parse(raw.slice(dau, cuoi + 1));
  } catch {
    return null;
  }
}

function soNguyenDuong(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function loiNguoiDung(input: DatCauHoiInput): string {
  return input.boiCanh === undefined ? input.cauHoi : `${input.boiCanh.cauHoi} ${input.cauHoi}`;
}

function daTinCay(input: DatCauHoiInput, values: readonly string[]): boolean {
  const cu = new Set((input.boiCanh?.truyVan.filters ?? []).flatMap((f) => f.values));
  return values.every((v) => cu.has(v));
}

export type LyDoBoForm = 'gia-tri-la' | 'phep-gop-la' | 'thieu-cot-ngay';

export const LY_DO_NOI: Record<LyDoBoForm, string> = {
  'gia-tri-la':
    'Tôi không chắc giá trị bạn nói được ghi thế nào trong dữ liệu, nên tôi không ' +
    'dám lọc theo nó — lọc sai thì truy vấn trả về rỗng và tôi sẽ nói "không có ' +
    'dòng nào" một cách rất chắc chắn. Thử gõ đúng chữ như nó hiện trong bảng.',
  'phep-gop-la':
    'Thước đo này không nhận phép tính đó. Mở tab Thước đo của mô hình để xem nó ' +
    'nhận phép nào, hoặc tạo một thước đo mới với phép bạn cần.',
  'thieu-cot-ngay':
    'Câu hỏi có mốc thời gian, nhưng mô hình này chưa có cột ngày nào dùng được. ' +
    'Mở tab Schemas và đặt kiểu ngày cho cột thời gian của bảng, rồi hỏi lại.',
};

export function kiemFormCoLyDo(
  tho: unknown,
  input: DatCauHoiInput,
): { truyVan: ExplorerQueryDto | null; lyDo: LyDoBoForm | null } {
  let lyDo: LyDoBoForm | null = null;
  /*
   * `ghi` LUÔN trả `null`, và mọi chỗ gọi nó đều `return ghi(...)`. Nên không
   * có đường nào vừa ghi được lý do vừa dựng xong truy vấn — "form sống" và
   * "có lý do" loại trừ nhau theo cấu trúc, không cần một chốt kiểm lại.
   *
   * Bản đầu có chốt `truyVan === null ? lyDo : null`. Vòng đột biến cho thấy
   * nó SỐNG: xoá chốt đi không bài nào đỏ, vì không ca nào tới được nhánh đó.
   * Một chốt không thể sai là một chốt không nên tồn tại — nó mời người đọc
   * sau đi tìm tình huống nó đang chặn.
   */
  const truyVan = kiemForm(tho, input, (l) => {
    lyDo = l;
    return null;
  });
  return { truyVan, lyDo };
}

export function kiemForm(
  tho: unknown,
  input: DatCauHoiInput,
  ghi: (ly: LyDoBoForm) => null = () => null,
): ExplorerQueryDto | null {
  if (typeof tho !== 'object' || tho === null) return null;
  const o = tho as Record<string, unknown>;

  const chieuHopLe = new Set(input.truong.filter((t) => t.loai === 'chieu').map((t) => t.id));
  const doHopLe = new Set(input.truong.filter((t) => t.loai === 'thuoc do').map((t) => t.id));

  const docIds = (v: unknown, hopLe: Set<number>): number[] | null => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return null;
    const ra: number[] = [];
    for (const x of v) {
      const n = soNguyenDuong(x);
      if (n === null || !hopLe.has(n)) return null;
      if (!ra.includes(n)) ra.push(n);
    }
    return ra;
  };

  const dimensionIds = docIds(o.dimensionIds, chieuHopLe);
  const measureIds = docIds(o.measureIds, doHopLe);
  if (dimensionIds === null || measureIds === null) return null;
  // Cùng luật với `explorerQueryBodySchema`: không chọn gì thì không có câu hỏi.
  if (dimensionIds.length + measureIds.length === 0) return null;

  const truyVan: ExplorerQueryDto = { dimensionIds, measureIds };

  const ra: { dimensionId: number; operator: FilterOperator; values: string[] }[] = [];

  const loc = o.filters;
  if (loc !== undefined && loc !== null) {
    if (!Array.isArray(loc)) return null;

    for (const x of loc) {
      if (typeof x !== 'object' || x === null) return null;
      const f = x as Record<string, unknown>;

      const id = soNguyenDuong(f.dimensionId);
      if (id === null || !chieuHopLe.has(id)) return null;

      const op = f.operator;
      if (typeof op !== 'string' || !(FILTER_OPERATORS as readonly string[]).includes(op)) {
        return null;
      }
      const operator = op as FilterOperator;

      const raw = f.values;
      const values =
        raw === undefined || raw === null
          ? []
          : Array.isArray(raw)
            ? raw.map((v) => (typeof v === 'string' ? v : String(v)))
            : null;
      if (values === null) return null;

      const khongCanGiaTri = operator === 'set' || operator === 'notSet';
      if (khongCanGiaTri ? values.length > 0 : values.length === 0) return null;

      // ⚠️ Luật canh gác: giá trị phải là lời của chính người dùng — hoặc là
      //    thứ CHÍNH HỆ NÀY đã dựng ra ở lượt trước. Xem `daTinCay`.
      if (!giuNguyenLoi(loiNguoiDung(input), values) && !daTinCay(input, values)) {
        return ghi('gia-tri-la');
      }

      ra.push({ dimensionId: id, operator, values });
    }
  }

  /*
   * ─── `khoangThoiGian` — "doanh thu THÁNG NÀY" ────────────────────────────
   *
   * Mô hình chọn MỘT cụm trong danh sách đóng; CODE giải nó thành hai mốc
   * ngày. Xem `khoangThoiGian.ts` cho lý do vì sao chia việc đúng chỗ đó.
   *
   * ⚠️ Hai bộ lọc sinh ra ở đây KHÔNG đi qua `giuNguyenLoi`, và đó là chỗ
   * nguy hiểm nhất của cả hàm — nên nói thẳng vì sao nó vẫn đúng: luật ấy
   * tồn tại để chặn CHUỖI DO MÔ HÌNH BỊA. `2026-10-01` dưới đây không do mô
   * hình viết; nó là kết quả của `giaiCum`, một hàm thuần chạy trên một danh
   * sách đóng. Mô hình không viết nổi một ngày nào vào truy vấn, kể cả khi nó
   * muốn — nó chỉ chọn được tên cụm.
   *
   * Đừng nới chỗ này thành "nhận luôn ngày mô hình viết cho nhanh". Một ngày
   * lệch một tháng vẫn chạy ra số thật, cho một khoảng không ai hỏi.
   */
  const ktg = o.khoangThoiGian;
  if (ktg !== undefined && ktg !== null) {
    if (typeof ktg !== 'object') return null;
    const k = ktg as Record<string, unknown>;

    const id = soNguyenDuong(k.dimensionId);
    if (id === null || !chieuHopLe.has(id)) return null;
    if (input.truong.find((x) => x.id === id && x.loai === 'chieu')?.thoiGian !== true) {
      return ghi('thieu-cot-ngay');
    }

    if (typeof k.cum !== 'string') return null;
    const khoang = giaiCum(k.cum, input.moc ?? new Date());
    if (khoang === null) return null;

    ra.push({ dimensionId: id, operator: 'gte', values: [khoang.tu] });
    ra.push({ dimensionId: id, operator: 'lt', values: [khoang.truocKhi] });
  }

  if (ra.length > 10) return null;
  if (ra.length > 0) truyVan.filters = ra;

  /*
   * ─── `limit` — "top 5" là một phép của TRUY VẤN ──────────────────────────
   *
   * Không có nó thì truy vấn lấy 500 dòng rồi `docKetQua` in ra 15. Với một
   * câu hỏi xuôi chiều thì vô hại; với "5 sản phẩm BÁN CHẬM nhất" thì không,
   * vì lát cắt và hướng sắp quyết định cùng nhau xem TẬP nào được lấy về.
   */
  const tran = o.limit;
  if (tran !== undefined && tran !== null) {
    const n = soNguyenDuong(tran);
    if (n === null || n > TRAN_LIMIT) return null;
    truyVan.limit = n;
  }

  /*
   * ─── `measureAggs` — đánh rơi là trả lời bằng một PHÉP TÍNH khác ─────────
   *
   * Đây là ô nguy hiểm nhất trong ba ô thêm ở đây. "Doanh thu TRUNG BÌNH mỗi
   * đơn" mà rơi mất phép gộp thì câu trả lời là TỔNG doanh thu — một con số
   * thật, định dạng đẹp, mang đúng cái nhãn "Doanh thu", trả lời một câu hỏi
   * khác. `buildQuery` có gắn tên phép vào nhãn cột khi phép bị đổi, nên khi ô
   * này được tôn trọng thì màn hình nói ra; khi nó bị rơi thì không có gì nói.
   *
   * Lọc theo `phepGop` chứ không chỉ theo `MEASURE_AGGS`: một phép hợp lệ về
   * từ vựng nhưng cột không nhận sẽ làm `buildQuery` ném 400.
   */
  const gop = o.measureAggs;
  if (gop !== undefined && gop !== null) {
    if (!Array.isArray(gop)) return null;
    const nhan = new Map(
      input.truong.filter((t) => t.loai === 'thuoc do').map((t) => [t.id, t.phepGop ?? []]),
    );
    const ra: { id: number; agg: MeasureAgg }[] = [];

    for (const x of gop) {
      if (typeof x !== 'object' || x === null) return null;
      const g = x as Record<string, unknown>;

      const id = soNguyenDuong(g.id);
      if (id === null || !doHopLe.has(id)) return null;

      const phep = g.agg;
      if (typeof phep !== 'string' || !(MEASURE_AGGS as readonly string[]).includes(phep)) {
        return null;
      }
      if (!(nhan.get(id) ?? []).includes(phep as MeasureAgg)) return ghi('phep-gop-la');

      ra.push({ id, agg: phep as MeasureAgg });
    }

    if (ra.length > 20) return null;
    if (ra.length > 0) truyVan.measureAggs = ra;
  }

  /*
   * ─── `timeDimension` — "doanh thu THEO THÁNG" ────────────────────────────
   *
   * Không có ô này thì mọi câu hỏi theo thời gian đều nằm ngoài không gian trả
   * lời, trừ khi mô hình tình cờ có sẵn một cột "Tháng" riêng.
   *
   * ⚠️ `thoiGian` là chốt bắt buộc, không phải trang trí: Cube ném lỗi khi gom
   * một cột chuỗi theo tháng, và một lỗi hạ tầng là câu trả lời tệ hơn hẳn
   * "chưa hiểu".
   */
  const tg = o.timeDimension;
  if (tg !== undefined && tg !== null) {
    if (typeof tg !== 'object') return null;
    const t = tg as Record<string, unknown>;

    const id = soNguyenDuong(t.dimensionId);
    if (id === null || !chieuHopLe.has(id)) return null;
    if (input.truong.find((x) => x.id === id && x.loai === 'chieu')?.thoiGian !== true) {
      return ghi('thieu-cot-ngay');
    }

    const muc = t.granularity;
    if (typeof muc !== 'string' || !(TIME_GRANULARITIES as readonly string[]).includes(muc)) {
      return null;
    }

    truyVan.timeDimension = { dimensionId: id, granularity: muc as TimeGranularity };
  }

  return truyVan;
}

function moTaLuotTruoc(input: DatCauHoiInput): string {
  if (input.boiCanh === undefined) return '';
  return (
    `

Lượt hỏi trước: ${input.boiCanh.cauHoi}` +
    `
Form của lượt đó: ${JSON.stringify(input.boiCanh.truyVan)}`
  );
}

const NHAC = [
  'Bạn là bộ điền form truy vấn dữ liệu. Người dùng hỏi một câu tiếng Việt.',
  'Bạn nhận danh sách trường của một mô hình dữ liệu, mỗi trường có id và tên.',
  'Trả về ĐÚNG MỘT object JSON, không viết gì khác, không rào ```:',
  '{"dimensionIds":[id chiều để nhóm theo],"measureIds":[id thước đo để đo],',
  '"filters":[{"dimensionId":id,"operator":"equals","values":["giá trị"]}]}',
  'Toán tử hợp lệ: equals, notEquals, contains, notContains, gt, gte, lt, lte, set, notSet.',
  'set và notSet không có values; các toán tử khác phải có ít nhất một values.',
  'Ba ô KHÔNG bắt buộc, chỉ điền khi câu hỏi thật sự nói tới:',
  '"limit":N khi người dùng xin "top N" hoặc "N cái ... nhất".',
  '"timeDimension":{"dimensionId":id,"granularity":"day|week|month|quarter|year"} khi họ hỏi',
  'theo ngày/tuần/tháng/quý/năm — id PHẢI là một chiều được ghi "gom theo thời gian được".',
  '"measureAggs":[{"id":id,"agg":"avg"}] khi họ đổi phép tính của thước đo (trung bình, nhỏ',
  'nhất, lớn nhất, đếm) — agg PHẢI nằm trong danh sách "phép gộp" của chính thước đo đó.',
  '"khoangThoiGian":{"dimensionId":id,"cum":"thang-nay"} khi câu hỏi có mốc thời gian.',
  `cum CHỈ nhận một trong: ${CUM_CO_DINH.join(', ')}, thang-1..thang-12,`,
  'quy-1..quy-4, nam-2000..nam-2100. TUYỆT ĐỐI không tự viết ngày tháng vào values —',
  'hệ thống tự đổi cum thành ngày. dimensionId phải là chiều "gom theo thời gian được".',
  'thang-3 nghĩa là tháng 3 của năm nay; muốn năm khác thì dùng nam-YYYY.',
  'TUYỆT ĐỐI không điền hướng sắp xếp: hệ thống tự đọc "cao nhất"/"thấp nhất" từ câu hỏi.',
  'CHỈ dùng id có trong danh sách. Tuyệt đối không bịa id.',
  'values PHẢI là chữ lấy nguyên từ câu hỏi của người dùng — không dịch, không viết tắt,',
  'không đổi cách viết. Không chắc giá trị viết thế nào trong dữ liệu thì bỏ filter đó đi.',
  'Câu hỏi không trả lời được bằng các trường này thì trả về {}.',
  'Nếu có mục "Lượt hỏi trước", người dùng đang HỎI TIẾP: lấy form cũ rồi sửa',
  'đúng phần họ vừa nói, giữ nguyên những phần họ không nhắc tới.',
].join(' ');

export async function datCauHoi(input: DatCauHoiInput): Promise<DatCauHoiKetQua> {
  const truong = input.truong.slice(0, TRAN_TRUONG);
  if (!coCauHinhLlm() || truong.length === 0) return { truyVan: null, daHoi: false, lyDo: null };

  /*
   * Mỗi dòng nói thêm ĐÚNG thứ cần để điền hai ô mới, và chỉ khi có thứ đó.
   *
   * Không ghi "gom theo thời gian được" thì mô hình không có cách nào biết
   * chiều nào là ngày tháng — tên cột tiếng Anh viết tắt thì nó đoán, và
   * `kiemForm` sẽ bỏ cả form, tức câu hỏi theo tháng không bao giờ chạy.
   */
  const danhSach = truong
    .map((t) => {
      const loai = t.loai === 'chieu' ? 'chiều' : 'thước đo';
      const them =
        t.loai === 'chieu'
          ? t.thoiGian === true
            ? ', gom theo thời gian được'
            : ''
          : (t.phepGop ?? []).length > 1
            ? `, phép gộp: ${(t.phepGop ?? []).join('/')}`
            : '';
      return `${String(t.id)} = ${t.nhan} (${loai}${them})`;
    })
    .join('\n');

  const { noiDung, daGoi } = await goiMoHinh(
    [
      { role: 'system', content: NHAC },
      {
        role: 'user',
        content: `Câu hỏi: ${input.cauHoi}${moTaLuotTruoc(input)}

Các trường:
${danhSach}`,
      },
    ],
    /*
     * ═══ Vì sao hạn mức RỘNG hẳn, không phải vừa đủ cho JSON ════════════════
     *
     * Object cần trả về dài chừng 40 token. Bản đầu đặt 700 — tưởng là thừa gấp
     * mười lăm lần — và nó CẮT ĐÔI câu trả lời của một lượt hỏi tiếp:
     *
     *     {"dimensionIds":[12],"measureIds":[21],"filters":[{"dimensionId":11,
     *      "operator":"equals","          <- hết hạn mức ở đây
     *
     * Vì mô hình loại "suy nghĩ trước khi trả lời" tiêu token suy nghĩ vào CÙNG
     * hạn mức này mà không trả chúng về trong `content` — và một lượt hỏi tiếp
     * làm nó nghĩ nhiều hơn hẳn một câu hỏi độc lập. `reasoning_effort: 'none'`
     * giảm chuyện đó chứ không bỏ hẳn được; xem `goiMoHinh`.
     *
     * Đo thật: 700 thì "còn theo sản phẩm thì sao" bị cắt và "còn Miền Nam thì
     * sao" trả về rỗng. 2000 thì cả hai ra JSON đủ.
     *
     * Nới hạn mức KHÔNG nới chỗ cho một câu dài lọt qua: `docJson` chỉ đọc đoạn
     * giữa `{` đầu và `}` cuối, rồi `kiemForm` bỏ cả form nếu có một ô sai.
     */
    2000,
  );

  if (noiDung === null) return { truyVan: null, daHoi: daGoi, lyDo: null };
  return { ...kiemFormCoLyDo(docJson(noiDung), { ...input, truong }), daHoi: daGoi };
}
