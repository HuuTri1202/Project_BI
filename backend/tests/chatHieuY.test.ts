import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lớp "hiểu câu hỏi": mô hình CHỌN một nhãn, không viết câu trả lời.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Toàn bộ lời hứa "không bịa" của lớp này nằm ở một chỗ: thứ mô hình trả về
 * phải là MỘT CHỈ SỐ HỢP LỆ trong danh sách ta vừa gửi, hoặc không gì cả.
 *
 * Hỏng ở đây không trông như lỗi. Một chỉ số sai vẫn trỏ tới một dữ kiện có
 * thật, và khung sẽ trả lời bằng một con số có thật — cho một câu hỏi khác.
 * Nên bốn nhánh được canh riêng:
 *
 *   1. Chỉ số ngoài khoảng 1..n bị bỏ, kể cả khi trông hợp lý.
 *   2. Mô hình trả lời bằng CÂU CHỮ thay vì một con số — bỏ, không rút số ra.
 *   3. Chưa cấu hình / mạng hỏng → không chọn gì, và nói rõ là CHƯA HỎI.
 *   4. Số nhãn gửi đi bị cắt ở trần, và chỉ số phải khớp danh sách ĐÃ CẮT.
 */

async function napVoiEnv(bien: Record<string, string | undefined>): Promise<{
  hieuY: (i: { cauHoi: string; nhan: string[] }) => Promise<{
    chon: number | null;
    daHoi: boolean;
  }>;
  chonHopLe: (raw: string, soNhan: number) => number | null;
  TRAN_NHAN: number;
}> {
  for (const [k, v] of Object.entries(bien)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  // `.js` tường minh: `moduleResolution: node16` nên import động phải mang đuôi
  // của bản biên dịch.
  return (await import('../src/services/chat/hieuY.js')) as never;
}

const DU_CAU_HINH = {
  LLM_BASE_URL: 'https://llm.example.test/v1',
  LLM_API_KEY: 'khoa-thu-nghiem-dai-hon-8',
  LLM_MODEL: 'mo-hinh-thu',
};

function traVe(noiDung: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: noiDung } }] }),
  } as unknown as Response;
}

const NHAN = ['Số dòng của Đơn hàng Q4', 'Số cột của Đơn hàng Q4', 'Dung lượng của Đơn hàng Q4'];

let fetchGoc: typeof globalThis.fetch;

beforeEach(() => {
  fetchGoc = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchGoc;
  vi.restoreAllMocks();
});

describe('Chỉ nhận một chỉ số nằm trong danh sách đã gửi', () => {
  it('chọn đúng nhãn mô hình chỉ ra, đổi sang chỉ số 0-based', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockResolvedValue(traVe('3'));

    // Mô hình đếm từ 1; frontend đánh mảng từ 0.
    expect(await hieuY({ cauHoi: 'cái này nặng bao nhiêu', nhan: NHAN })).toEqual({
      chon: 2,
      daHoi: true,
    });
  });

  it('"0" nghĩa là không nhãn nào khớp', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockResolvedValue(traVe('0'));

    // `daHoi: true` — mô hình ĐÃ đọc hết và kết luận là không có. Khác hẳn
    // với "máy này chưa cấu hình nên chưa ai đọc gì".
    expect(await hieuY({ cauHoi: 'hôm nay trời thế nào', nhan: NHAN })).toEqual({
      chon: null,
      daHoi: true,
    });
  });

  /*
   * ⚠️ Ca quan trọng nhất. Một chỉ số ngoài khoảng vẫn là một con số trông hợp
   * lý; nhận nó là `phang[7]` ra `undefined` ở frontend — hoặc tệ hơn, nếu
   * mảng dài hơn thì nó trỏ vào một dữ kiện CÓ THẬT mà mô hình chưa từng thấy.
   */
  it('chỉ số ngoài khoảng bị bỏ', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);

    for (const bay of ['7', '4', '-1', '999']) {
      globalThis.fetch = vi.fn().mockResolvedValue(traVe(bay));
      expect((await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).chon).toBeNull();
    }
  });

  /*
   * Rút "con số đầu tiên tìm thấy" sẽ biến câu dưới đây thành một lựa chọn
   * chắc nịch, trong khi chính mô hình đang nói là nó không chắc.
   */
  it('mô hình trả lời bằng câu chữ thì bỏ, không rút số ra khỏi câu', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(traVe('Không nhãn nào khớp hẳn, gần nhất có lẽ là nhãn 2.'));

    expect((await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).chon).toBeNull();
  });

  it('chịu được đuôi "3." và "3)" mà mô hình hay viết', async () => {
    const { chonHopLe } = await napVoiEnv(DU_CAU_HINH);

    expect(chonHopLe('3.', 3)).toBe(2);
    expect(chonHopLe(' 2) ', 3)).toBe(1);
    expect(chonHopLe('1', 3)).toBe(0);
  });
});

