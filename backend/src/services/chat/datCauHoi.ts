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

/**
 * Để mô hình ĐIỀN MỘT CÁI FORM truy vấn — không để nó viết truy vấn.
 *
 * ═══ Trần mà lớp này phá ═══════════════════════════════════════════════════
 *
 * `hieuY` cho mô hình chọn một mục trong danh sách sẵn có, nên khung chỉ trả
 * lời được những câu mà một trang nào đó ĐÃ tải sẵn câu trả lời. "Doanh thu
 * tháng 3 của Miền Bắc" thì không: nó cần một truy vấn MỚI, và không ô biểu đồ
 * nào trên màn hình có nó.
 *
 * ═══ Vì sao đây KHÔNG phải text-to-SQL ════════════════════════════════════
 *
 * Text-to-SQL để mô hình viết ra một CHUỖI, và khi đó phải chống injection,
 * chặn `DROP`, chặn truy vấn chéo tổ chức, và một câu `JOIN` sai vẫn ra số
 * trông hợp lý. Ở đây mô hình điền `explorerQueryBodySchema` — một form mà
 * TOÀN BỘ định danh là SỐ NGUYÊN:
 *
 *     { dimensionIds: [12], measureIds: [34], filters: [{ dimensionId, operator, values }] }
 *
 * Nên không gian đầu ra vẫn ĐÓNG, y như `hieuY`, chỉ là form có bốn ô thay vì
 * một ô:
 *
 *   - Mỗi id phải nằm trong danh sách trường ta vừa gửi. Id lạ -> bỏ CẢ FORM.
 *   - `operator` phải nằm trong `FILTER_OPERATORS`. Toán tử lạ -> bỏ cả form.
 *   - Tên cube, tên cột, câu SQL đều do `buildQuery` dựng từ id. Mô hình không
 *     chạm tới một ký tự nào của chúng.
 *   - Con số trong câu trả lời do Cube tính và do code đọc ra. Mô hình không
 *     thấy số liệu, và không viết câu trả lời.
 *
 * ═══ Chỗ DUY NHẤT mô hình sinh ra chuỗi, và cách bịt nó ═══════════════════
 *
 * `filters[].values`. Mô hình phải viết ra "Miền Bắc" để lọc theo Miền Bắc —
 * và nếu nó viết "Miền Bắc Trung Bộ" thì truy vấn trả về không dòng nào, rồi
 * khung nói "không có dữ liệu" một cách rất tự tin. Đó là lời nói dối khó bắt
 * nhất ở đây: nó TRUNG THỰC về truy vấn đã chạy, và truy vấn đó thì sai.
 *
 * Luật bịt: mỗi giá trị PHẢI xuất hiện trong chính câu người dùng gõ. Xem
 * `giuNguyenLoi`. Cùng họ với `giuNguyenSo` của `dienDat`, và cùng lý do nằm ở
 * backend: frontend sửa được.
 */

/** Một trường gửi cho mô hình chọn. Chỉ id + nhãn, không có số liệu nào. */
export interface TruongChon {
  id: number;
  nhan: string;
  loai: 'chieu' | 'thuoc do';
  /**
   * Chiều này gom theo thời gian được không — chỉ có nghĩa với `loai: 'chieu'`.
   *
   * Cần thiết vì `timeDimension` gom một cột theo tháng/quý/năm, và Cube ném
   * lỗi khi cột đó là chuỗi. Không có trường này thì mô hình gom "Tên sản phẩm"
   * theo tháng được, và người dùng nhận một lỗi 500 thay vì "chưa hiểu".
   */
  thoiGian?: boolean;
  /**
   * MỌI phép gộp thước đo này nhận — chỉ có nghĩa với `loai: 'thuoc do'`.
   *
   * Gồm cả phép ĐANG KHAI lẫn các phép đổi được (`availableAggs`), vì đó đúng
   * là tập mà `buildQuery` chấp nhận. Nó ném `HttpError 400` cho một phép ngoài
   * tập — cố ý, để không ai lặng lẽ nhận số tính bằng phép khác. Nhưng ở đường
   * hỏi đáp thì một 400 là câu trả lời tệ hơn "chưa hiểu", nên `kiemForm` chặn
   * trước, và nó chỉ chặn được khi biết tập này.
   */
  phepGop?: readonly MeasureAgg[];
}

