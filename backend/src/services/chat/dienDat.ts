import { env } from '../../config/env';

/**
 * Viết lại câu trả lời của khung hỏi đáp cho mượt hơn — §chat.
 *
 * ═══ Luật số một: mô hình KHÔNG được tạo ra con số nào ═════════════════════
 *
 * Con số đã được frontend tính từ dữ liệu trang đang mở. Việc duy nhất ở đây là
 * diễn đạt lại. Nên trước khi trả về, câu mô hình viết ra bị ĐỐI CHIẾU: mọi
 * chuỗi trong `so` phải còn nguyên trong đó. Thiếu một chuỗi — vì mô hình làm
 * tròn, đổi dấu phân cách, hay bốc ra một con số của riêng nó — thì câu đó bị
 * bỏ và câu mẫu được trả về.
 *
 * ─── Vì sao đối chiếu ở BACKEND ────────────────────────────────────────────
 *
 * Vì frontend sửa được. Ai mở devtools cũng bỏ được một câu `if` trong bundle;
 * còn luật nằm ở đây thì đường duy nhất tới mô hình đã đi qua nó rồi.
 *
 * ─── Vì sao so CHUỖI chứ không rút số ra rồi so ────────────────────────────
 *
 * Vì `vi-VN` dùng dấu chấm cho hàng nghìn và dấu phẩy cho thập phân — ngược hẳn
 * với `parseFloat`. Một bước "rút số rồi so" sẽ đọc `1.000` thành 1, và luật
 * canh gác tự nó thành một nguồn lỗi. Phép so chuỗi không có chỗ nào để lệch.
 *
 * ═══ Luật số hai: thiếu cấu hình KHÔNG phải lỗi ════════════════════════════
 *
 * Trả lại `cau` y nguyên. Chưa có khoá, mất mạng, hết lượt, mô hình trả về rác
 * — tất cả ra cùng một kết quả: câu mẫu. Khung hỏi đáp vì vậy không bao giờ
 * hỏng vì lớp này, và buổi demo không phụ thuộc vào bậc miễn phí của ai.
 *
 * ═══ Luật số ba: chỉ gửi đi thứ đã nằm trong câu trả lời ═══════════════════
 *
 * `cauHoi`, `cau` và `so` — không có `rows`, không có cả bảng. Đây là câu trả
 * lời cho "dữ liệu khách có ra khỏi hệ thống không": ra đúng mấy con số của câu
 * trả lời mà người dùng vừa đọc, không phải tập dữ liệu.
 */

export interface DienDatInput {
  cauHoi: string;
  cau: string;
  so: string[];
}

/**
 * Địa chỉ `POST /chat/completions`, đã dọn dấu `/` thừa ở cuối `LLM_BASE_URL`.
 *
 * Người điền `.env` chép địa chỉ từ tài liệu của nhà cung cấp, và nhiều nhà
 * viết nó KÈM dấu gạch cuối — Gemini là một ví dụ
 * (`.../v1beta/openai/`). Nối thẳng thì ra `…/openai//chat/completions`, và
 * một dấu gạch thừa đủ để nhận 404.
 *
 * Lỗi đó rất đắt vì nó im: `dienDat` nuốt mọi lỗi theo đúng thiết kế, nên màn
 * hình trông y hệt lúc chưa cấu hình gì.
 */
