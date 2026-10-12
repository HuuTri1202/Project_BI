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
