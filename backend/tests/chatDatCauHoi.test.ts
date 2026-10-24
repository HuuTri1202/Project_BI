import type { ExplorerQueryDto, ExplorerResultDto } from '@bi/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  giuNguyenLoi,
  kiemForm,
  kiemFormCoLyDo,
  LY_DO_NOI,
  type DatCauHoiInput,
} from '../src/services/chat/datCauHoi';
import { docKetQua, moTaTruyVan } from '../src/services/chat/dienGiai';

/**
 * Lớp ĐIỀN FORM: mô hình dựng được một truy vấn MỚI — §chat, bước (4).
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Đây là lớp nguy hiểm nhất của cả khung hỏi đáp, vì nó là lớp đầu tiên mà mô
 * hình được quyết định SỐ LIỆU NÀO ĐƯỢC TÍNH, không chỉ số liệu nào được đọc
 * lại. Một truy vấn sai vẫn trả về một con số thật, định dạng đẹp, và không gì
 * trên màn hình nói nó được tính thế nào.
 *
 * Nên bốn cửa được canh riêng:
 *
 *   1. Mọi id phải nằm trong danh sách ta gửi — và một id lạ bỏ CẢ FORM, không
 *      vá từng ô. Vá từng ô đổi câu hỏi: bỏ một `filters` sai đi là trả lời
 *      bằng con số của toàn bộ dữ liệu cho một câu hỏi về Miền Bắc.
 *   2. Chiều không được dùng làm thước đo và ngược lại.
 *   3. `values` PHẢI là lời của chính người dùng. Đây là chỗ duy nhất mô hình
 *      sinh ra chuỗi tự do, nên là chỗ duy nhất một điều bịa có thể vào truy vấn.
 *   4. Con số trong câu trả lời do CODE đọc từ bảng kết quả, không do mô hình.
 */

const TRUONG: DatCauHoiInput['truong'] = [
  { id: 21, nhan: 'Doanh thu', loai: 'thuoc do' },
  { id: 22, nhan: 'Số lượng', loai: 'thuoc do' },
  { id: 11, nhan: 'Khu vực (bảng Orders)', loai: 'chieu' },
  { id: 12, nhan: 'Sản phẩm (bảng Products)', loai: 'chieu' },
];

function vao(cauHoi: string): DatCauHoiInput {
  return { cauHoi, truong: TRUONG };
}

describe('Giá trị lọc phải là LỜI CỦA NGƯỜI DÙNG', () => {
  /*
   * ⚠️ Luật quan trọng nhất của cả file này.
   *
   * Một giá trị bịa ra không làm hệ thống hỏng — nó làm truy vấn trả về rỗng,
   * rồi khung nói "không có dòng nào thoả" bằng giọng chắc chắn. Câu đó TRUNG
   * THỰC về truy vấn đã chạy, và truy vấn đó thì sai. Người dùng không có cách
   * nào biết điều kiện đã bị đổi.
   */
  it('giá trị mô hình tự nghĩ ra thì bỏ CẢ FORM', () => {
    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc Trung Bộ'] }],
        },
        vao('doanh thu Miền Bắc theo khu vực'),
      ),
    ).toBeNull();
  });

  it('giá trị lấy nguyên từ câu hỏi thì nhận', () => {
    const kq = kiemForm(
      {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
      },
      vao('doanh thu Miền Bắc theo khu vực'),
    );
    expect(kq?.filters).toEqual([{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }]);
  });

  it('bỏ dấu và chữ hoa thường không làm luật này trượt', () => {
    // Người ta gõ "mien bac" không dấu, mô hình viết lại "Miền Bắc" — hai thứ
    // đó phải khớp, nếu không luật canh gác tự nó thành một nguồn lỗi.
    expect(giuNguyenLoi('doanh thu mien bac', ['Miền Bắc'])).toBe(true);
    expect(giuNguyenLoi('doanh thu MIỀN BẮC', ['miền bắc'])).toBe(true);
    expect(giuNguyenLoi('doanh thu đồ gỗ', ['Đồ gỗ'])).toBe(true);
  });

  /*
   * ⚠️ Người Việt gõ nhanh thì bỏ dấu hẳn, còn mô hình thì gần như LUÔN "giúp"
   * khôi phục dấu. Hai cách viết đó phải khớp, nếu không luật canh gác tự chặn
   * mất một bộ lọc đúng — và người dùng nhận "chưa hiểu" cho một câu hoàn toàn
   * hợp lệ.
   *
   * `đ` là chỗ duy nhất `NFD` không lo được: nó là ký tự Latin riêng (U+0111),
   * không phải "d + dấu", nên nó phải được thay TAY.
   */
  it('người dùng gõ KHÔNG dấu, mô hình thêm dấu lại — vẫn khớp', () => {
    expect(giuNguyenLoi('doanh thu do go', ['Đồ gỗ'])).toBe(true);
    expect(giuNguyenLoi('doanh thu mien bac', ['Miền Bắc'])).toBe(true);
    expect(giuNguyenLoi('san pham dien tu', ['Điện tử'])).toBe(true);
  });

  it('viết tắt hay dịch thì KHÔNG khớp — và từ chối là đúng', () => {
    // Ta không biết "Q1" có phải cách dữ liệu ghi quý một hay không.
    expect(giuNguyenLoi('doanh thu quý 1', ['Q1'])).toBe(false);
    expect(giuNguyenLoi('doanh thu miền bắc', ['North'])).toBe(false);
    expect(giuNguyenLoi('doanh thu', [''])).toBe(false);
  });
});