describe('Không cấu hình thì không hỏng, và nói rõ là CHƯA hỏi', () => {
  it('thiếu khoá: không gọi mạng, không chọn gì, daHoi = false', async () => {
    const { hieuY } = await napVoiEnv({ ...DU_CAU_HINH, LLM_API_KEY: undefined });
    const goi = vi.fn();
    globalThis.fetch = goi;

    expect(await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).toEqual({ chon: null, daHoi: false });
    expect(goi).not.toHaveBeenCalled();
  });

  it('mạng hỏng: nuốt lỗi, và KHÔNG nhận là đã đọc hết', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS chết'));

    // `daHoi: false` ở đây là cố ý: nói "tôi đã đọc hết và không có" trong khi
    // thật ra chưa đọc được gì là một lời khẳng định sai.
    expect(await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).toEqual({ chon: null, daHoi: false });
  });

  it('danh sách nhãn rỗng thì không gọi mạng', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn();
    globalThis.fetch = goi;

    expect((await hieuY({ cauHoi: 'gì đó', nhan: [] })).chon).toBeNull();
    expect(goi).not.toHaveBeenCalled();
  });
});

describe('Thứ gửi lên mô hình', () => {
  it('chỉ có nhãn, đánh số từ 1, KHÔNG có giá trị nào', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('1'));
    globalThis.fetch = goi;

    await hieuY({ cauHoi: 'bao nhiêu dòng', nhan: NHAN });

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { content: string }[];
    };
    const gui = than.messages.map((m) => m.content).join('\n');

    expect(gui).toContain('1. Số dòng của Đơn hàng Q4');
    expect(gui).toContain('3. Dung lượng của Đơn hàng Q4');
    expect(gui).toContain('bao nhiêu dòng');
  });

  /*
   * Trang chi tiết một mô hình nhiều bảng sinh ra hàng trăm dữ kiện. Trần phải
   * cắt TRƯỚC khi kiểm chỉ số, nếu không mô hình trả về 80 trong khi nó chỉ
   * được thấy 60 nhãn — và 80 lại là một chỉ số có thật trong mảng của frontend.
   */
  it('cắt ở trần, và chỉ số được kiểm trên danh sách ĐÃ cắt', async () => {
    const { hieuY, TRAN_NHAN } = await napVoiEnv(DU_CAU_HINH);
    const nhieu = Array.from({ length: TRAN_NHAN + 20 }, (_, i) => `Trường số ${String(i + 1)}`);

    const goi = vi.fn().mockResolvedValue(traVe(String(TRAN_NHAN + 5)));
    globalThis.fetch = goi;
    expect((await hieuY({ cauHoi: 'gì đó', nhan: nhieu })).chon).toBeNull();

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { content: string }[];
    };
    const gui = than.messages.map((m) => m.content).join('\n');
    expect(gui).toContain(`${String(TRAN_NHAN)}. Trường số ${String(TRAN_NHAN)}`);
    expect(gui).not.toContain(`Trường số ${String(TRAN_NHAN + 1)}`);
  });
});

describe('Mô hình "suy nghĩ trước khi trả lời"', () => {
  /*
   * ⚠️ Gemini 2.5 Flash tiêu token suy nghĩ vào cùng `max_tokens`, và tệ hơn:
   * nó nghĩ nhiều rồi ĐỔI Ý. Cùng câu hỏi, cùng ba trường — bật suy nghĩ trả
   * về 0 ("không trường nào khớp"), tắt suy nghĩ trả về 3, đúng. Việc ở đây là
   * chọn một mục trong danh sách, không phải việc cần suy luận.
   */
  it('bảo mô hình ĐỪNG suy nghĩ', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('2'));
    globalThis.fetch = goi;

    await hieuY({ cauHoi: 'gì đó', nhan: NHAN });

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      reasoning_effort?: string;
    };
    expect(than.reasoning_effort).toBe('none');
  });

  /*
   * `reasoning_effort` là tham số chuẩn của OpenAI nhưng chỉ hợp lệ với một số
   * mô hình; nhà khác trả về 400. Thử lại MỘT lần không kèm tham số đó là cách
   * tự dò cấu hình cho mọi nhà, thay vì một bảng "nhà nào nhận tham số nào".
   */
  it('bị từ chối thì thử lại một lần KHÔNG kèm tham số đó', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce(traVe('3'));
    globalThis.fetch = goi;

    expect((await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).chon).toBe(2);
    expect(goi).toHaveBeenCalledTimes(2);

    const lan2 = JSON.parse(String((goi.mock.calls[1]?.[1] as { body: string }).body)) as {
      reasoning_effort?: string;
    };
    expect(lan2.reasoning_effort).toBeUndefined();
  });

  it('thử lại cũng hỏng thì thôi, không thử nữa', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    globalThis.fetch = goi;

    expect(await hieuY({ cauHoi: 'gì đó', nhan: NHAN })).toEqual({ chon: null, daHoi: true });
    expect(goi).toHaveBeenCalledTimes(2);
  });
});

