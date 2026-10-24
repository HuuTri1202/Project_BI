import type {
  ExplorerFieldsDto,
  ExplorerQueryDto,
  ExplorerResultDto,
  MeasureSourceDto,
} from '@bi/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kiemForm, kiemFormCoLyDo } from '../src/services/chat/datCauHoi';
import { buildQuery, type ModelIndex } from '../src/services/datamodel/explorer';

/**
 * BẢNG ĐIỂM cho đường MÔ HÌNH DỰNG TRUY VẤN — §chat, bước (4).
 *
 * ═══ Vì sao bộ này phải tồn tại ════════════════════════════════════════════
 *
 * `frontend/tests/danhGia.test.ts` đo 191 câu trên 25 trang, và cả 191 câu đều
 * chạy ở lớp NGOẠI TUYẾN — lớp chỉ đọc lại thứ trang đang giữ sẵn. Đường đắt
 * nhất và nguy hiểm nhất của khung thì KHÔNG có bảng điểm nào: đường mà mô
 * hình dựng một truy vấn MỚI rồi quét kho.
 *
 * Hệ quả đo được ngay lần chạy đầu của bộ này: `hoiTrenMoHinh` gọi
 * `runExplorerQuery` mà không nói hướng sắp, nên `buildQuery` áp `desc` cho
 * mọi câu. Hỏi "sản phẩm nào bán ÍT nhất" thì nhận về danh sách bán CHẠY
 * nhất, và `docKetQua` liệt kê theo đúng thứ tự ấy. Dòng đầu — thứ người ta
 * đọc như câu trả lời — là đáp án của câu hỏi NGƯỢC LẠI.
 *
 * Đó là một con số THẬT trả lời một câu hỏi KHÁC, tức đúng hình dạng **SAI**
 * mà cả khung này dựng lên để chặn. Nó nằm đó vì phép đo dừng trước cửa.
 *
 * ═══ Thứ được giả lập, và thứ KHÔNG ════════════════════════════════════════
 *
 * Chỉ hai thứ bị thay: mô hình ngôn ngữ (mỗi ca tự khai JSON nó trả về) và
 * ClickHouse (`chayGia` bên dưới). Mọi thứ giữa hai đầu ấy là code thật —
 * `kiemForm` kiểm form, `buildQuery` dựng truy vấn Cube, `docKetQua` đọc bảng
 * thành câu. Nên tháo một dây nối ở `hoiTrenMoHinh` là bộ này đỏ.
 *
 * `chayGia` giả lập ĐÚNG hai điều khoản của Cube mà bộ này đo — `order` và
 * `limit` — và đọc chúng ra từ `query` do `buildQuery` THẬT sinh ra, chứ không
 * từ `truyVan`. Giả lập một thứ mình tự giả định là đo chính mình.
 *
 * ═══ Ba kết cục, không phải hai ════════════════════════════════════════════
 *
 * Cùng thang với bảng điểm bên frontend:
 *
 *   ĐÚNG — tên đứng đầu câu trả lời là tên đáng ra phải đứng đầu.
 *   CHƯA — không dựng được truy vấn nào. Một thất bại NHÌN THẤY ĐƯỢC.
 *   SAI  — một tên khác đứng đầu. Người đọc lấy nó. Chỉ cái này nguy hiểm.
 */

// ─── Mô hình giả: thay mô hình ngôn ngữ và kho, giữ nguyên phần giữa ─────────

const gia = vi.hoisted(() => ({
  explorerFields: vi.fn(),
  runExplorerQuery: vi.fn(),
  datCauHoi: vi.fn(),
}));

/*
 * Trải bản THẬT ra rồi chỉ đè hai hàm chạm hạ tầng.
 *
 * `buildQuery` phải là bản thật — nó chính là thứ đang được đo. Thay cả module
 * thì bộ này chỉ còn đo mấy con số nó tự bịa ra trong chính nó.
 */