describe('Mọi id phải nằm trong danh sách đã gửi', () => {
  it('id bịa ra thì bỏ cả form', () => {
    expect(kiemForm({ dimensionIds: [999], measureIds: [21] }, vao('gì đó'))).toBeNull();
    expect(kiemForm({ dimensionIds: [11], measureIds: [999] }, vao('gì đó'))).toBeNull();
  });

  /*
   * ⚠️ Chiều và thước đo là HAI danh sách id riêng trong database, nên id 11 có
   * thật ở cả hai chỗ là chuyện bình thường. Không tách hai tập hợp thì một
   * `measureIds: [11]` lọt qua và `buildQuery` dựng ra tên cube của một thước
   * đo không tồn tại.
   */
  it('chiều không được dùng làm thước đo, và ngược lại', () => {
    expect(kiemForm({ dimensionIds: [21], measureIds: [22] }, vao('gì đó'))).toBeNull();
    expect(kiemForm({ dimensionIds: [11], measureIds: [12] }, vao('gì đó'))).toBeNull();
  });

  it('id lạ trong filters cũng bỏ cả form', () => {
    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 21, operator: 'equals', values: ['x'] }],
        },
        vao('x'),
      ),
    ).toBeNull();
  });

  it('id trùng nhau thì gộp lại, không gửi hai lần', () => {
    expect(
      kiemForm({ dimensionIds: [11, 11], measureIds: [21] }, vao('gì đó'))?.dimensionIds,
    ).toEqual([11]);
  });
});

describe('Hình dạng form', () => {
  it('rỗng, không phải object, hay không chọn gì — đều bỏ', () => {
    expect(kiemForm({}, vao('gì đó'))).toBeNull();
    expect(kiemForm(null, vao('gì đó'))).toBeNull();
    expect(kiemForm('{}', vao('gì đó'))).toBeNull();
    expect(kiemForm({ dimensionIds: [], measureIds: [] }, vao('gì đó'))).toBeNull();
  });

  it('chỉ thước đo, không chiều nào — vẫn là một câu hỏi hợp lệ', () => {
    // "Tổng doanh thu bao nhiêu" không cần nhóm theo gì cả.
    expect(kiemForm({ measureIds: [21] }, vao('tổng doanh thu'))).toEqual({
      dimensionIds: [],
      measureIds: [21],
    });
  });

  it('toán tử ngoài từ vựng thì bỏ cả form', () => {
    for (const op of ['inDateRange', 'regex', 'DROP', '']) {
      expect(
        kiemForm(
          {
            dimensionIds: [11],
            measureIds: [21],
            filters: [{ dimensionId: 11, operator: op, values: ['Miền Bắc'] }],
          },
          vao('doanh thu Miền Bắc'),
        ),
      ).toBeNull();
    }
  });

  it('set/notSet không nhận giá trị; toán tử khác phải có ít nhất một', () => {
    expect(
      kiemForm(
        { dimensionIds: [11], measureIds: [21], filters: [{ dimensionId: 11, operator: 'set' }] },
        vao('khu vực nào có giá trị'),
      )?.filters,
    ).toEqual([{ dimensionId: 11, operator: 'set', values: [] }]);

    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 11, operator: 'set', values: ['Miền Bắc'] }],
        },
        vao('doanh thu Miền Bắc'),
      ),
    ).toBeNull();

    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 11, operator: 'equals', values: [] }],
        },
        vao('doanh thu'),
      ),
    ).toBeNull();
  });

  it('quá mười điều kiện thì bỏ', () => {
    const mot = { dimensionId: 11, operator: 'equals', values: ['a'] };
    const than = (n: number) => ({
      dimensionIds: [11],
      measureIds: [21],
      filters: Array.from({ length: n }, () => mot),
    });
    expect(kiemForm(than(10), vao('a'))).not.toBeNull();
    expect(kiemForm(than(11), vao('a'))).toBeNull();
  });
});

// ─── Đọc kết quả thành câu: con số do CODE đọc ───────────────────────────────

const NHAN = new Map([
  [11, 'Khu vực'],
  [21, 'Doanh thu'],
]);

function ketQua(part: Partial<ExplorerResultDto> = {}): ExplorerResultDto {
  return {
    columns: [
      { id: 11, label: 'Khu vực', kind: 'dimension' },
      { id: 21, label: 'Doanh thu', kind: 'measure' },
    ],
    rows: [
      ['Miền Bắc', 1200000],
      ['Miền Nam', 980000],
    ],
    truncated: false,
    ...part,
  };
}

const TRUY_VAN: ExplorerQueryDto = { dimensionIds: [11], measureIds: [21] };

describe('Đọc kết quả thành câu', () => {
  it('nhiều dòng: liệt kê, và số dòng đứng đầu danh sách con số', () => {
    const d = docKetQua(ketQua(), TRUY_VAN, NHAN);

    expect(d.cau).toContain('Miền Bắc');
    expect(d.cau).toContain('1.200.000');
    expect(d.cau).toContain('980.000');
    // Con số đầu là số DÒNG — câu mở đầu bằng nó, nên lớp viết lại không được
    // phép làm tròn nó.
    expect(d.so[0]).toBe('2');
    expect(d.so).toContain('1.200.000');
  });

  it('không chiều nào: một con số duy nhất', () => {
    const d = docKetQua(
      ketQua({
        columns: [{ id: 21, label: 'Doanh thu', kind: 'measure' }],
        rows: [[2180000]],
      }),
      { dimensionIds: [], measureIds: [21] },
      NHAN,
    );

    expect(d.cau).toBe('Doanh thu 2.180.000.');
    expect(d.so).toEqual(['2.180.000']);
  });

  it('không dòng nào thoả thì nói thẳng, không nói là 0', () => {
    // "Doanh thu: 0" là một câu SAI: không có dòng nào khác hẳn với có dòng mà
    // tổng bằng không.
    const d = docKetQua(ketQua({ rows: [] }), TRUY_VAN, NHAN);
    expect(d.cau).toContain('Không có dòng nào');
    expect(d.so).toEqual([]);
  });

  /*
   * ⚠️ `truncated` nghĩa là truy vấn đã chạm trần số dòng, nên "cao nhất" trong
   * danh sách này có thể không phải cao nhất thật. Cùng lý do `luuYCat` tồn tại
   * ở nhánh biểu đồ bên frontend.
   */
  it('chạm trần số dòng thì PHẢI nói ra', () => {
    expect(docKetQua(ketQua({ truncated: true }), TRUY_VAN, NHAN).cau).toContain(
      'chưa phải toàn bộ',
    );
  });

  it('ô trống được gọi là trống, không bị bỏ qua', () => {
    const d = docKetQua(ketQua({ rows: [[null, 500]] }), TRUY_VAN, NHAN);
    expect(d.cau).toContain('(trống)');
  });

  it('thước đo dạng phần trăm đọc theo đúng cách màn hình đọc', () => {
    const d = docKetQua(
      ketQua({
        columns: [
          { id: 11, label: 'Khu vực', kind: 'dimension' },
          { id: 21, label: 'Tỉ lệ', kind: 'measure', format: 'percent' },
        ],
        rows: [['Miền Bắc', 0.283]],
      }),
      TRUY_VAN,
      NHAN,
    );
    expect(d.cau).toContain('28,3 %');
  });
});