/*
 * ═══ Sổ ghi câu TRƯỢT ══════════════════════════════════════════════════════
 *
 * Sổ đi thu câu của người dùng thật về cho bộ đánh giá — nguồn DUY NHẤT phá
 * được chuyện người viết code vừa ra đề vừa làm bài.
 *
 * ⚠️ Nó được gọi từ ROUTE `/chat/hieu-y`, KHÔNG từ trong `hieuY`. Bản đầu đặt
 * trong hàm, và lần chạy `llm:danh-gia` đầu tiên đã chứng minh đó là chỗ sai:
 * 25 câu dựng tay của bộ đánh giá đổ thẳng vào sổ, chôn mất hai dòng người
 * dùng thật. Ca cuối của khối này canh đúng chỗ đó.
 *
 * Một cái log thì không ai để ý khi nó hỏng, nên nó được canh như mọi thứ
 * khác — và canh đúng mấy chỗ dễ hỏng mà không ai thấy:
 *
 *   1. Cột NHÃN mô hình cứu được. Nó nói lớp ngoại tuyến LẼ RA phải khớp vào
 *      đâu, nên một dòng sổ dịch gần như nguyên văn thành một ca đánh giá.
 *   2. Câu xuống dòng phải gộp thành MỘT dòng, nếu không `wc -l` đếm sai và
 *      `grep` cắt mất nửa câu.
 *   3. `hieuY` TỰ NÓ không được ghi gì.
 */
describe('Sổ ghi những câu lớp ngoại tuyến không trả lời được', () => {
  function batSo(): { dong: () => string[] } {
    const ghi = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    return {
      dong: () =>
        ghi.mock.calls
          .filter((c) => String(c[0]).includes('trượt lớp ngoại tuyến'))
          .map((c) => String(c[1])),
    };
  }

  async function napGhi(): Promise<(cauHoi: string, nhanChon: string | null) => void> {
    const m = (await napVoiEnv(DU_CAU_HINH)) as unknown as {
      ghiTruot: (cauHoi: string, nhanChon: string | null) => void;
    };
    return m.ghiTruot;
  }

  it('không nhãn nào cứu được thì ghi CHƯA HIỂU', async () => {
    const ghiTruot = await napGhi();
    const so = batSo();

    ghiTruot('vùng nào bán chạy nhất', null);

    expect(so.dong()).toHaveLength(1);
    expect(so.dong()[0]).toContain('vùng nào bán chạy nhất');
    expect(so.dong()[0]).toContain('CHƯA HIỂU');
  });

  it('mô hình cứu được thì ghi NHÃN nó chọn, không ghi "chưa hiểu"', async () => {
    const ghiTruot = await napGhi();
    const so = batSo();

    ghiTruot('cái này nặng bao nhiêu', 'Dung lượng của Đơn hàng Q4');

    // Đây là dòng dịch thẳng thành một ca đánh giá: câu người ta gõ, và nhãn
    // mà phép so từ khoá LẼ RA phải khớp vào.
    expect(so.dong()[0]).toContain('Dung lượng của Đơn hàng Q4');
    expect(so.dong()[0]).not.toContain('CHƯA HIỂU');
  });

  it('câu xuống dòng bị gộp lại thành MỘT dòng sổ', async () => {
    const ghiTruot = await napGhi();
    const so = batSo();

    ghiTruot('doanh thu\n\n  theo   khu vực  ', null);

    // Phải kết thúc ĐÚNG ở chữ cuối. Một dấu cách thừa trong ô TSV là thứ
    // vô hình khi đọc sổ, mà nó đi thẳng vào ca đánh giá lúc chép lại.
    expect(so.dong()[0]).toMatch(/doanh thu theo khu vực$/);
    expect(so.dong()[0]).not.toContain('\n');
  });

  /*
   * ⚠️ Ca canh đúng cái lỗi đã xảy ra. `llm:danh-gia` và `kiem-llm` gọi thẳng
   * `hieuY`; nếu hàm đó tự ghi sổ thì mỗi lần đo lại đổ vài chục câu dựng tay
   * vào đúng chỗ đang để dành cho câu người thật.
   */
  it('gọi thẳng `hieuY` thì KHÔNG ghi gì — sổ chỉ nhận câu qua route', async () => {
    const { hieuY } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockResolvedValue(traVe('3'));
    const so = batSo();

    await hieuY({ cauHoi: 'cái này nặng bao nhiêu', nhan: NHAN });

    expect(so.dong()).toHaveLength(0);
  });
});
