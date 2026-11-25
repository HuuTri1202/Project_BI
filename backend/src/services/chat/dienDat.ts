import { env } from '../../config/env';

import { docDem, ghiDem, khoaDem } from './dem';

export interface DienDatInput {
  cauHoi: string;
  cau: string;
  so: string[];
  /**
   * Phạm vi đệm — `"<tenantId>"`. Vắng mặt thì KHÔNG đệm.
   *
   * Chỉ cần `tenantId`: phần biến thiên của khoá là chính `cau`, và `cau` là
   * thứ DUY NHẤT đi vào lời nhắc (xem khối "CÂU HỎI KHÔNG ĐƯỢC ĐI VÀO LỜI
   * NHẮC" ở dưới), nên hai câu gốc giống nhau phải cho ra cùng một bản viết
   * lại. Kèm tổ chức để giữ đúng luật cách ly của `dem.ts`.
   */
  pham?: string | undefined;
}

export function diaChiGoi(): string {
  return `${String(env.LLM_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
}

const SEED = 7;

/**
 * Còn gửi `seed` hay không.
 *
 * ═══ Vì sao KHÔNG còn gửi `reasoning_effort` ═══════════════════════════════
 *
 * Bản trước gửi `reasoning_effort: 'none'`, và nhà cung cấp đang dùng (Groq)
 * TỪ CHỐI giá trị đó:
 *
 *     HTTP 400 — `reasoning_effort` must be one of `low`, `medium`, or `high`
 *
 * Đo ngày 24/11/2026. Hậu quả không phải một lượt gọi hỏng mà là hai thứ: lần
 * gọi ĐẦU TIÊN của mỗi lần khởi động server luôn tốn hai vòng mạng (400 rồi
 * gọi lại), và `seed` bị bỏ theo vì nó nằm cùng một bó — nên tham số duy nhất
 * nhắm vào tính lặp lại chưa bao giờ được gửi đi.
 *
 * Đã đo `'low'` (giá trị nhà này nhận): token giảm 1.057 -> 929 nhưng form mất
 * `limit: 1` cho câu "chi nhánh nào doanh thu cao nhất", tức đổi độ chính xác
 * lấy 12% token. Không đáng, nên bỏ hẳn tham số và để nhà cung cấp dùng mặc
 * định của nó. 189 token suy luận mỗi lượt vẫn nằm gọn trong `max_tokens`.
 *
 * `seed` thì GIỮ, và giữ một mình.
 *
 * ⚠️ Nói đúng mức bằng chứng: `seed` KHÔNG bảo đảm được tính lặp lại ở nhà này.
 * Hai lượt gọi giống hệt nhau cho ra cùng một JSON nhưng số token suy luận lệch
 * (195 và 189), nên nó là một gợi ý cho nhà cung cấp, không phải một lời hứa.
 * Thứ THẬT SỰ làm cho cùng một câu hỏi cho ra cùng một câu trả lời là bộ nhớ
 * đệm form ở `datCauHoi` — xem khối chú thích ở đó.
 */
let nhanThamSoPhu = true;

export async function goiMoHinh(
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<{ noiDung: string | null; daGoi: boolean }> {
  const than = (kemThamSoPhu: boolean): string =>
    JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0,
      max_tokens: maxTokens,
      messages,
      ...(kemThamSoPhu ? { seed: SEED } : {}),
    });

  const goi = (kemThamSoPhu: boolean): Promise<Response> =>
    fetch(diaChiGoi(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(env.LLM_API_KEY)}`,
      },
      body: than(kemThamSoPhu),
      signal: AbortSignal.timeout(8_000),
    });

  try {
    let res = await goi(nhanThamSoPhu);

    /*
     * CHỈ 400 mới có nghĩa "nhà này không nhận tham số".
     *
     * Bản trước thử lại với MỌI mã lỗi, và tắt `nhanThamSoPhu` vĩnh viễn theo.
     * Nên một lượt 429 (hết hạn mức token/phút — chuyện xảy ra sau chừng bảy
     * câu hỏi liên tiếp, xem `datCauHoi`) làm server mất `seed` cho tới lần
     * khởi động sau, dù nhà cung cấp chưa hề nói gì về tham số. Và gọi lại ngay
     * khi vừa bị 429 thì chỉ ăn thêm một lượt 429 nữa.
     */
    if (res.status === 400 && nhanThamSoPhu) {
      nhanThamSoPhu = false;
      res = await goi(false);
    }

    /*
     * ⚠️ Lỗi HTTP là GỌI HỎNG, không phải "mô hình đã đọc xong".
     *
     * Bản trước trả `daGoi: true` ở đây, và hậu quả nằm ở tận giao diện: khung
     * đọc `daHoi` rồi nói "Tôi đã đọc hết số liệu đang có trên trang này và
     * không có mục nào trả lời được câu này". Nhà cung cấp vừa trả 500 hay 429
     * mà khung lại khẳng định đã đọc hết — một câu nói sai, nói rất chắc chắn,
     * đúng lúc người dùng không có cách nào kiểm lại.
     */
    if (!res.ok) {
      /*
       * GHI LẠI mã lỗi. Không log là không nhìn thấy.
       *
       * Cả buổi thử 24/11/2026 không có một dòng log nào trong khi khung trả
       * lời rỗng mười sáu câu liền — vì chỗ này nuốt gọn cả 400 lẫn 429. Người
       * vận hành không có cách nào biết mình đang hết hạn mức hay sai cấu hình.
       *
       * Chỉ ghi MÃ, không ghi thân phản hồi: thân có thể mang lại nội dung câu
       * hỏi của người dùng.
       */
      console.warn('[chat] nhà cung cấp mô hình trả về HTTP', res.status);
      return { noiDung: null, daGoi: false };
    }
    return { noiDung: docCau(await res.json()), daGoi: true };
  } catch (err) {
    // Quá hạn 8 giây, mất mạng, DNS hỏng — ba thứ trông giống nhau từ ngoài và
    // đều dẫn tới một khung chat im lặng. Ghi lại để phân biệt được với 429.
    console.warn(
      '[chat] không gọi được nhà cung cấp mô hình:',
      err instanceof Error ? err.message : err,
    );
    return { noiDung: null, daGoi: false };
  }
}