vi.mock('../src/services/datamodel/explorer', async (goc) => ({
  ...(await goc<Record<string, unknown>>()),
  explorerFields: gia.explorerFields,
  runExplorerQuery: gia.runExplorerQuery,
}));

vi.mock('../src/services/chat/datCauHoi', async (goc) => ({
  ...(await goc<Record<string, unknown>>()),
  datCauHoi: gia.datCauHoi,
}));

// `vi.mock` được nâng lên trước mọi import, nên import tĩnh vẫn nhận bản giả.
import { hoiTrenMoHinh } from '../src/services/chat/hoiTrenMoHinh';

// ─── Một mô hình dữ liệu dựng tay ────────────────────────────────────────────

const NGUON = { kind: 'column', text: 'amount' } as unknown as MeasureSourceDto;

const CHI_MUC: ModelIndex = {
  columns: new Map([
    [11, { cubeName: 'c_sp', label: 'Sản phẩm', chType: 'String', datasetName: 'Products' }],
  ]),
  measures: new Map([
    [
      21,
      {
        cubeName: 'c_sp',
        label: 'Doanh thu',
        datasetName: 'Products',
        format: undefined as never,
        agg: 'sum' as const,
        availableAggs: ['sum', 'avg'] as const,
        nguon: NGUON,
      },
    ],
  ]),
};

const TRUONG: ExplorerFieldsDto = {
  dimensions: [{ id: 11, label: 'Sản phẩm', datasetName: 'Products', cubeType: 'string' }],
  measures: [
    {
      id: 21,
      label: 'Doanh thu',
      datasetName: 'Products',
      cubeType: 'number',
      agg: 'sum',
      availableAggs: ['sum', 'avg'],
      nguon: NGUON,
    },
  ],
};

/**
 * Năm sản phẩm, và thứ hạng theo TỔNG khác hẳn thứ hạng theo TRUNG BÌNH.
 *
 * Cố ý: nếu `kiemForm` đánh rơi `measureAggs` thì câu hỏi "trung bình cao
 * nhất" được trả lời bằng quán quân của tổng — một con số thật, một câu hỏi
 * khác. Hai thứ hạng mà trùng nhau thì bộ này không nhìn thấy chuyện đó.
 *
 *   tổng giảm   : Màn hình, Bàn phím, Chuột, Tai nghe, Webcam
 *   tổng tăng   : Webcam, Tai nghe, Chuột, Bàn phím, Màn hình
 *   t.bình giảm : Bàn phím, Webcam, Tai nghe, Màn hình, Chuột
 *   t.bình tăng : Chuột, Màn hình, Tai nghe, Webcam, Bàn phím
 */
const BANG = [
  { ten: 'Màn hình', tong: 2300, tb: 46 },
  { ten: 'Bàn phím', tong: 980, tb: 98 },
  { ten: 'Chuột', tong: 540, tb: 18 },
  { ten: 'Tai nghe', tong: 120, tb: 60 },
  { ten: 'Webcam', tong: 75, tb: 75 },
];

/**
 * ClickHouse giả — `order`, `limit` và `equals`, đọc ra từ `query` thật.
 *
 * Không gộp: bảng trên đã là bảng ĐÃ GỘP. Bộ này đo cách một câu hỏi biến
 * thành thứ tự và lát cắt, không đo phép gộp của ClickHouse.
 *
 * `equals` thì PHẢI có, dù nó không phải thứ bộ này đo. Bỏ qua bộ lọc nghĩa là
 * mọi ca có lọc đều nhận về cả năm dòng, và chúng "SAI" vì bộ đo thủng chứ
 * không vì sản phẩm hỏng — một ca đỏ nói dối còn tệ hơn một ca thiếu.
 */