describe('Nói lại CÁCH NÓ HIỂU', () => {
  /*
   * ⚠️ Đây là thứ trả lại tính kiểm-được-bằng-mắt cho lớp này.
   *
   * Ở `hieuY`, câu trả lời hiện kèm nguyên văn cái nhãn mô hình chọn, nên chọn
   * nhầm là thấy ngay. Lớp điền form không có sẵn tính chất đó: một truy vấn
   * sai trường vẫn ra một con số đẹp. `hieuLa` là chỗ duy nhất nói ra truy vấn
   * đã được dựng thế nào.
   */
  it('gọi tên thước đo, chiều và từng điều kiện lọc', () => {
    const mo = moTaTruyVan(
      {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
      },
      NHAN,
    );

    expect(mo).toContain('Doanh thu');
    expect(mo).toContain('theo Khu vực');
    expect(mo).toContain('lọc Khu vực bằng Miền Bắc');
  });

  it('luôn đi kèm câu trả lời, kể cả khi không có dòng nào', () => {
    expect(docKetQua(ketQua({ rows: [] }), TRUY_VAN, NHAN).hieuLa).toContain('Doanh thu');
  });

  it('dùng nhãn, không dùng id — id không nói gì với người đọc', () => {
    expect(moTaTruyVan(TRUY_VAN, NHAN)).not.toContain('11');
    expect(moTaTruyVan(TRUY_VAN, NHAN)).not.toContain('21');
  });
});

// ─── Đường gọi mạng: JSON rác, chưa cấu hình, trần số trường ─────────────────

let fetchGoc: typeof globalThis.fetch;

beforeEach(() => {
  fetchGoc = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchGoc;
  vi.restoreAllMocks();
});

const DU_CAU_HINH = {
  LLM_BASE_URL: 'https://llm.example.test/v1',
  LLM_API_KEY: 'khoa-thu-nghiem-dai-hon-8',
  LLM_MODEL: 'mo-hinh-thu',
};

async function napVoiEnv(bien: Record<string, string | undefined>): Promise<{
  datCauHoi: (i: DatCauHoiInput) => Promise<{
    truyVan: ExplorerQueryDto | null;
    daHoi: boolean;
  }>;
  TRAN_TRUONG: number;
}> {
  for (const [k, v] of Object.entries(bien)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  // `.js` tường minh: `moduleResolution: node16` nên import động phải mang đuôi
  // của bản biên dịch.
  return (await import('../src/services/chat/datCauHoi.js')) as never;
}

function traVe(noiDung: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: noiDung } }] }),
  } as unknown as Response;
}

describe('Mọi trục trặc đều ra truyVan: null', () => {
  it('chưa cấu hình: không gọi mạng, và nói rõ là CHƯA hỏi', async () => {
    const { datCauHoi } = await napVoiEnv({ ...DU_CAU_HINH, LLM_API_KEY: undefined });
    const goi = vi.fn();
    globalThis.fetch = goi;

    // `lyDo: null` — chưa cấu hình KHÔNG phải thứ người dùng làm được gì, nên
    // nó không nằm trong ba lý do nói ra được. Xem `LyDoBoForm`.
    expect(await datCauHoi(vao('doanh thu theo khu vực'))).toEqual({
      truyVan: null,
      daHoi: false,
      lyDo: null,
    });
    expect(goi).not.toHaveBeenCalled();
  });

  it('JSON rác thì bỏ, không cố đoán', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    for (const rac of ['xin chào', '{ không phải json', '[]', '']) {
      globalThis.fetch = vi.fn().mockResolvedValue(traVe(rac));
      expect((await datCauHoi(vao('doanh thu theo khu vực'))).truyVan).toBeNull();
    }
  });

  it('chịu được rào ```json và chữ thừa quanh object', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        traVe('Đây là truy vấn:\n```json\n{"dimensionIds":[11],"measureIds":[21]}\n```\n'),
      );

    expect((await datCauHoi(vao('doanh thu theo khu vực'))).truyVan).toEqual({
      dimensionIds: [11],
      measureIds: [21],
    });
  });

  it('mạng hỏng: nuốt lỗi, và KHÔNG nhận là đã hỏi', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS chết'));

    expect(await datCauHoi(vao('gì đó'))).toEqual({ truyVan: null, daHoi: false, lyDo: null });
  });

  /*
   * ⚠️ Cắt PHẢI xảy ra trước khi kiểm id, nếu không mô hình chỉ thấy 120 trường
   * mà `kiemForm` lại nhận id của trường thứ 200 — một id có thật trong mô
   * hình, mà mô hình chưa từng được thấy.
   */
  it('cắt ở trần số trường, và id được kiểm trên danh sách ĐÃ cắt', async () => {
    const { datCauHoi, TRAN_TRUONG } = await napVoiEnv(DU_CAU_HINH);
    const nhieu: DatCauHoiInput['truong'] = [
      { id: 1, nhan: 'Doanh thu', loai: 'thuoc do' },
      ...Array.from({ length: TRAN_TRUONG + 20 }, (_, i) => ({
        id: 100 + i,
        nhan: `Chiều ${String(i)}`,
        loai: 'chieu' as const,
      })),
    ];

    const quaTran = 100 + TRAN_TRUONG;
    const goi = vi
      .fn()
      .mockResolvedValue(traVe(`{"dimensionIds":[${String(quaTran)}],"measureIds":[1]}`));
    globalThis.fetch = goi;

    expect((await datCauHoi({ cauHoi: 'gì đó', truong: nhieu })).truyVan).toBeNull();

    const than = String((goi.mock.calls[0]?.[1] as { body: string }).body);
    expect(than).not.toContain(`${String(quaTran)} = `);
  });

  it('chỉ gửi id và NHÃN, không gửi giá trị nào của dữ liệu', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi(vao('doanh thu theo khu vực'));

    const than = String((goi.mock.calls[0]?.[1] as { body: string }).body);
    expect(than).toContain('Doanh thu');
    expect(than).toContain('Khu vực');
    expect(than).toContain('doanh thu theo khu vực');
  });
});

