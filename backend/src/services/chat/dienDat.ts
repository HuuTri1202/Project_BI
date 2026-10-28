import { env } from '../../config/env';

export interface DienDatInput {
  cauHoi: string;
  cau: string;
  so: string[];
}

export function diaChiGoi(): string {
  return `${String(env.LLM_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
}

const SEED = 7;

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