function chayGia(
  truyVan: ExplorerQueryDto,
  internal: { order?: 'asc' | 'desc' },
): ExplorerResultDto {
  const { query, columns, keys, limit } = buildQuery(CHI_MUC, truyVan, internal);

  const khoaDo = Object.keys(query.order ?? {})[0];
  const huong = khoaDo === undefined ? 'desc' : (query.order?.[khoaDo] ?? 'desc');
  // Tên cube mang hậu tố phép gộp khi câu hỏi đổi phép — xem `measureNameFor`.
  const dungTb = khoaDo?.endsWith('_avg') === true;
  const soCua = (d: (typeof BANG)[number]): number => (dungTb ? d.tb : d.tong);

  // Không chiều nào: Cube trả về đúng một dòng tổng, không phải năm dòng.
  if (truyVan.dimensionIds.length === 0) {
    const tong = BANG.reduce((t, d) => t + soCua(d), 0);
    return { columns, rows: [keys.map(() => tong)], truncated: false };
  }

  // Chỉ `equals` trên chiều Sản phẩm — đúng bằng thứ các ca dưới đây dùng.
  const giuLai = (query.filters ?? []).flatMap((f) =>
    'member' in f && f.operator === 'equals' ? [new Set(f.values)] : [],
  );
  const loc = BANG.filter((d) => giuLai.every((g) => g.has(d.ten)));

  const sap = [...loc].sort((a, b) =>
    huong === 'asc' ? soCua(a) - soCua(b) : soCua(b) - soCua(a),
  );
  const rows = sap
    .slice(0, limit)
    .map((d) => keys.map((k) => (k.includes('.d') ? d.ten : soCua(d))));

  return { columns, rows, truncated: rows.length >= limit };
}

// ─── Chấm điểm ───────────────────────────────────────────────────────────────

interface Ca {
  cauHoi: string;
  /** JSON mô hình trả về — cái form nó điền khi nó hiểu đúng câu hỏi. */
  moHinh: unknown;
  /** Tên PHẢI đứng đầu câu trả lời. `null` = không được gọi tên ai cả. */
  dau: string | null;
  /** Lượt hỏi TRƯỚC, khi ca này là một câu hỏi tiếp. */
  truoc?: string;
  /** Vì sao ca này có mặt. */
  vi: string;
}

/** Tên nào của bảng xuất hiện SỚM NHẤT trong câu — đó là tên người đọc lấy. */
function tenDauTien(cau: string): string | null {
  let dau: { ten: string; i: number } | null = null;
  for (const d of BANG) {
    const i = cau.indexOf(d.ten);
    if (i >= 0 && (dau === null || i < dau.i)) dau = { ten: d.ten, i };
  }
  return dau?.ten ?? null;
}