export function quenThamSoPhu(): void {
  nhanThamSoPhu = true;
}

export function coCauHinhLlm(): boolean {
  return (
    env.LLM_BASE_URL !== undefined && env.LLM_API_KEY !== undefined && env.LLM_MODEL !== undefined
  );
}

export function giuNguyenSo(cau: string, so: string[]): boolean {
  return so.every((s) => cau.includes(s));
}

const NHAC = [
  'Bạn viết lại một câu trả lời đã có sẵn cho người dùng Việt Nam.',
  'Viết thành câu tiếng Việt hoàn chỉnh, tự nhiên, có chủ ngữ và vị ngữ — đừng để nó đọc như một dòng bảng kiểu "Nhãn: số".',
  'Nêu rõ bằng CHỮ là con số đó nói về cái gì, rồi mới tới con số. Tối đa hai câu.',
  'Nếu câu gốc liệt kê nhiều tên, hãy giữ đủ các tên đó và đọc chúng ra thành lời.',
  'TUYỆT ĐỐI giữ nguyên từng con số, đúng từng ký tự, kể cả dấu chấm và dấu phẩy.',
  'Không thêm con số nào. Không thêm nhận định hay suy luận nào không có trong câu gốc.',
  'Nếu câu gốc có ghi điều kiện của con số (ví dụ chỉ tính trên các nhóm đang hiện, hay tra trên toàn bộ tổ chức) thì PHẢI giữ lại.',
  'Chỉ trả về câu đã viết lại, không giải thích gì thêm.',
].join(' ');

/*
 * ═══ CÂU HỎI KHÔNG ĐƯỢC ĐI VÀO LỜI NHẮC ════════════════════════════════════
 *
 * `input.cauHoi` có trong hợp đồng của endpoint và CỐ Ý không được dùng ở đây.
 *
 * LỖI ĐO ĐƯỢC, ảnh chụp 20/11/2026. Người dùng hỏi "chi nhánh nào doanh thu
 * cao nhất"; câu mẫu frontend tính ra là
 *
 *   Cao nhất là don-hang-nha-go — "Số báo cáo đang dùng mô hình": 1 — so trên 4 mục…
 *
 * một câu TRẬT ĐỀ, nhưng trung thực: nó nói rõ con số ấy đo cái gì. Bản trước
 * gửi kèm câu hỏi, và mô hình — bị dặn "nêu rõ bằng CHỮ là con số đó nói về cái
 * gì" — bắc cầu qua chỗ hổng bằng chính chủ ngữ của câu hỏi:
 *
 *   "Chi nhánh có doanh thu cao nhất là don-hang-nha-go (2); số báo cáo…"
 *
 * Một câu trật đề biến thành một câu SAI, sai theo cách không ai kiểm lại được.
 *
 * ⚠️ `giuNguyenSo` KHÔNG bắt được ca này: mọi con số đều còn nguyên. Thứ bị
 * thêm vào là một CHỦ NGỮ. Một chốt "phải giữ nhãn gốc" cũng không bắt được —
 * nhãn "số báo cáo đang dùng mô hình" vẫn nằm nguyên trong câu đã viết lại,
 * chỉ bị đẩy xuống làm vế sau.
 *
 * Nên chốt duy nhất đứng vững là KHÔNG ĐƯA câu hỏi cho mô hình: thứ nó không
 * biết thì nó không mượn được. Câu mẫu đã mang đủ nhãn, con số và điều kiện —
 * đúng ba thứ mà việc viết lại cần.
 */

export async function dienDat(input: DienDatInput): Promise<string> {
  if (!coCauHinhLlm()) return input.cau;

  /*
   * Đọc đệm TRƯỚC khi gọi mô hình — xem `dem.ts`.
   *
   * ⚠️ Vẫn chạy lại `giuNguyenSo` trên bản đọc từ đệm. Khoá chỉ chứa `cau`, nên
   * về lý `so` của lượt này luôn là `so` của chính câu đó; nhưng luật canh gác
   * thì không nên phụ thuộc vào một suy luận, nó nên tự kiểm.
   */
  const khoa = input.pham === undefined ? null : khoaDem('dien-dat', input.pham, input.cau);
  if (khoa !== null) {
    const daCo = await docDem(khoa);
    if (daCo !== null && giuNguyenSo(daCo, input.so)) return daCo;
  }

  const { noiDung } = await goiMoHinh(
    [
      { role: 'system', content: NHAC },
      { role: 'user', content: `Câu trả lời cần viết lại: ${input.cau}` },
    ],
    800,
  );
  if (noiDung === null || noiDung.trim() === '') return input.cau;

  // Luật canh gác. Không log con số ra ngoài — chỉ cần biết là đã bỏ.
  if (!giuNguyenSo(noiDung, input.so)) {
    console.warn('[chat] bỏ câu mô hình viết lại: có con số bị đổi');
    return input.cau;
  }

  const cat = noiDung.trim();
  // CHỈ ghi khi mô hình thật sự viết lại được VÀ bản viết lại qua được luật
  // canh gác — cùng lập luận với `datCauHoi`.
  if (khoa !== null) await ghiDem(khoa, cat);
  return cat;
}

function docCau(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  if (typeof content !== 'string') return null;
  const cat = content.trim();
  return cat === '' ? null : cat;
}
