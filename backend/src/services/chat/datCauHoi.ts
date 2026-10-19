import { FILTER_OPERATORS, type ExplorerQueryDto, type FilterOperator } from '@bi/shared';

import { coCauHinhLlm, goiMoHinh } from './dienDat';

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
 * Bỏ dấu + hạ chữ thường, để so câu hỏi với giá trị lọc.
 *
 * ⚠️ `đ`/`Đ` phải thay TAY — chúng là ký tự Latin riêng (U+0111/U+0110) nên
 * `NFD` không tách được gì. Cùng cái bẫy đã ghi ở `services/dataset/storageKey.ts`
 * và ở `features/chat/traLoi.ts` bên frontend.
 */
function chuanHoa(raw: string): string {
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

  const loc = o.filters;
  if (loc !== undefined && loc !== null) {
    if (!Array.isArray(loc)) return null;
    const ra: { dimensionId: number; operator: FilterOperator; values: string[] }[] = [];

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

      // ⚠️ Luật canh gác: giá trị phải là lời của chính người dùng.
      if (!giuNguyenLoi(loiNguoiDung(input), values)) return null;

      ra.push({ dimensionId: id, operator, values });
    }

    if (ra.length > 10) return null;
    if (ra.length > 0) truyVan.filters = ra;
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

  const danhSach = truong
    .map((t) => `${String(t.id)} = ${t.nhan} (${t.loai === 'chieu' ? 'chiều' : 'thước đo'})`)
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
     * Rộng hơn `hieuY` vì đầu ra là một object, không phải một con số — nhưng
     * vẫn có trần: một mô hình bắt đầu viết giải thích dài thì nó đã đi sai
     * đường, và `docJson` sẽ bỏ phần thừa chứ không cố hiểu nó.
     */
    700,
  );

  if (noiDung === null) return { truyVan: null, daHoi: daGoi };
  return { truyVan: kiemForm(docJson(noiDung), { ...input, truong }), daHoi: daGoi };
}