const CAC_CA: Ca[] = [
  // ─── Hướng sắp: thứ mà bảng điểm này sinh ra để bắt ────────────────────────
  {
    cauHoi: 'sản phẩm nào bán chạy nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Màn hình',
    vi: 'Hướng mặc định `desc` đúng — nhưng đúng một cách TÌNH CỜ.',
  },
  {
    cauHoi: 'sản phẩm nào doanh thu cao nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Màn hình',
    vi: 'Cùng hướng, chữ khác.',
  },
  {
    cauHoi: 'sản phẩm nào bán ít nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Webcam',
    vi: '⚠️ Ca sinh ra cả bảng điểm này. Trước bản sửa: trả về Màn hình.',
  },
  {
    cauHoi: 'sản phẩm nào doanh thu thấp nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Webcam',
    vi: '"thấp" cũng lật hướng, không chỉ "ít".',
  },
  {
    cauHoi: 'sản phẩm nào ít doanh thu nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Webcam',
    vi: 'Danh từ chen giữa "ít" và "nhất" — so chuỗi liền nhau sẽ trượt ca này.',
  },
  {
    cauHoi: 'sản phẩm nào rẻ nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Webcam',
    vi: '"rẻ" nằm trong danh sách lật hướng, cùng bản với lớp ngoại tuyến.',
  },

  // ─── `limit`: lát cắt sai thì SAI CẢ TẬP, không chỉ sai thứ tự ─────────────
  {
    cauHoi: 'top 3 sản phẩm doanh thu cao nhất',
    moHinh: { dimensionIds: [11], measureIds: [21], limit: 3 },
    dau: 'Màn hình',
    vi: 'Cắt 3 theo chiều giảm: tập đúng, đầu đúng.',
  },
  {
    cauHoi: '3 sản phẩm doanh thu thấp nhất',
    moHinh: { dimensionIds: [11], measureIds: [21], limit: 3 },
    dau: 'Webcam',
    vi: '⚠️ Cắt 3 mà sai hướng thì ba cái CAO nhất lọt vào — sai cả tập.',
  },

  // ─── `measureAggs`: đánh rơi là trả lời bằng một phép tính khác ────────────
  {
    cauHoi: 'sản phẩm nào có doanh thu trung bình cao nhất',
    moHinh: { dimensionIds: [11], measureIds: [21], measureAggs: [{ id: 21, agg: 'avg' }] },
    dau: 'Bàn phím',
    vi: '⚠️ Rơi `measureAggs` thì ra Màn hình — quán quân của TỔNG.',
  },
  {
    cauHoi: 'sản phẩm nào có doanh thu trung bình thấp nhất',
    moHinh: { dimensionIds: [11], measureIds: [21], measureAggs: [{ id: 21, agg: 'avg' }] },
    dau: 'Chuột',
    vi: 'Đổi phép gộp VÀ lật hướng cùng một lúc.',
  },

  // ─── Bộ lọc: luật "lời của người dùng" vẫn phải đứng ───────────────────────
  {
    cauHoi: 'doanh thu của Webcam là bao nhiêu',
    moHinh: {
      dimensionIds: [11],
      measureIds: [21],
      filters: [{ dimensionId: 11, operator: 'equals', values: ['Webcam'] }],
    },
    dau: 'Webcam',
    vi: 'Bộ lọc dùng đúng chữ người dùng gõ — form sống, câu gọi đúng tên.',
  },
  {
    cauHoi: 'doanh thu của màn hình là bao nhiêu',
    moHinh: {
      dimensionIds: [11],
      measureIds: [21],
      filters: [{ dimensionId: 11, operator: 'equals', values: ['Monitor'] }],
    },
    dau: null,
    vi: '⚠️ Mô hình DỊCH giá trị lọc. Phải bỏ cả form — CHƯA, không phải SAI.',
  },

  // ─── Lượt hỏi TIẾP: hướng phải đi theo form được giữ lại ──────────────────
  {
    cauHoi: 'còn tính theo trung bình thì sao',
    truoc: 'sản phẩm nào bán ít nhất',
    moHinh: { dimensionIds: [11], measureIds: [21], measureAggs: [{ id: 21, agg: 'avg' }] },
    dau: 'Chuột',
    vi: '⚠️ Lượt mới im lặng về thứ hạng — phải giữ `asc` của lượt trước.',
  },
  {
    cauHoi: 'thế sản phẩm nào cao nhất',
    truoc: 'sản phẩm nào bán ít nhất',
    moHinh: { dimensionIds: [11], measureIds: [21] },
    dau: 'Màn hình',
    vi: '⚠️ Lượt mới tự nói hướng — KHÔNG được để lượt trước ghi đè.',
  },

  // ─── Form hỏng: phải thành CHƯA, tuyệt đối không thành SAI ─────────────────
  {
    cauHoi: 'sản phẩm nào lãi nhất',
    moHinh: { dimensionIds: [11], measureIds: [99] },
    dau: null,
    vi: 'Id bịa. Bỏ cả form.',
  },
  {
    cauHoi: 'doanh thu theo cái gì đó',
    moHinh: {},
    dau: null,
    vi: 'Mô hình nói thẳng là nó không trả lời được.',
  },
  {
    cauHoi: 'sản phẩm nào bán ít nhất, hỏi lần hai',
    moHinh: { dimensionIds: [21], measureIds: [11] },
    dau: null,
    vi: 'Đảo vai chiều/thước đo. Bỏ cả form.',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  gia.explorerFields.mockResolvedValue(TRUONG);
  gia.runExplorerQuery.mockImplementation(
    (
      _t: number,
      _u: number,
      _m: number,
      input: ExplorerQueryDto,
      internal: { order?: 'asc' | 'desc' } = {},
    ) => Promise.resolve(chayGia(input, internal)),
  );
});