export interface DatCauHoiInput {
  cauHoi: string;
  truong: readonly TruongChon[];
  /**
   * Lượt hỏi TRƯỚC trong cùng cuộc trò chuyện — bộ nhớ hội thoại (bước 6).
   *
   * ═══ Vì sao giữ TRUY VẤN, không giữ đoạn chat ═════════════════════════════
   *
   * "Còn tháng 4 thì sao" chỉ có nghĩa khi biết lượt trước hỏi gì. Cách hiển
   * nhiên là gửi cả lịch sử hội thoại lên cho mô hình đọc. Nó chạy được, và nó
   * tốn dần theo độ dài cuộc trò chuyện, rồi mỗi lượt lại cho mô hình thêm một
   * cơ hội lạc khỏi câu hỏi thật.
   *
   * Thứ thật sự cần nhớ là CÁI FORM: một lượt hỏi tiếp gần như luôn là "form
   * cũ, sửa một ô". Giữ nó nghĩa là bộ nhớ có kích thước KHÔNG ĐỔI, và mô hình
   * nhận một thứ đã được kiểm xong chứ không phải văn bản tự do.
   *
   * ⚠️ Nó ĐI TỪ CLIENT lên, nên nó phải qua `explorerQueryBodySchema` y như mọi
   * thân request khác. Điều đó không thêm quyền cho ai: ai gọi được đường này
   * đã có `datamodel:read`, tức đã gọi thẳng `/query` với bất kỳ form nào.
   */
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto } | undefined;
  /**
   * "Bây giờ" theo đó mà giải cụm thời gian. Vắng mặt = `new Date()`.
   *
   * Có mặt CHỈ để test chốt được mốc. Một hàm ngày tháng tự đọc `Date.now()`
   * thì không kiểm được, và nó sẽ đỏ đúng vào ngày cuối tháng.
   */
  moc?: Date | undefined;
}

export interface DatCauHoiKetQua {
  /** Form đã kiểm xong, hoặc `null` khi không dùng được. */
  truyVan: ExplorerQueryDto | null;
  /** Mô hình có THẬT SỰ được hỏi không — xem `HieuYKetQua.daHoi`. */
  daHoi: boolean;
}

/**
 * Trần số trường gửi lên.
 *
 * Một mô hình 20 bảng × 24 cột là gần năm trăm trường. Gửi hết vừa tốn vừa làm
 * mô hình chọn kém đi. Người gọi xếp chiều và thước đo xen nhau theo thứ tự của
 * `explorerFields`, vốn đã nhóm theo bảng.
 */
export const TRAN_TRUONG = 120;

/**
 * Trần `limit` mà một câu hỏi trò chuyện được phép đặt.
 *
 * Thấp hơn hẳn trần 5000 của `explorerQueryBodySchema`, và vì một lý do khác
 * hẳn: ở đây `limit` chỉ sinh ra từ chữ "top N" trong một câu nói, mà "top
 * 501" thì không phải là một câu nói. `docKetQua` cũng chỉ đọc ra 15 dòng.
 */
const TRAN_LIMIT = 500;

/**
 * Bỏ dấu + hạ chữ thường, để so câu hỏi với giá trị lọc.
 *
 * ⚠️ `đ`/`Đ` phải thay TAY — chúng là ký tự Latin riêng (U+0111/U+0110) nên
 * `NFD` không tách được gì. Cùng cái bẫy đã ghi ở `services/dataset/storageKey.ts`
 * và ở `features/chat/traLoi.ts` bên frontend.
 *
 * Xuất ra để `hoiTrenMoHinh` đọc hướng sắp bằng ĐÚNG phép chuẩn hoá này — hai
 * bản chuẩn hoá hơi khác nhau trong cùng một đường là một lớp lỗi vô hình.
 */
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

