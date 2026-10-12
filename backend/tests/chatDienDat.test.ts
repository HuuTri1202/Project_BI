import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lớp viết lại câu trả lời bằng mô hình ngôn ngữ — và luật canh gác của nó.
 *
 * ═══ Bộ này canh đúng MỘT điều ═════════════════════════════════════════════
 *
 * Mô hình không được tạo ra con số nào. Con số đã do frontend tính từ dữ liệu
 * trang đang mở; việc ở đây chỉ là diễn đạt lại.
 *
 * Nếu luật đó hỏng, hậu quả không trông như lỗi: câu trả lời vẫn là tiếng Việt
 * trôi chảy, vẫn nói về đúng chủ đề, chỉ có con số là của mô hình bốc ra. Không
 * có log nào, không có hộp đỏ nào. Nên nó cần một bài test đứng riêng, không
 * phải được kiểm ghé qua một bài khác.
 */

/** Đặt env TRƯỚC khi `config/env` được nạp — nó đọc một lần lúc import. */
async function napVoiEnv(bien: Record<string, string | undefined>): Promise<{
  dienDat: (i: { cauHoi: string; cau: string; so: string[] }) => Promise<string>;
  coCauHinhLlm: () => boolean;
  giuNguyenSo: (cau: string, so: string[]) => boolean;
}> {
  for (const [k, v] of Object.entries(bien)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // `resetModules` rồi import lại: `env` là một hằng dựng lúc nạp module, nên
  // không có cách nào đổi cấu hình giữa hai ca mà không nạp lại.
  vi.resetModules();
  // `.js` tường minh: tsconfig dùng `moduleResolution: node16`, nên import
  // động theo đường dẫn tương đối phải mang đuôi của BẢN BIÊN DỊCH.
  return (await import('../src/services/chat/dienDat.js')) as never;
}

const DU_CAU_HINH = {
  LLM_BASE_URL: 'https://llm.example.test/v1',
  LLM_API_KEY: 'khoa-thu-nghiem-dai-hon-8',
  LLM_MODEL: 'mo-hinh-thu',
};

/** Giả lập một câu trả lời đúng khuôn OpenAI. */
function traVe(cau: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: cau } }] }),
  } as unknown as Response;
}

let fetchGoc: typeof globalThis.fetch;

beforeEach(() => {
  fetchGoc = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchGoc;
  vi.restoreAllMocks();
});

describe('Luật đối chiếu: con số phải còn nguyên', () => {
  it('mô hình ĐỔI một con số -> bỏ câu đó, trả câu mẫu', async () => {
    /*
     * Ca quan trọng nhất của cả file.
     *
     * Làm tròn "12.431" thành "12.400" nghe như một cải thiện về cách đọc. Nó
     * không phải: đó là một con số khác, và người đọc không có cách nào biết.
     */
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        traVe('Bộ dữ liệu này có khoảng 12.400 dòng nhé!'),
      ) as unknown as typeof fetch;

    const cauMau = 'Số dòng của Đơn hàng Q4: 12.431.';
    const kq = await dienDat({ cauHoi: 'bao nhiêu dòng', cau: cauMau, so: ['12.431'] });

    expect(kq).toBe(cauMau);
  });

  it('mô hình BỎ HẲN con số -> cũng bỏ câu đó', async () => {
    // "Khá nhiều dòng" là một câu không trả lời gì cả.
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(traVe('Bộ dữ liệu này có khá nhiều dòng.')) as unknown as typeof fetch;

    const cauMau = 'Số dòng của Đơn hàng Q4: 12.431.';
    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['12.431'] })).toBe(cauMau);
  });

  it('giữ nguyên MỌI con số -> dùng câu mô hình viết — ca đối chứng', async () => {
    /*
     * Thiếu ca này thì một luật "lúc nào cũng bỏ" vẫn cho hai ca trên màu xanh,
     * và cả lớp này thành ra một lời gọi mạng không bao giờ có tác dụng gì —
     * tốn lượt, tốn thời gian chờ, không đổi được một chữ.
     */
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    const viet = 'Đơn hàng Q4 đang có 12.431 dòng.';
    globalThis.fetch = vi.fn().mockResolvedValue(traVe(viet)) as unknown as typeof fetch;

    expect(
      await dienDat({ cauHoi: 'x', cau: 'Số dòng của Đơn hàng Q4: 12.431.', so: ['12.431'] }),
    ).toBe(viet);
  });

  it('nhiều con số thì phải còn ĐỦ, thiếu một cái là bỏ', async () => {
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(traVe('Miền Nam 500 là cao nhất.')) as unknown as typeof fetch;

    const cauMau = 'Miền Nam (500) cao hơn Miền Bắc (300) 200 Doanh thu.';
    // Câu mô hình viết giữ "500" nhưng mất "300" và "200" — tức là nó đã bỏ mất
    // phần so sánh, thứ làm nên câu trả lời.
    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['500', '300', '200'] })).toBe(cauMau);
  });

  it('`giuNguyenSo` so CHUỖI, không rút số ra rồi so', async () => {
    /*
     * `vi-VN` dùng dấu chấm cho hàng nghìn, ngược với `parseFloat`. Một bước
     * "rút số rồi so" sẽ đọc "1.000" thành 1 và coi "1 dòng" là khớp — luật
     * canh gác khi đó tự nó thành nguồn lỗi.
     */
    const { giuNguyenSo } = await napVoiEnv(DU_CAU_HINH);

    expect(giuNguyenSo('Có 1.000 dòng.', ['1.000'])).toBe(true);
    expect(giuNguyenSo('Có 1 dòng.', ['1.000'])).toBe(false);
    expect(giuNguyenSo('Tỉ trọng 28,3 % tổng.', ['28,3 %'])).toBe(true);
    expect(giuNguyenSo('Tỉ trọng 28.3% tổng.', ['28,3 %'])).toBe(false);
  });
});