describe('Bộ nhớ hội thoại nới corpus của luật canh gác, KHÔNG bỏ nó', () => {
  const FORM_TRUOC: ExplorerQueryDto = {
    dimensionIds: [11],
    measureIds: [21],
    filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
  };

  function vaoTiep(cauHoi: string): DatCauHoiInput {
    return {
      cauHoi,
      truong: TRUONG,
      boiCanh: { cauHoi: 'doanh thu Miền Bắc', truyVan: FORM_TRUOC },
    };
  }

  /*
   * ⚠️ Ca then chốt. Lượt hỏi tiếp GIỮ LẠI bộ lọc của lượt trước, mà chữ "Miền
   * Bắc" nằm ở câu TRƯỚC. So chỉ với câu mới nhất là luật tự bác bỏ mọi lượt
   * hỏi tiếp — tức bộ nhớ hội thoại không bao giờ chạy được.
   */
  it('giá trị từ câu hỏi TRƯỚC vẫn được nhận', () => {
    const kq = kiemForm(
      {
        dimensionIds: [12],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
      },
      vaoTiep('còn theo sản phẩm thì sao'),
    );

    expect(kq?.filters).toEqual([{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }]);
  });

  /*
   * ⚠️ Và đây là ca canh chuyện luật KHÔNG bị bỏ hẳn. Nới corpus ra "cả cuộc
   * trò chuyện" rất dễ trượt thành "thôi không kiểm nữa", và khi đó mô hình lại
   * bịa được giá trị — đúng cái mà `giuNguyenLoi` tồn tại để chặn.
   */
  it('giá trị KHÔNG có trong cả hai câu thì vẫn bỏ cả form', () => {
    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Tây'] }],
        },
        vaoTiep('còn tháng 4 thì sao'),
      ),
    ).toBeNull();
  });

  it('không có bộ nhớ thì chỉ so với câu hiện tại', () => {
    expect(
      kiemForm(
        {
          dimensionIds: [11],
          measureIds: [21],
          filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
        },
        vao('còn tháng 4 thì sao'),
      ),
    ).toBeNull();
  });

  it('lượt trước đi lên mô hình dưới dạng JSON của chính cái form', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi(vaoTiep('còn tháng 4 thì sao'));

    const than = String((goi.mock.calls[0]?.[1] as { body: string }).body);
    expect(than).toContain('doanh thu Miền Bắc');
    // Hình dạng mà mô hình sắp phải trả về, cho nó thấy nguyên văn.
    expect(than).toContain('dimensionIds');
    expect(than).toContain('Miền Bắc');
  });

  /*
   * ⚠️ Ca này sinh ra từ một lỗi ĐO ĐƯỢC, không phải phòng xa.
   *
   * Hạn mức đầu tiên là 700 — thừa gấp mười lăm lần cái object 40 token cần
   * trả về. Và nó CẮT ĐÔI câu trả lời của một lượt hỏi tiếp:
   *
   *     {"dimensionIds":[12],"measureIds":[21],"filters":[{"dimensionId":11,
   *      "operator":"equals","        <- hết hạn mức
   *
   * Vì mô hình "suy nghĩ trước khi trả lời" tiêu token suy nghĩ vào CÙNG hạn
   * mức mà không trả chúng về trong `content`, và một lượt hỏi tiếp làm nó nghĩ
   * nhiều hơn hẳn một câu độc lập. Đo lại với 2000 thì cả ba lượt hỏi tiếp đều
   * ra JSON đủ.
   *
   * Hậu quả của việc tụt hạn mức này là IM LẶNG: `docJson` không tìm được `}`
   * nên trả `null`, rồi khung nói "chưa hiểu" — trông y như mô hình không hiểu
   * câu hỏi, trong khi nó hiểu và chỉ bị cắt lời.
   */
  it('hạn mức token phải rộng cho CẢ phần suy nghĩ, không chỉ cho JSON', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi(vaoTiep('còn tháng 4 thì sao'));

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      max_tokens: number;
    };
    expect(than.max_tokens).toBeGreaterThanOrEqual(2000);
  });

  it('không có bộ nhớ thì KHÔNG gửi mục "Lượt hỏi trước"', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi(vao('doanh thu theo khu vực'));

    /*
     * ⚠️ Soi riêng tin của NGƯỜI DÙNG. Chỉ dẫn hệ thống có nhắc cụm "Lượt hỏi
     * trước" để dạy mô hình cách xử lý nó, nên so trên cả thân request thì ca
     * này đỏ mãi vì một lý do không liên quan gì tới thứ nó muốn kiểm.
     */
    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { role: string; content: string }[];
    };
    const cuaNguoiDung = than.messages.filter((m) => m.role === 'user').map((m) => m.content);

    expect(cuaNguoiDung.join(' ')).not.toContain('Lượt hỏi trước');
    expect(cuaNguoiDung.join(' ')).toContain('doanh thu theo khu vực');
  });
});

