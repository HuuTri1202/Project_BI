import {
  FILTER_OPERATORS,
  MEASURE_AGGS,
  TIME_GRANULARITIES,
  type ExplorerQueryDto,
  type FilterOperator,
  type MeasureAgg,
  type TimeGranularity,
} from '@bi/shared';

import { docDem, ghiDem, khoaDem } from './dem';
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
  /**
   * Phạm vi của bộ nhớ đệm — `"<tenantId>:<dataModelId>"`.
   *
   * Vắng mặt thì KHÔNG đệm. Nơi gọi phải tự khai, vì cùng một câu hỏi trên hai
   * mô hình khác nhau cho ra hai form khác nhau (id trường khác nhau), và trộn
   * chúng vào một khoá là trả lời tổ chức này bằng form của tổ chức kia.
   */
  pham?: string | undefined;
}

export interface DatCauHoiKetQua {
  truyVan: ExplorerQueryDto | null;
  daHoi: boolean;
  lyDo: LyDoBoForm | null;
  /**
   * Thứ câu hỏi đòi mà mô hình dữ liệu KHÔNG có trường nào tương ứng, gọi bằng
   * đúng chữ của người dùng. Xem `docThieu`.
   */
  thieu: string[];
}

export const TRAN_TRUONG = 120;

const TRAN_LIMIT = 500;

/**
 * Phạm vi và khoá đệm của lớp này. Luật chung — đệm cái gì thì an toàn, vì sao
 * chỉ ghi khi thành công, hạn mức token của nhà cung cấp — nằm ở `dem.ts`.
 *
 * ═══ Riêng lớp này: đệm FORM, KHÔNG đệm câu trả lời ════════════════════════
 *
 * Đệm câu trả lời (có cả con số) là sai: dữ liệu được nạp lại hàng ngày, nên
 * một tiếng sau khung sẽ đọc một con số đã cũ bằng giọng rất chắc chắn. Form
 * thì chỉ nói "nhóm theo Chi nhánh, đo Thành tiền", và truy vấn vẫn chạy lại
 * trên kho MỖI LẦN — nên con số luôn là số mới.
 *
 * Phần BIẾN THIÊN của khoá là câu hỏi đã chuẩn hoá cộng lượt hỏi trước. KHÔNG
 * cần kèm danh sách trường: `pham` là `"<tenantId>:<dataModelId>"`, mà một mô
 * hình chỉ có một danh sách trường tại mỗi thời điểm — và nếu nó vừa đổi thì
 * `kiemForm` bác form cũ ở đúng chỗ nó vẫn luôn bác, vì đệm giữ nguyên văn
 * CHUỖI mô hình trả về chứ không giữ form đã kiểm.
 */
const khoaForm = (input: DatCauHoiInput): string | null => {
  if (input.pham === undefined) return null;
  return khoaDem('form', input.pham, [
    chuanHoa(input.cauHoi),
    input.boiCanh === undefined ? null : [chuanHoa(input.boiCanh.cauHoi), input.boiCanh.truyVan],
  ]);
};

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

export type LyDoBoForm = 'gia-tri-la' | 'phep-gop-la' | 'thieu-cot-ngay' | 'ngay-tu-viet';

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
    'Mở tab Cấu trúc và đặt kiểu ngày cho cột thời gian của bảng, rồi hỏi lại.',
  'ngay-tu-viet':
    'Tôi hiểu được những mốc thời gian có TÊN — hôm nay, tuần này, tháng trước, ' +
    'tháng 10, quý 3, năm 2025 — chứ chưa hiểu một khoảng ngày tự do kiểu "từ 1/10 ' +
    'đến 15/10". Bạn hỏi theo tháng, quý hay năm giúp tôi; hoặc viết ngày đầy đủ ' +
    'kiểu 2026-10-01.',
};

/**
 * Ngày mà ClickHouse chắc chắn đọc được: `YYYY-MM-DD`.
 *
 * Dùng để GÁC, không để phân tích — xem chốt chiều thời gian trong `kiemForm`.
 */