describe('Thiếu cấu hình KHÔNG phải lỗi', () => {
  it('chưa khai biến nào -> trả câu mẫu, KHÔNG gọi mạng', async () => {
    /*
     * Đây là điều khiến khung hỏi đáp chạy được khi không có khoá và không có
     * mạng. Nếu chỗ này ném lỗi thì một tính năng trang trí làm hỏng cả khung.
     */
    const { dienDat, coCauHinhLlm } = await napVoiEnv({
      LLM_BASE_URL: undefined,
      LLM_API_KEY: undefined,
      LLM_MODEL: undefined,
    });
    const goi = vi.fn();
    globalThis.fetch = goi as unknown as typeof fetch;

    expect(coCauHinhLlm()).toBe(false);
    expect(await dienDat({ cauHoi: 'x', cau: 'Câu mẫu.', so: [] })).toBe('Câu mẫu.');
    expect(goi).not.toHaveBeenCalled();
  });

  it('khai THIẾU một biến cũng coi như chưa cấu hình', async () => {
    // Có URL mà không có khoá thì lời gọi chắc chắn nhận 401. Dừng ở đây còn
    // tốt hơn tiêu một vòng khứ hồi để biết điều đó.
    const { coCauHinhLlm } = await napVoiEnv({
      LLM_BASE_URL: 'https://llm.example.test/v1',
      LLM_API_KEY: undefined,
      LLM_MODEL: 'mo-hinh-thu',
    });
    expect(coCauHinhLlm()).toBe(false);
  });
});

describe('Mọi kiểu hỏng của mạng đều ra câu mẫu', () => {
  const cauMau = 'Số dòng của Đơn hàng Q4: 12.431.';

  it('mô hình trả lỗi HTTP', async () => {
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response) as never;

    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['12.431'] })).toBe(cauMau);
  });

  it('lời gọi nổ giữa đường', async () => {
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as never;

    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['12.431'] })).toBe(cauMau);
  });

  it('body đúng JSON nhưng sai hình dạng', async () => {
    // Một endpoint "OpenAI-compatible" không chuẩn hoàn toàn là chuyện có thật.
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ket_qua: 'abc' }) } as never) as never;

    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['12.431'] })).toBe(cauMau);
  });

  it('mô hình trả về chuỗi rỗng', async () => {
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockResolvedValue(traVe('   ')) as never;

    expect(await dienDat({ cauHoi: 'x', cau: cauMau, so: ['12.431'] })).toBe(cauMau);
  });
});

describe('Chỉ gửi đi thứ đã nằm trong câu trả lời', () => {
  it('thân request KHÔNG mang bảng số liệu nào', async () => {
    /*
     * Câu trả lời cho "dữ liệu khách có ra khỏi hệ thống không". Hàm này chỉ
     * nhận `cauHoi`, `cau`, `so` — nên không có đường nào để `rows` đi ra, và
     * bài test này khoá lại hình dạng đó.
     */
    const { dienDat } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('Đơn hàng Q4 có 12.431 dòng.'));
    globalThis.fetch = goi as never;

    await dienDat({
      cauHoi: 'bao nhiêu dòng',
      cau: 'Số dòng của Đơn hàng Q4: 12.431.',
      so: ['12.431'],
    });

    const [, init] = goi.mock.calls[0] as [string, { body: string }];
    const than = init.body;
    expect(than).toContain('12.431');
    expect(than).not.toContain('rows');
    // Và nhiệt độ 0: việc ở đây là diễn đạt lại, không phải sáng tác.
    expect(JSON.parse(than)).toMatchObject({ temperature: 0 });
  });
});