/**
 * BA Ô FORM mà `kiemForm` trước đây đánh rơi im lặng — và vì sao chúng khác nhau.
 *
 * `ExplorerQueryDto` có sáu ô; lớp điền form chỉ kiểm ba (`dimensionIds`,
 * `measureIds`, `filters`) nên ba ô còn lại rơi mất mà không ai thấy. Hậu quả
 * KHÔNG giống nhau giữa chúng, và đó là lý do cả ba đều có ca riêng ở đây:
 *
 *   `limit`         — rơi thì lấy 500 dòng thay vì 5. Thừa, không sai.
 *   `timeDimension` — rơi thì câu hỏi theo tháng nằm ngoài không gian trả lời.
 *   `measureAggs`   — rơi thì TRẢ LỜI BẰNG MỘT PHÉP TÍNH KHÁC. Cái này nguy
 *                     hiểm: tổng doanh thu mang nhãn "Doanh thu" trông y hệt
 *                     doanh thu trung bình mang nhãn "Doanh thu".
 */
describe('Ba ô form còn lại', () => {
  /** Thước đo 21 nhận `sum`/`avg`; chiều 13 là cột thời gian. */
  const DAY_DU: DatCauHoiInput['truong'] = [
    { id: 21, nhan: 'Doanh thu', loai: 'thuoc do', phepGop: ['sum', 'avg'] },
    { id: 11, nhan: 'Khu vực (bảng Orders)', loai: 'chieu' },
    { id: 13, nhan: 'Ngày đặt (bảng Orders)', loai: 'chieu', thoiGian: true },
  ];

  const doc = (tho: unknown, cauHoi = 'doanh thu'): ExplorerQueryDto | null =>
    kiemForm(tho, { cauHoi, truong: DAY_DU });

  it('`limit` của "top 5" đi được vào truy vấn', () => {
    expect(doc({ dimensionIds: [11], measureIds: [21], limit: 5 })?.limit).toBe(5);
  });

  it('`limit` quá trần thì bỏ CẢ FORM, không âm thầm kẹp lại', () => {
    // Kẹp lại là đổi câu hỏi: "top 900" thành "top 500" mà không nói gì.
    expect(doc({ dimensionIds: [11], measureIds: [21], limit: 900 })).toBeNull();
    expect(doc({ dimensionIds: [11], measureIds: [21], limit: 0 })).toBeNull();
  });

  it('gom theo tháng đi được vào truy vấn', () => {
    const q = doc({
      dimensionIds: [],
      measureIds: [21],
      timeDimension: { dimensionId: 13, granularity: 'month' },
    });
    expect(q?.timeDimension).toEqual({ dimensionId: 13, granularity: 'month' });
  });

  /*
   * ⚠️ Chốt này chặn một lỗi HẠ TẦNG, không phải một lỗi hiểu nhầm.
   *
   * Cube ném lỗi khi gom một cột chuỗi theo tháng. Để mô hình chọn "Khu vực"
   * làm chiều thời gian thì người dùng nhận một mã lỗi 500 — tệ hơn hẳn "chưa
   * hiểu", vì nó trông như hệ thống hỏng chứ không như câu hỏi chưa được hiểu.
   */
  it('gom theo tháng trên cột KHÔNG phải thời gian thì bỏ cả form', () => {
    expect(
      doc({
        dimensionIds: [],
        measureIds: [21],
        timeDimension: { dimensionId: 11, granularity: 'month' },
      }),
    ).toBeNull();
  });

  it('mức gom lạ thì bỏ cả form', () => {
    expect(
      doc({
        dimensionIds: [],
        measureIds: [21],
        timeDimension: { dimensionId: 13, granularity: 'decade' },
      }),
    ).toBeNull();
  });

  it('đổi phép gộp sang trung bình đi được vào truy vấn', () => {
    const q = doc({
      dimensionIds: [11],
      measureIds: [21],
      measureAggs: [{ id: 21, agg: 'avg' }],
    });
    expect(q?.measureAggs).toEqual([{ id: 21, agg: 'avg' }]);
  });

  /*
   * ⚠️ Phép mà CỘT ĐÓ không nhận phải chết ở đây, không phải ở `buildQuery`.
   *
   * `buildQuery` ném `HttpError 400` cho trường hợp này — cố ý, để Explorer
   * không lặng lẽ lùi về phép mặc định. Nhưng trên đường hỏi đáp thì một 400
   * hiện ra thành sự cố, trong khi điều đã xảy ra chỉ là mô hình đoán sai một ô.
   */
  it('phép gộp mà thước đo không nhận thì bỏ cả form, không để `buildQuery` ném 400', () => {
    expect(
      doc({
        dimensionIds: [11],
        measureIds: [21],
        measureAggs: [{ id: 21, agg: 'countDistinct' }],
      }),
    ).toBeNull();
  });

  it('phép gộp gán cho một CHIỀU thì bỏ cả form', () => {
    expect(
      doc({ dimensionIds: [11], measureIds: [21], measureAggs: [{ id: 11, agg: 'avg' }] }),
    ).toBeNull();
  });

  /*
   * Danh sách trường gửi cho mô hình phải NÓI RA hai thứ này.
   *
   * Không ghi "gom theo thời gian được" thì mô hình đoán cột nào là ngày tháng
   * từ cái tên — và `kiemForm` bỏ cả form mỗi lần nó đoán trượt, tức câu hỏi
   * theo tháng gần như không bao giờ chạy được. Luật kiểm và lời nhắc phải nói
   * cùng một thứ; chúng là hai nửa của một cơ chế.
   */
  it('lời nhắc nói rõ chiều nào gom theo thời gian được và thước đo nhận phép nào', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi({ cauHoi: 'doanh thu theo tháng', truong: DAY_DU });

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { content: string }[];
    };
    const tat = than.messages.map((m) => m.content).join('\n');

    expect(tat).toContain('13 = Ngày đặt (bảng Orders) (chiều, gom theo thời gian được)');
    expect(tat).toContain('21 = Doanh thu (thước đo, phép gộp: sum/avg)');
    // Chiều thường KHÔNG được mang dấu đó, nếu không dấu ấy chẳng phân biệt gì.
    expect(tat).toContain('11 = Khu vực (bảng Orders) (chiều)');
  });
});