const NGAY_ISO = /^\d{4}-\d{2}-\d{2}$/;

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

      /*
       * ═══ Chiều THỜI GIAN: mô hình không được tự viết ngày ═══════════════
       *
       * Khối chú thích ở ô `khoangThoiGian` phía dưới đã khai đúng luật này —
       * "Mô hình không viết nổi một ngày nào vào truy vấn, kể cả khi nó muốn" —
       * nhưng luật ấy chỉ gác ĐÚNG MỘT CỬA. Cửa còn lại là vòng `filters` này,
       * và `giuNguyenLoi` không đóng được nó: `"1/10"` nằm nguyên trong câu hỏi
       * nên nó là "lời của chính người dùng" theo đúng định nghĩa.
       *
       * LỖI ĐO ĐƯỢC, 24/11/2026. Câu hỏi "doanh thu từ ngày 1/10 đến 15/10" cho
       * ra `{"dimensionId":2568,"operator":"gte","values":["1/10"]}`, ClickHouse
       * nổ ở `Cannot parse DateTime: while converting '1\/10'`, Cube trả 4xx, và
       * `explain` dịch mọi 4xx thành một câu đi TỐ OAN người dùng:
       *
       *     "Mô hình chưa truy vấn được. Kiểm tra tab Quan hệ — có thể hai bảng
       *      chưa được nối, hoặc đang nối vòng."
       *
       * Mô hình dữ liệu không có gì sai. Trước hội đồng thì câu đó còn tệ hơn
       * một câu "chưa hiểu": nó khẳng định sản phẩm đang hỏng ở đúng tính năng
       * vừa được giới thiệu.
       *
       * Ba cửa được mở, và chỉ ba:
       *
       *   - `set`/`notSet` (không có giá trị) — "đơn nào chưa có ngày giao".
       *   - Ngày ISO đầy đủ, tức chính người dùng gõ `2026-10-01`. ClickHouse
       *     đọc được, và `giuNguyenLoi` ở trên đã chứng minh nó là lời của họ.
       *   - Giá trị do LƯỢT TRƯỚC dựng ra (`daTinCay`). Bắt buộc phải mở: lời
       *     nhắc đưa cả form cũ cho mô hình và dặn nó giữ phần không được hỏi
       *     lại, nên một lượt hỏi tiếp LUÔN chép lại hai mốc `giaiCum` đã sinh.
       *     Đóng cửa này là mọi câu "còn Sữa thì sao" sau một câu có mốc thời
       *     gian đều bị bác.
       */
      const laThoiGian = input.truong.find((t) => t.id === id)?.thoiGian === true;
      if (
        laThoiGian &&
        values.length > 0 &&
        !values.every((v) => NGAY_ISO.test(v)) &&
        !daTinCay(input, values)
      ) {
        return ghi('ngay-tu-viet');
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

    /*
     * Cùng một cột KHÔNG được nhóm hai lần.
     *
     * ĐO ĐƯỢC 24/11/2026: "doanh thu theo ngày" làm mô hình điền CẢ HAI ô —
     * `dimensionIds: [Ngày bán]` và `timeDimension: {Ngày bán, day}` — và cả
     * hai đều hợp lệ, nên form đi qua mọi chốt. Màn hình nhận về:
     *
     *     26 Ngày bán và Ngày bán (Ngày): 2026-10-26T00:00:00.000 ·
     *     2026-10-26T00:00:00.000: Thành tiền 3.305.000; …
     *
     * Đúng số, nhưng mỗi dòng in cùng một mốc thời gian hai lần và tiêu đề đọc
     * như một lỗi. Không phải lỗi của mô hình: hỏi "theo ngày" thì điền cả hai
     * ô là một cách đọc hợp lý, chỉ là nó thừa — `timeDimension` ĐÃ nhóm theo
     * cột đó rồi, ở đúng mức người dùng xin.
     *
     * Bỏ ở ĐÂY chứ không ở `docKetQua`: một truy vấn nhóm trùng còn kéo về
     * nhiều dòng hơn cần từ ClickHouse, và lớp đọc kết quả thì không có thẩm
     * quyền sửa truy vấn.
     */
    truyVan.dimensionIds = truyVan.dimensionIds.filter((d) => d !== id);
  }

  return truyVan;
}

/**
 * Thứ câu hỏi đòi mà mô hình KHÔNG có — do chính mô hình ngôn ngữ tự khai.
 *
 * ═══ Lỗi mà ô này vá, và vì sao nó không thể là một chốt KIỂM ════════════════
 *
 * ĐO ĐƯỢC 24/11/2026, hạng lỗi SAI MỘT CÁCH TỰ TIN:
 *
 *     "chi phí vận chuyển theo chi nhánh"   (dữ liệu KHÔNG có cột chi phí)
 *       -> "4 Chi nhánh: Gò Vấp: Thành tiền 10.833.000; …"
 *
 * Không một chữ lưu ý nào. Người đọc hỏi về CHI PHÍ và nhận về DOANH THU, mang
 * đúng nhãn "Thành tiền" — đúng số, trả lời một câu hỏi khác. Trước hội đồng thì
 * một con số đưa ra để trả lời câu hỏi về chi phí sẽ được hiểu LÀ chi phí.
 *
 * Lời nhắc đã dặn "không trả lời được bằng các trường này thì trả về {}", và nó
 * KHÔNG đủ: đo lại cùng ngày thì "lợi nhuận gộp quý 4" lúc trả `{}` lúc trả
 * Thành tiền. Mô hình thấy một thước đo "gần đúng" thì nó điền.
 *
 * Nên đổi câu hỏi đặt cho nó: thay vì bắt nó TỪ CHỐI (mất cả câu trả lời đúng
 * khi nó nhầm), bắt nó KHAI ra thứ nó không tìm thấy. Việc khai thì nó làm được,
 * và cái giá của mỗi hướng hỏng đều nhẹ:
 *
 *   - Khai thiếu → hệ thống im như hiện tại, không tệ hơn.
 *   - Khai thừa → một câu dặn không cần thiết, câu trả lời vẫn đi ra.
 *
 * Cùng lập luận với `CHUA_DIEN_DAT` ở `hoiTrenMoHinh`: chỉ được THÊM một lời
 * lưu ý, không bao giờ được chặn.
 *
 * ⚠️ `giuNguyenLoi` là chốt bắt buộc, không phải trang trí: không có nó thì mô
 * hình bịa ra được một cụm nào đó rồi hệ thống đi xin lỗi người dùng về một thứ
 * họ chưa từng hỏi.
 */