/** Chạy một ca qua ĐÚNG đường thật, chỉ thay mô hình ngôn ngữ và kho. */
async function chayCa(c: Ca): Promise<{ ketCuc: 'dung' | 'chua' | 'sai'; cau: string | null }> {
  gia.datCauHoi.mockImplementation((input: Parameters<typeof kiemForm>[1]) =>
    Promise.resolve({ truyVan: kiemForm(c.moHinh, input), daHoi: true }),
  );

  const truoc =
    c.truoc === undefined
      ? undefined
      : { cauHoi: c.truoc, truyVan: { dimensionIds: [11], measureIds: [21] } };

  const { cau } = await hoiTrenMoHinh(1, 1, 1, c.cauHoi, truoc);
  if (cau === null) return { ketCuc: c.dau === null ? 'dung' : 'chua', cau };

  const dau = tenDauTien(cau);
  if (dau === c.dau) return { ketCuc: 'dung', cau };
  // Gọi tên một ai đó mà đáng ra không được gọi ai: người đọc vẫn lấy tên ấy.
  return { ketCuc: 'sai', cau };
}

describe('Bảng điểm — đường mô hình dựng truy vấn', () => {
  const ketCuc = new Map<string, 'dung' | 'chua' | 'sai'>();

  for (const [i, c] of CAC_CA.entries()) {
    it(`[${String(i + 1)}] ${c.cauHoi} -> ${c.dau ?? 'không gọi tên ai'}`, async () => {
      const { ketCuc: kc, cau } = await chayCa(c);
      ketCuc.set(`${String(i)}|${c.cauHoi}`, kc);

      expect(kc, `${c.vi}\nCâu trả lời: ${cau ?? '(không có)'}`).not.toBe('sai');
      expect(kc, c.vi).toBe('dung');
    });
  }

  it('bảng điểm: SAI phải bằng 0', () => {
    const dem = (k: string): number => [...ketCuc.values()].filter((v) => v === k).length;
    const tong = ketCuc.size;
    const phan = (n: number): string => `${((n / tong) * 100).toFixed(1)}%`;

    console.info(
      [
        '',
        `── Bảng điểm đường MÔ HÌNH trên ${String(tong)} câu hỏi ──────────────`,
        `  ĐÚNG       ${String(dem('dung'))}/${String(tong)}  ${phan(dem('dung'))}`,
        `  CHƯA HIỂU  ${String(dem('chua'))}/${String(tong)}  ${phan(dem('chua'))}`,
        `  SAI        ${String(dem('sai'))}/${String(tong)}  ${phan(dem('sai'))}`,
        '',
      ].join('\n'),
    );

    // Bánh cóc: chỉ đi lên. Với SAI thì không có mức nào khác ngoài 0.
    expect(dem('sai')).toBe(0);
    expect(dem('dung')).toBeGreaterThanOrEqual(CAC_CA.length);
  });
});

/**
 * Dòng "Tôi hiểu" của ĐƯỜNG THẬT phải mang theo hướng sắp.
 *
 * Bảng điểm trên đo câu trả lời; bài này đo cái dòng duy nhất cho người đọc
 * đối chiếu "máy hiểu gì" với "tôi hỏi gì". Hai thứ tách nhau vì chúng hỏng
 * tách nhau: `hoiTrenMoHinh` có thể sắp đúng mà quên nói, và khi đó câu trả
 * lời đúng nhưng không còn gì để kiểm nó.
 */