/**
 * `hieuLa` phải nói ra THỨ TỰ và LÁT CẮT, không chỉ trường và bộ lọc.
 *
 * Cả tác dụng của `hieuLa` nằm ở chỗ người đọc đối chiếu được "máy hiểu gì"
 * với "tôi hỏi gì". Hướng sắp là thứ quyết định dòng nào đứng đầu — tức là
 * quyết định cái mà người ta đọc như câu trả lời — nên nó im lặng thì dòng
 * giải thích bỏ sót đúng phần dễ sai nhất.
 */
describe('Dòng "Tôi hiểu" nói ra thứ tự', () => {
  const NHAN = new Map([
    [11, 'Khu vực'],
    [21, 'Doanh thu'],
  ]);

  const bang = (soDong: number): ExplorerResultDto => ({
    columns: [
      { id: 11, label: 'Khu vực', kind: 'dimension' },
      { id: 21, label: 'Doanh thu', kind: 'measure' },
    ],
    rows: Array.from({ length: soDong }, (_, i) => [`Vùng ${String(i)}`, 100 - i]),
    truncated: false,
  });

  const q: ExplorerQueryDto = { dimensionIds: [11], measureIds: [21] };

  it('nói "từ thấp lên" khi câu hỏi lật hướng', () => {
    expect(docKetQua(bang(3), q, NHAN, 'asc').hieuLa).toContain('xếp từ thấp lên');
  });

  /*
   * ⚠️ Phải nói CẢ KHI hướng là mặc định.
   *
   * Chỉ nói lúc bị lật thì người đọc không phân biệt được "máy hiểu là cao
   * nhất" với "máy không nghĩ tới chuyện thứ tự" — mà đó đúng là phân biệt mà
   * dòng này tồn tại để cho họ.
   */
  it('nói "từ cao xuống" cả khi đó là hướng mặc định', () => {
    expect(docKetQua(bang(3), q, NHAN, 'desc').hieuLa).toContain('xếp từ cao xuống');
  });

  it('một dòng duy nhất thì KHÔNG nói gì về thứ tự', () => {
    // Chữ thừa trong `hieuLa` làm loãng đúng dòng mà người đọc phải soi.
    expect(docKetQua(bang(1), q, NHAN, 'desc').hieuLa).not.toContain('xếp');
  });

  it('`limit` mô hình tự đặt phải hiện ra', () => {
    const coTran: ExplorerQueryDto = { ...q, limit: 5 };
    expect(docKetQua(bang(3), coTran, NHAN, 'desc').hieuLa).toContain('lấy 5 dòng đầu');
  });
});

/**
 * Mốc THỜI GIAN — ô form thứ tư, và ô duy nhất đi quanh luật canh gác.
 *
 * "Doanh thu tháng này" là câu hỏi phổ biến nhất của một công cụ BI, và trước
 * ô này khung trả lời được KHÔNG câu nào như thế: `giuNguyenLoi` buộc giá trị
 * lọc phải có trong lời người dùng, nên mô hình không bao giờ viết ra được
 * `2026-10-01`.
 *
 * Cách bịt: mô hình chọn một CỤM trong danh sách đóng, code giải thành ngày.
 * Nên ba thứ phải được canh:
 *
 *   1. Cụm thành đúng hai bộ lọc `gte`/`lt` trên đúng cột.
 *   2. Mô hình KHÔNG viết nổi một ngày nào vào truy vấn, kể cả khi nó thử.
 *   3. Lượt hỏi TIẾP không bị chính cái ngày ấy làm chết form.
 */
