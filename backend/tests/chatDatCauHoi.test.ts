import type { ExplorerQueryDto, ExplorerResultDto } from '@bi/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { giuNguyenLoi, kiemForm, type DatCauHoiInput } from '../src/services/chat/datCauHoi';
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

    expect(await datCauHoi(vao('doanh thu theo khu vực'))).toEqual({
      truyVan: null,
      daHoi: false,
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

    expect(await datCauHoi(vao('gì đó'))).toEqual({ truyVan: null, daHoi: false });
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