function docThieu(tho: unknown, input: DatCauHoiInput): string[] {
  if (typeof tho !== 'object' || tho === null) return [];
  const v = (tho as Record<string, unknown>).thieu;
  if (!Array.isArray(v)) return [];

  return (
    v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      // Cận 60 ký tự: một cụm danh từ, không phải cả câu hỏi chép lại. Mô hình
      // chép nguyên câu vào đây thì `giuNguyenLoi` vẫn cho qua (câu nằm trong
      // chính nó), và câu lưu ý sẽ đọc như một lời nhại lại.
      .filter((x) => x !== '' && x.length <= 60 && giuNguyenLoi(loiNguoiDung(input), [x]))
      .slice(0, 3)
  );
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
  '"thieu":["chi phí vận chuyển"] khi câu hỏi đòi một chỉ số hoặc một cột mà danh sách',
  'trường KHÔNG có. Ghi nguyên chữ người dùng dùng để gọi nó, mỗi thứ một phần tử.',
  'Vẫn điền phần form trả lời được; đừng vì có "thieu" mà trả về {}.',
  'CHỈ ghi khi đã xem hết danh sách và không trường nào mang nghĩa đó. Một trường mang',
  'nghĩa đó nhưng TÊN KHÁC thì KHÔNG phải thiếu — "doanh thu" chính là "Thành tiền",',
  '"số đơn" chính là "Số dòng". Không thiếu gì thì bỏ hẳn ô "thieu".',
  'values PHẢI là chữ lấy nguyên từ câu hỏi của người dùng — không dịch, không viết tắt,',
  'không đổi cách viết. Không chắc giá trị viết thế nào trong dữ liệu thì bỏ filter đó đi.',
  'Câu hỏi không trả lời được bằng các trường này thì trả về {}.',
  'Nếu có mục "Lượt hỏi trước", người dùng đang HỎI TIẾP: lấy form cũ rồi sửa',
  'đúng phần họ vừa nói, giữ nguyên những phần họ không nhắc tới.',
].join(' ');

export async function datCauHoi(input: DatCauHoiInput): Promise<DatCauHoiKetQua> {
  const truong = input.truong.slice(0, TRAN_TRUONG);
  if (!coCauHinhLlm() || truong.length === 0) {
    return { truyVan: null, daHoi: false, lyDo: null, thieu: [] };
  }

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

  /*
   * Đọc đệm TRƯỚC khi gọi mô hình. `daHoi: true` là đúng: form này do mô hình
   * viết ra thật, chỉ là nó viết ở một lượt trước. Giao diện dùng cờ đó để phân
   * biệt "đã đọc hết mà không thấy" với "chưa gọi được mô hình", và ở đây mô
   * hình đã trả lời.
   */
  const khoa = khoaForm(input);
  if (khoa !== null) {
    const daCo = await docDem(khoa);
    if (daCo !== null) {
      const tho = docJson(daCo);
      const kq = kiemFormCoLyDo(tho, { ...input, truong });
      // Form cũ không còn hợp (mô hình vừa đổi trường) thì bỏ qua đệm và hỏi
      // lại mô hình — không trả về bế tắc chỉ vì có một bản đệm.
      if (kq.truyVan !== null) {
        return { ...kq, daHoi: true, thieu: docThieu(tho, { ...input, truong }) };
      }
    }
  }

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

  if (noiDung === null) return { truyVan: null, daHoi: daGoi, lyDo: null, thieu: [] };

  const tho = docJson(noiDung);
  const kq = kiemFormCoLyDo(tho, { ...input, truong });
  if (khoa !== null && kq.truyVan !== null) await ghiDem(khoa, noiDung);
  return { ...kq, daHoi: daGoi, thieu: docThieu(tho, { ...input, truong }) };
}