describe('Mốc thời gian', () => {
  const CO_NGAY: DatCauHoiInput['truong'] = [
    { id: 21, nhan: 'Doanh thu', loai: 'thuoc do', phepGop: ['sum', 'avg'] },
    { id: 11, nhan: 'Khu vực (bảng Orders)', loai: 'chieu' },
    { id: 13, nhan: 'Ngày đặt (bảng Orders)', loai: 'chieu', thoiGian: true },
  ];

  /** Thứ Năm 2026-10-15 — chốt mốc, nếu không ca này đỏ vào ngày cuối tháng. */
  const MOC = new Date(2026, 9, 15);

  const doc = (tho: unknown, cauHoi = 'doanh thu tháng này'): ExplorerQueryDto | null =>
    kiemForm(tho, { cauHoi, truong: CO_NGAY, moc: MOC });

  it('cụm thành hai bộ lọc trên đúng cột, mốc cuối HỞ', () => {
    const q = doc({
      dimensionIds: [],
      measureIds: [21],
      khoangThoiGian: { dimensionId: 13, cum: 'thang-nay' },
    });

    expect(q?.filters).toEqual([
      { dimensionId: 13, operator: 'gte', values: ['2026-10-01'] },
      // `lt`, không phải `lte`: cột có thể là DateTime, và `lte '2026-10-31'`
      // cắt mất mọi dòng của ngày 31 sau nửa đêm.
      { dimensionId: 13, operator: 'lt', values: ['2026-11-01'] },
    ]);
  });

  it('bộ lọc của cụm nối thêm vào bộ lọc mô hình tự điền, không thay chúng', () => {
    // ⚠️ Câu hỏi PHẢI chứa "Miền Bắc": `giuNguyenLoi` vẫn gác bộ lọc mô hình
    //    tự điền, và ô thời gian không nới luật đó ra cho mấy ô khác.
    const q = doc(
      {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: 'equals', values: ['Miền Bắc'] }],
        khoangThoiGian: { dimensionId: 13, cum: 'quy-truoc' },
      },
      'doanh thu Miền Bắc quý trước',
    );

    // "Doanh thu Miền Bắc quý trước" — cả hai điều kiện phải còn.
    expect(q?.filters).toHaveLength(3);
    expect(q?.filters?.[0]).toEqual({
      dimensionId: 11,
      operator: 'equals',
      values: ['Miền Bắc'],
    });
    expect(q?.filters?.[1]?.values).toEqual(['2026-07-01']);
  });

  /*
   * ⚠️ Chốt quan trọng nhất của khối này.
   *
   * Nếu mô hình viết được ngày vào `values` thì cả thiết kế "code giải cụm"
   * thành vô nghĩa — nó chỉ còn là một đường vòng mà mô hình có thể bỏ qua.
   * Một ngày lệch một tháng vẫn chạy ra số thật, cho một khoảng không ai hỏi.
   */
  it('mô hình TỰ viết ngày vào values thì bỏ cả form', () => {
    expect(
      doc({
        dimensionIds: [],
        measureIds: [21],
        filters: [{ dimensionId: 13, operator: 'gte', values: ['2026-10-01'] }],
      }),
    ).toBeNull();
  });

  it('cụm lạ thì bỏ cả form, không đoán một khoảng', () => {
    expect(
      doc({
        dimensionIds: [],
        measureIds: [21],
        khoangThoiGian: { dimensionId: 13, cum: 'hôm nào' },
      }),
    ).toBeNull();
  });

  it('cụm gán cho cột KHÔNG phải thời gian thì bỏ cả form', () => {
    expect(
      doc({
        dimensionIds: [],
        measureIds: [21],
        khoangThoiGian: { dimensionId: 11, cum: 'thang-nay' },
      }),
    ).toBeNull();
  });

  /*
   * ⚠️ Cái bẫy mà `daTinCay` sinh ra để gỡ.
   *
   * Lượt một: "doanh thu tháng này" -> form có `gte 2026-10-01`.
   * Lượt hai: "còn Miền Nam thì sao" -> mô hình giữ lại cả form cũ, ĐÚNG như
   * nó được dạy, nên nó chép lại cái ngày ấy. Ngày đó không có trong lời ai
   * cả, nên `giuNguyenLoi` bác và CẢ FORM bị bỏ.
   *
   * Hậu quả nếu không gỡ: mọi câu hỏi tiếp sau một câu có mốc thời gian đều
   * thành "chưa hiểu" — tức là bộ nhớ hội thoại chết đúng ở nhóm câu hỏi mà
   * người ta hỏi tiếp nhiều nhất.
   */
  it('lượt hỏi tiếp giữ lại được mốc thời gian của lượt trước', () => {
    const q = kiemForm(
      {
        dimensionIds: [],
        measureIds: [21],
        filters: [
          { dimensionId: 13, operator: 'gte', values: ['2026-10-01'] },
          { dimensionId: 13, operator: 'lt', values: ['2026-11-01'] },
          { dimensionId: 11, operator: 'equals', values: ['Miền Nam'] },
        ],
      },
      {
        cauHoi: 'còn Miền Nam thì sao',
        truong: CO_NGAY,
        moc: MOC,
        boiCanh: {
          cauHoi: 'doanh thu tháng này',
          truyVan: {
            dimensionIds: [],
            measureIds: [21],
            filters: [
              { dimensionId: 13, operator: 'gte', values: ['2026-10-01'] },
              { dimensionId: 13, operator: 'lt', values: ['2026-11-01'] },
            ],
          },
        },
      },
    );

    expect(q?.filters).toHaveLength(3);
  });

  /*
   * Nhưng cửa thứ hai KHÔNG được thành một cửa mở.
   *
   * Chỉ giá trị đã nằm trong form đã kiểm của lượt trước được thừa hưởng. Một
   * ngày KHÁC, mô hình tự nghĩ ra ở lượt này, vẫn phải chết.
   */
  it('ngày mô hình tự đổi ở lượt sau thì vẫn bỏ cả form', () => {
    const q = kiemForm(
      {
        dimensionIds: [],
        measureIds: [21],
        filters: [{ dimensionId: 13, operator: 'gte', values: ['2026-09-01'] }],
      },
      {
        cauHoi: 'còn Miền Nam thì sao',
        truong: CO_NGAY,
        moc: MOC,
        boiCanh: {
          cauHoi: 'doanh thu tháng này',
          truyVan: {
            dimensionIds: [],
            measureIds: [21],
            filters: [{ dimensionId: 13, operator: 'gte', values: ['2026-10-01'] }],
          },
        },
      },
    );

    expect(q).toBeNull();
  });

  it('lời nhắc nói rõ danh sách cụm và cấm mô hình tự viết ngày', async () => {
    const { datCauHoi } = await napVoiEnv(DU_CAU_HINH);
    const goi = vi.fn().mockResolvedValue(traVe('{}'));
    globalThis.fetch = goi;

    await datCauHoi({ cauHoi: 'doanh thu tháng này', truong: CO_NGAY });

    const than = JSON.parse(String((goi.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { content: string }[];
    };
    const tat = than.messages.map((m) => m.content).join('\n');

    expect(tat).toContain('thang-nay');
    expect(tat).toContain('quy-truoc');
    expect(tat).toContain('không tự viết ngày tháng vào values');
  });
});

/**
 * Khoảng ngày đã giải ra phải HIỆN RA cho người dùng đối chiếu.
 *
 * Mô hình chọn cụm, code giải thành ngày — nên người dùng không thấy được hệ
 * thống hiểu "tháng này" là khoảng nào, trừ khi `hieuLa` nói ra. Mà đó chính
 * là chỗ dễ sai nhất: lệch một tháng vẫn chạy ra số thật.
 */