/**
 * Mọi giá trị lọc có nằm trong chính câu người dùng gõ không.
 *
 * ═══ Vì sao luật này là luật quan trọng nhất của cả lớp ═══════════════════
 *
 * Đây là chỗ duy nhất mô hình sinh ra chuỗi tự do, nên nó là chỗ duy nhất một
 * điều sai có thể đi vào truy vấn mà không ai thấy. Một giá trị bịa ra không
 * làm hệ thống hỏng — nó làm truy vấn trả về rỗng, và khung nói "không có dòng
 * nào thoả" bằng giọng chắc chắn. Người dùng không có cách nào biết là điều
 * kiện đã bị đổi.
 *
 * So bằng CHUỖI CON trên bản đã bỏ dấu: người ta gõ "miền bắc", mô hình viết
 * "Miền Bắc", và hai thứ đó phải khớp. Còn "Q1" khi người ta gõ "quý 1" thì
 * KHÔNG khớp — và từ chối là đúng, vì ta không biết "Q1" có phải cách dữ liệu
 * ghi quý một hay không.
 *
 * ═══ Khi có bộ nhớ hội thoại, "lời người dùng" là CẢ CUỘC TRÒ CHUYỆN ══════
 *
 * Lượt hỏi tiếp giữ lại bộ lọc của lượt trước: "doanh thu Miền Bắc" rồi "còn
 * tháng 4 thì sao" thì form mới vẫn phải lọc Miền Bắc, mà chữ đó nằm ở câu
 * TRƯỚC. So chỉ với câu mới nhất là luật tự bác bỏ mọi lượt hỏi tiếp.
 *
 * Nên `loiNguoiDung` là câu mới NỐI câu trước. Luật vẫn giữ đúng nghĩa của nó:
 * giá trị phải là chữ mà CHÍNH NGƯỜI DÙNG đã nói ra, ở đâu đó trong cuộc trò
 * chuyện này — chỉ không còn đòi nó nằm trong câu cuối.
 *
 * Xuất ra để test riêng: đây là luật canh gác, nên nó phải kiểm được một mình.
 */
export function giuNguyenLoi(loiNguoiDung: string, values: readonly string[]): boolean {
  const q = chuanHoa(loiNguoiDung);
  return values.every((v) => {
    const c = chuanHoa(v);
    return c !== '' && q.includes(c);
  });
}

/** Đọc JSON mô hình trả về, chịu được rào ```json và chữ thừa quanh nó. */
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

/**
 * Kiểm form mô hình điền. `null` = bỏ, và bỏ CẢ FORM chứ không vá từng ô.
 *
 * ═══ Vì sao bỏ cả form, không bỏ từng ô sai ═══════════════════════════════
 *
 * Vì vá từng ô đổi CÂU HỎI. Bỏ một `filters` sai đi thì truy vấn còn lại chạy
 * được và trả về một con số đúng — của toàn bộ dữ liệu, cho một câu hỏi về Miền
 * Bắc. Bỏ một `dimensionIds` sai thì còn lại một con số tổng, cho một câu hỏi
 * về từng vùng. Cả hai đều là con số thật trả lời một câu hỏi khác, tức đúng
 * thứ cả thiết kế này dựng lên để chặn.
 *
 * Bỏ cả form thì khung nói "chưa hiểu" — một kết cục nhìn thấy được.
 */
/** Mọi chữ người dùng đã nói trong cuộc trò chuyện này. */
function loiNguoiDung(input: DatCauHoiInput): string {
  return input.boiCanh === undefined ? input.cauHoi : `${input.boiCanh.cauHoi} ${input.cauHoi}`;
}