describe('Hướng sắp đi tới tận dòng giải thích', () => {
  it('câu hỏi lật hướng -> "Tôi hiểu" nói "từ thấp lên"', async () => {
    gia.datCauHoi.mockResolvedValue({
      truyVan: { dimensionIds: [11], measureIds: [21] },
      daHoi: true,
    });

    const { hieuLa } = await hoiTrenMoHinh(1, 1, 1, 'sản phẩm nào bán ít nhất');

    expect(hieuLa).toContain('xếp từ thấp lên');
  });

  it('câu hỏi xuôi chiều -> vẫn nói ra, là "từ cao xuống"', async () => {
    gia.datCauHoi.mockResolvedValue({
      truyVan: { dimensionIds: [11], measureIds: [21] },
      daHoi: true,
    });

    const { hieuLa } = await hoiTrenMoHinh(1, 1, 1, 'sản phẩm nào bán chạy nhất');

    expect(hieuLa).toContain('xếp từ cao xuống');
  });
});

/**
 * Lý do bế tắc và gợi ý hỏi tiếp phải đi được TỚI NGOÀI.
 *
 * `kiemFormCoLyDo` và `goiYTiep` đã có bộ canh riêng, nhưng cả hai chỉ có ích
 * khi `hoiTrenMoHinh` thật sự mang chúng ra. Đây là hai dây nối, và dây nối
 * tháo ra thì không bài nào ở hai bộ kia đỏ.
 */
describe('Lý do và gợi ý ra tới hợp đồng của endpoint', () => {
  it('form bị bỏ vì một lý do nói ra được -> `lyDo` là CÂU, không phải mã', async () => {
    // Phép gộp mà thước đo không nhận — `Doanh thu` chỉ có sum/avg.
    gia.datCauHoi.mockImplementation((input: Parameters<typeof kiemForm>[1]) =>
      Promise.resolve({
        ...kiemFormCoLyDo(
          {
            dimensionIds: [11],
            measureIds: [21],
            measureAggs: [{ id: 21, agg: 'countDistinct' }],
          },
          input,
        ),
        daHoi: true,
      }),
    );

    const { cau, lyDo } = await hoiTrenMoHinh(1, 1, 1, 'đếm riêng doanh thu theo sản phẩm');

    expect(cau).toBeNull();
    // Câu đọc được, không phải `'phep-gop-la'` — panel in thẳng ra màn hình.
    expect(lyDo).toContain('tab Thước đo');
  });

  it('mô hình trả về rác -> `lyDo` là null, khung im như trước', async () => {
    gia.datCauHoi.mockImplementation((input: Parameters<typeof kiemForm>[1]) =>
      Promise.resolve({
        ...kiemFormCoLyDo({ dimensionIds: [11], measureIds: [99] }, input),
        daHoi: true,
      }),
    );

    const { cau, lyDo } = await hoiTrenMoHinh(1, 1, 1, 'sản phẩm nào lãi nhất');

    expect(cau).toBeNull();
    expect(lyDo).toBeNull();
  });

  it('câu trả lời được -> mang theo gợi ý hỏi tiếp, không mang lý do', async () => {
    gia.datCauHoi.mockResolvedValue({
      truyVan: { dimensionIds: [11], measureIds: [21] },
      daHoi: true,
      lyDo: null,
    });

    const { cau, lyDo, goiY } = await hoiTrenMoHinh(1, 1, 1, 'sản phẩm nào bán chạy nhất');

    expect(cau).not.toBeNull();
    expect(lyDo).toBeNull();
    // Bảng đang giảm, nên câu tiếp phải mời xem phía thấp.
    expect(goiY[0]).toContain('thấp nhất');
    // Và nhãn gọn: `TRUONG` khai chiều là "Sản phẩm", `hoiTrenMoHinh` thêm
    // "(bảng Products)" để mô hình phân biệt — câu gợi ý thì không được mang nó.
    expect(goiY.join(' ')).not.toContain('bảng Products');
  });
});