describe('Dòng "Tôi hiểu" nói ra khoảng ngày', () => {
  const NHAN = new Map([
    [13, 'Ngày đặt'],
    [21, 'Doanh thu'],
  ]);

  const MOT_DONG: ExplorerResultDto = {
    columns: [{ id: 21, label: 'Doanh thu', kind: 'measure' }],
    rows: [[9000]],
    truncated: false,
  };

  const CO_NGAY: DatCauHoiInput['truong'] = [
    { id: 21, nhan: 'Doanh thu', loai: 'thuoc do', phepGop: ['sum'] },
    { id: 13, nhan: 'Ngày đặt', loai: 'chieu', thoiGian: true },
  ];

  it('cặp gte/lt của một cụm đọc thành MỘT câu, với mốc cuối nói là "trước"', () => {
    const q = kiemForm(
      {
        dimensionIds: [],
        measureIds: [21],
        khoangThoiGian: { dimensionId: 13, cum: 'thang-nay' },
      },
      { cauHoi: 'doanh thu tháng này', truong: CO_NGAY, moc: new Date(2026, 9, 15) },
    );

    const { hieuLa } = docKetQua(MOT_DONG, q as ExplorerQueryDto, NHAN);

    // Hai mốc thật, trên một dòng đọc được — không phải hai mệnh đề rời.
    expect(hieuLa).toContain('lọc Ngày đặt từ 2026-10-01 đến trước 2026-11-01');
  });

  /*
   * Một `gte` ĐƠN ĐỘC vẫn phải đọc bằng nhãn toán tử bình thường.
   *
   * Phép gộp cặp không được nuốt nó: "doanh thu từ 1000 trở lên" là một điều
   * kiện có thật mà mô hình điền được, và nó không có vế trên nào.
   */
  it('gte đứng một mình thì vẫn đọc theo nhãn toán tử', () => {
    const q: ExplorerQueryDto = {
      dimensionIds: [],
      measureIds: [21],
      filters: [{ dimensionId: 13, operator: 'gte', values: ['2026-10-01'] }],
    };

    expect(docKetQua(MOT_DONG, q, NHAN).hieuLa).toContain('lọc Ngày đặt từ … trở lên 2026-10-01');
  });
});

/**
 * LÝ DO bỏ form — ba cửa mà người dùng làm được gì đó.
 *
 * `kiemForm` có hơn ba mươi chỗ `return null`, và người dùng thấy đúng một câu
 * "Tôi chưa hiểu câu này" cho cả ba mươi. Phần lớn số đó là "mô hình trả về
 * rác" — nói ra cũng không ai làm gì được. Ba lý do dưới đây thì mỗi cái ứng
 * với một việc làm được, nên im lặng ở đó là đẩy người dùng vào vòng gõ lại
 * bằng cách khác mà cách nào cũng trượt.
 */
describe('Lý do bỏ form', () => {
  const DAY_DU: DatCauHoiInput['truong'] = [
    { id: 21, nhan: 'Doanh thu', loai: 'thuoc do', phepGop: ['sum', 'avg'] },
    { id: 11, nhan: 'Khu vực (bảng Orders)', loai: 'chieu' },
    { id: 13, nhan: 'Ngày đặt (bảng Orders)', loai: 'chieu', thoiGian: true },
  ];

  const vao = (cauHoi: string): DatCauHoiInput => ({ cauHoi, truong: DAY_DU });

  it('giá trị lọc không phải lời người dùng -> nói là không chắc dữ liệu ghi thế nào', () => {
    const { truyVan, lyDo } = kiemFormCoLyDo(
      {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: 'equals', values: ['Monitor'] }],
      },
      vao('doanh thu của màn hình'),
    );

    expect(truyVan).toBeNull();
    expect(lyDo).toBe('gia-tri-la');
    // Câu hiện ra phải nói VIỆC CẦN LÀM, không chỉ nêu rào chắn.
    expect(LY_DO_NOI[lyDo as 'gia-tri-la']).toContain('như nó hiện trong bảng');
  });

  it('phép gộp thước đo không nhận -> chỉ sang tab Thước đo', () => {
    const { lyDo } = kiemFormCoLyDo(
      { dimensionIds: [11], measureIds: [21], measureAggs: [{ id: 21, agg: 'countDistinct' }] },
      vao('đếm riêng doanh thu'),
    );

    expect(lyDo).toBe('phep-gop-la');
    expect(LY_DO_NOI['phep-gop-la']).toContain('tab Thước đo');
  });

  it('gom thời gian trên cột không phải ngày -> chỉ sang tab Schemas', () => {
    const { lyDo } = kiemFormCoLyDo(
      {
        dimensionIds: [],
        measureIds: [21],
        timeDimension: { dimensionId: 11, granularity: 'month' },
      },
      vao('doanh thu theo tháng'),
    );

    expect(lyDo).toBe('thieu-cot-ngay');
    expect(LY_DO_NOI['thieu-cot-ngay']).toContain('tab Schemas');
  });

  it('mốc thời gian trên cột không phải ngày -> cùng lý do đó', () => {
    const { lyDo } = kiemFormCoLyDo(
      { dimensionIds: [], measureIds: [21], khoangThoiGian: { dimensionId: 11, cum: 'thang-nay' } },
      vao('doanh thu tháng này'),
    );

    expect(lyDo).toBe('thieu-cot-ngay');
  });

  /*
   * ⚠️ Mọi kiểu hỏng KHÁC phải im.
   *
   * Nói "mô hình trả về id 99 không có trong danh sách" là phơi ruột một lớp
   * mà người dùng không cần biết có tồn tại, và nó không gợi được việc gì.
   */
  it('mô hình trả về rác -> KHÔNG có lý do nào, im như trước', () => {
    expect(kiemFormCoLyDo({ dimensionIds: [11], measureIds: [99] }, vao('x')).lyDo).toBeNull();
    expect(kiemFormCoLyDo({}, vao('x')).lyDo).toBeNull();
    expect(kiemFormCoLyDo('không phải object', vao('x')).lyDo).toBeNull();
  });

  /*
   * Form SỐNG thì không có lý do nào, kể cả khi dọc đường có nhánh từng được
   * chạm tới. Một câu trả lời đúng mà kèm lời giải thích về một thất bại là
   * thứ không ai đọc nổi.
   */
  it('form sống -> lý do là null', () => {
    const { truyVan, lyDo } = kiemFormCoLyDo(
      { dimensionIds: [11], measureIds: [21] },
      vao('doanh thu theo khu vực'),
    );

    expect(truyVan).not.toBeNull();
    expect(lyDo).toBeNull();
  });

  /** `kiemForm` giữ nguyên chữ ký — hơn ba mươi chỗ gọi nó không phải đổi gì. */
  it('kiemForm vẫn gọi được với hai tham số như cũ', () => {
    expect(kiemForm({ dimensionIds: [11], measureIds: [21] }, vao('doanh thu'))).not.toBeNull();
  });
});