/**
 * Giá trị này đã nằm trong form ĐÃ ĐƯỢC KIỂM của lượt trước chưa.
 *
 * ═══ Vì sao cần một cửa thứ hai bên cạnh `giuNguyenLoi` ═══════════════════
 *
 * Vì `khoangThoiGian` sinh ra `2026-10-01`, và chuỗi đó không bao giờ có
 * trong lời người dùng. Lượt sau ("còn Miền Nam thì sao") mô hình giữ lại cả
 * form cũ — đúng như nó được dạy — nên nó chép lại cái ngày ấy, rồi
 * `giuNguyenLoi` bác, rồi CẢ FORM bị bỏ. Hậu quả: mọi câu hỏi tiếp sau một
 * câu có mốc thời gian đều thành "chưa hiểu".
 *
 * Luật không bị nới, nó được nói chính xác hơn: giá trị phải là chữ của
 * NGƯỜI DÙNG, hoặc là chữ CHÍNH HỆ NÀY đã dựng và đã kiểm ở lượt trước. Thứ
 * duy nhất vẫn bị chặn — và là thứ luật này sinh ra để chặn — là một chuỗi
 * mô hình tự nghĩ ra.
 *
 * ⚠️ `boiCanh` đi từ client lên, nên nó không được tin vì "backend từng dựng
 * ra nó": nó đã qua `explorerQueryBodySchema` như mọi thân request khác, và
 * mọi `dimensionId` trong đó vẫn bị kiểm lại ở vòng trên. Cái được thừa
 * hưởng chỉ là mấy GIÁ TRỊ — và ai gọi được đường này thì đã có
 * `datamodel:read`, tức đã gọi thẳng `/query` với bất kỳ bộ lọc nào.
 */
function daTinCay(input: DatCauHoiInput, values: readonly string[]): boolean {
  const cu = new Set((input.boiCanh?.truyVan.filters ?? []).flatMap((f) => f.values));
  return values.every((v) => cu.has(v));
}

export function kiemForm(tho: unknown, input: DatCauHoiInput): ExplorerQueryDto | null {
  if (typeof tho !== 'object' || tho === null) return null;
  const o = tho as Record<string, unknown>;

  const chieuHopLe = new Set(input.truong.filter((t) => t.loai === 'chieu').map((t) => t.id));
  const doHopLe = new Set(input.truong.filter((t) => t.loai === 'thuoc do').map((t) => t.id));

  /** Đọc một mảng id, và trả `null` nếu có BẤT KỲ id nào ngoài danh sách. */
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
      if (!giuNguyenLoi(loiNguoiDung(input), values) && !daTinCay(input, values)) return null;

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
    if (input.truong.find((x) => x.id === id && x.loai === 'chieu')?.thoiGian !== true) return null;

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
      if (!(nhan.get(id) ?? []).includes(phep as MeasureAgg)) return null;

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
    if (input.truong.find((x) => x.id === id && x.loai === 'chieu')?.thoiGian !== true) return null;

    const muc = t.granularity;
    if (typeof muc !== 'string' || !(TIME_GRANULARITIES as readonly string[]).includes(muc)) {
      return null;
    }

    truyVan.timeDimension = { dimensionId: id, granularity: muc as TimeGranularity };
  }

  return truyVan;
}

/**
 * Lượt hỏi trước, viết ra cho mô hình đọc.
 *
 * Gửi JSON của chính cái form, không phải văn xuôi: mô hình phải SỬA một
 * object, và cho nó thấy đúng hình dạng mà nó sắp trả về là cách ngắn nhất để
 * nói điều đó.
 */
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

/**
 * Nhờ mô hình điền form. Mọi trục trặc đều ra `truyVan: null`.
 *
 * Cùng khuôn chịu lỗi với `dienDat` và `hieuY`: chưa cấu hình, mất mạng, hết
 * lượt, JSON rác, id bịa — tất cả cho cùng một kết quả, và khung hỏi đáp quay
 * về đúng hành vi nó vẫn có khi không có mô hình nào.
 */
export async function datCauHoi(input: DatCauHoiInput): Promise<DatCauHoiKetQua> {
  const truong = input.truong.slice(0, TRAN_TRUONG);
  if (!coCauHinhLlm() || truong.length === 0) return { truyVan: null, daHoi: false };

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

  if (noiDung === null) return { truyVan: null, daHoi: daGoi };
  return { truyVan: kiemForm(docJson(noiDung), { ...input, truong }), daHoi: daGoi };
}
