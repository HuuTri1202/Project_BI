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
/**
 * Hạt giống cố định gửi kèm mỗi lượt gọi.
 *
 * ═══ Vì sao cần, khi `temperature: 0` đã có ═══════════════════════════════
 *
 * `temperature: 0` KHÔNG đủ để lặp lại được. Chạy đúng một bộ 25 câu hai lần
 * trên cùng mô hình, cùng nhiệt độ: một câu đổi đáp án ("cái này nặng bao
 * nhiêu" — lần một không chọn gì, lần hai chọn đúng). 4% trôi, không có gì
 * đổi ở đầu vào. Nguyên nhân nằm ở phía nhà cung cấp — gộp lô, thứ tự cộng
 * dồn số thực trên GPU — chứ không ở lời nhắc.
 *
 * `seed` là núm DUY NHẤT mà API chuẩn OpenAI cho để giảm chuyện đó. Nó không
 * hứa hết trôi (chính OpenAI gọi đây là "best effort"), nhưng nó miễn phí.
 *
 * Giá trị nào cũng được, miễn CỐ ĐỊNH — đổi nó là tự tay sinh ra đúng cái trôi
 * mà nó đang đi chặn.
 */
const SEED = 7;

/**
 * Nhà cung cấp này có nhận mấy tham số phụ không — nhớ lại sau lần đầu.
 *
 * ═══ Vì sao phải nhớ ═══════════════════════════════════════════════════════
 *
 * Luật "thử lại một lần không kèm tham số" là cách tự cấu hình cho mọi nhà
 * cung cấp, và nó đúng. Nhưng nó đang chạy LẠI TỪ ĐẦU ở mỗi lượt hỏi: với nhà
 * nào từ chối, mỗi câu người dùng gõ tốn HAI lượt HTTP, mãi mãi.
 *
 * Đo được trên Groq + `openai/gpt-oss-120b`: lượt đầu luôn trả 400
 * ("`reasoning_effort` must be one of `low`, `medium`, or `high`"), lượt hai
 * mới chạy. Tức gấp đôi độ trễ, gấp đôi sức ép lên hạn mức theo phút — và
 * chạm hạn mức thì khung im lặng rơi về so từ khoá, đúng cái bất ổn đang đi
 * sửa.
 *
 * Nhớ một biến là đủ: thử một lần, sai thì thôi không gửi nữa trong cả đời
 * tiến trình. Khởi động lại là thử lại — rẻ, và đúng lúc đáng thử lại nhất
 * (đổi mô hình thì cũng phải khởi động lại).
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
      ...(kemThamSoPhu ? { reasoning_effort: 'none', seed: SEED } : {}),
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

    if (!res.ok && nhanThamSoPhu) {
      // Nhà này không nhận — thôi không gửi nữa, cho mọi lượt sau.
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
    if (!res.ok) return { noiDung: null, daGoi: false };
    return { noiDung: docCau(await res.json()), daGoi: true };
  } catch {
    return { noiDung: null, daGoi: false };
  }
}

/** Chỉ dùng trong test — khung không có đường nào gọi tới. */
export function quenThamSoPhu(): void {
  nhanThamSoPhu = true;
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

/**
 * ═══ Vì sao nhắc kỹ chuyện "viết thành CÂU" ════════════════════════════════
 *
 * Câu mẫu do frontend dựng ra là một khuôn ghép chuỗi, nên nó đọc như một dòng
 * bảng: `Số quan hệ của mô hình Global-Superstore: 3.` Đúng, và không ai muốn
 * đọc. Việc duy nhất mà lớp này làm tốt hơn `traLoi.ts` là biến dòng đó thành
 * một câu tiếng Việt có chủ ngữ vị ngữ — nên nó phải được yêu cầu tường minh,
 * không thì mô hình chỉ đổi vài chữ rồi trả lại đúng cái khuôn cũ.
 *
 * ⚠️ Yêu cầu dài hơn thì rủi ro mất một con số cũng cao hơn. Đó là lý do luật
 * đối chiếu ở `giuNguyenSo` không được nới một chút nào: nới ra thì chỗ này
 * thành đường duy nhất trong hệ thống mà một con số sai đi tới được người đọc.
 */
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
