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

  try {
    const res = await fetch(`${String(env.LLM_BASE_URL)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(env.LLM_API_KEY)}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        // `temperature: 0`: việc ở đây là diễn đạt lại một câu đã có, không
        // phải sáng tác. Nhiệt độ cao chỉ làm tăng khả năng nó thêm một ý không
        // có trong dữ liệu — và khi đó luật đối chiếu bỏ cả câu, tức là tốn một
        // lượt gọi để nhận lại đúng câu mẫu.
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: NHAC },
          {
            role: 'user',
            content: `Câu người dùng hỏi: ${input.cauHoi}\nCâu trả lời cần viết lại: ${input.cau}`,
          },
        ],
      }),
      // Khung hỏi đáp là thao tác tương tác. Chờ quá vài giây thì câu mẫu đến
      // ngay còn tốt hơn một vòng xoay dài rồi mới có chữ.
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return input.cau;

    const body: unknown = await res.json();
    const moi = docCau(body);
    if (moi === null) return input.cau;

    // Luật canh gác. Không log con số ra ngoài — chỉ cần biết là đã bỏ.
    if (!giuNguyenSo(moi, input.so)) {
      console.warn('[chat] bỏ câu mô hình viết lại: có con số bị đổi');
      return input.cau;
    }

    return moi;
  } catch {
    /*
     * Nuốt MỌI lỗi, cố ý: hết lượt, DNS chết, JSON rác, hết thời gian chờ. Mỗi
     * nhánh đó mà nổi lên thành 500 là biến một tính năng trang trí thành một
     * thứ làm hỏng khung hỏi đáp.
     */
    return input.cau;
  }
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