export function diaChiGoi(): string {
  return `${String(env.LLM_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
}

/**
 * Goi mo hinh mot lan. `daGoi` = da nhan duoc mot phan hoi HTTP (ke ca loi).
 *
 * ═══ Vi sao gui `reasoning_effort: 'none'` ════════════════════════════════
 *
 * Mo hinh loai "suy nghi truoc khi tra loi" (Gemini 2.5, o-series, gpt-5) tieu
 * token suy nghi VAO CUNG han muc `max_tokens` ma khong tra chung ve trong
 * `content`. Do xay ra hai chuyen, ca hai deu im lang:
 *
 *   - Het han muc giua chung suy nghi -> `content` rong -> lop nay roi ve cau
 *     mau, va man hinh trong y het luc chua cau hinh gi.
 *   - Te hon: no suy nghi nhieu roi doi y. Do chinh xac tren Gemini 2.5 Flash,
 *     cau "cai nay nang bao nhieu" voi ba truong: bat suy nghi -> tra ve 0
 *     ("khong truong nao khop"); tat suy nghi -> tra ve 3 (Dung luong), dung.
 *     Viec o day la chon mot muc trong danh sach, khong phai viec can suy luan.
 *
 * ═══ Vi sao THU LAI khi bi tu choi ════════════════════════════════════════
 *
 * `reasoning_effort` la tham so chuan cua OpenAI, nhung chi hop le voi mot so
 * mo hinh; gui cho mo hinh khac co nha tra ve 400. Thu lai mot lan KHONG kem
 * tham so do la cach tu do cau hinh cho moi nha, thay vi mot bang "nha nao
 * nhan tham so nao" chac chan muc.
 */
export async function goiMoHinh(
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<{ noiDung: string | null; daGoi: boolean }> {
  const than = (themSuyNghi: boolean): string =>
    JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0,
      max_tokens: maxTokens,
      messages,
      ...(themSuyNghi ? { reasoning_effort: 'none' } : {}),
    });

  try {
    let res = await fetch(diaChiGoi(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(env.LLM_API_KEY)}`,
      },
      body: than(true),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      res = await fetch(diaChiGoi(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(env.LLM_API_KEY)}`,
        },
        body: than(false),
        signal: AbortSignal.timeout(8_000),
      });
    }

    if (!res.ok) return { noiDung: null, daGoi: true };
    return { noiDung: docCau(await res.json()), daGoi: true };
  } catch {
    return { noiDung: null, daGoi: false };
  }
}

/** Mô hình được cấu hình đủ để gọi hay chưa. */
export function coCauHinhLlm(): boolean {
  return (
    env.LLM_BASE_URL !== undefined && env.LLM_API_KEY !== undefined && env.LLM_MODEL !== undefined
  );
}

/**
 * Câu mô hình viết ra có giữ nguyên mọi con số không.
 *
 * Xuất ra để test được một mình — đây là luật canh gác, nên nó phải có bài test
 * riêng chứ không chỉ được kiểm qua đường gọi mạng.
 */
export function giuNguyenSo(cau: string, so: string[]): boolean {
  return so.every((s) => cau.includes(s));
}

const NHAC = [
  'Bạn viết lại một câu trả lời đã có sẵn cho người dùng Việt Nam, giọng tự nhiên và ngắn gọn.',
  'TUYỆT ĐỐI giữ nguyên từng con số, đúng từng ký tự, kể cả dấu chấm và dấu phẩy.',
  'Không thêm con số nào. Không thêm nhận định hay suy luận nào không có trong câu gốc.',
  'Nếu câu gốc có ghi điều kiện của con số (ví dụ chỉ tính trên các nhóm đang hiện) thì phải giữ lại.',
  'Chỉ trả về câu đã viết lại, không giải thích gì thêm.',
].join(' ');

/**
 * Gọi mô hình. Trả về câu mẫu nếu có bất cứ chuyện gì không ổn.
 *
 * `fetch` sẵn có của Node 20 — không thêm dependency nào cho một lời gọi HTTP.
 */
export async function dienDat(input: DienDatInput): Promise<string> {
  if (!coCauHinhLlm()) return input.cau;

  const { noiDung } = await goiMoHinh(
    [
      { role: 'system', content: NHAC },
      {
        role: 'user',
        content: `Câu người dùng hỏi: ${input.cauHoi}\nCâu trả lời cần viết lại: ${input.cau}`,
      },
    ],
    800,
  );
  if (noiDung === null || noiDung.trim() === '') return input.cau;

  // Luật canh gác. Không log con số ra ngoài — chỉ cần biết là đã bỏ.
  if (!giuNguyenSo(noiDung, input.so)) {
    console.warn('[chat] bỏ câu mô hình viết lại: có con số bị đổi');
    return input.cau;
  }

  return noiDung.trim();
}

/** Rút câu trả lời khỏi body, chịu được mọi hình dạng lạ. */
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
