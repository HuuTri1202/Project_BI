import type { MeasureSourceDto } from '@bi/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Chỉ `loadFromCube` bị thay — `buildQuery` và phép đọc `rows` phải là bản
 * thật, vì chúng chính là thứ đang được đo.
 */
const gia = vi.hoisted(() => ({ loadFromCube: vi.fn() }));

vi.mock('../src/services/datamodel/cubeClient', async (goc) => ({
  ...(await goc<Record<string, unknown>>()),
  loadFromCube: gia.loadFromCube,
}));

import { buildQuery, runExplorerQuery, type ModelIndex } from '../src/services/datamodel/explorer';

/**
 * Chiều THỜI GIAN phải đọc được NGƯỢC VỀ, không chỉ gửi đi — §10.7.
 *
 * ═══ Lỗi mà bộ này canh ════════════════════════════════════════════════════
 *
 * `timeDimension` có trong hợp đồng HTTP từ lâu và `buildQuery` vẫn dịch nó
 * sang `query.timeDimensions` của Cube. Nhưng nó CHƯA TỪNG được ai gửi: không
 * màn nào bên frontend dựng ô này, nên cả nhánh chưa bao giờ chạy thật.
 *
 * Và nó thủng một nửa. Cube trả giá trị đã gom dưới khoá có HẬU TỐ mức gom
 * (`c_orders.d13.month`), còn `keys` — thứ duy nhất quyết định cột nào đi vào
 * `rows` — chỉ chứa khoá của các chiều thường. Nên một truy vấn gom theo tháng
 * trả về đúng số dòng, mỗi dòng đúng con số, và KHÔNG dòng nào nói nó là tháng
 * mấy.
 *
 * Kiểu hỏng này không tự lộ: bảng vẫn có số, biểu đồ vẫn vẽ được. Nó chỉ lộ ở
 * chỗ người đọc không biết dòng nào là dòng nào.
 *
 * ⚠️ Khoá có hậu tố mức gom là HỢP ĐỒNG của Cube REST API, và chốt dưới đây
 * đứng trên nó. Chưa đối chiếu được với Cube thật (container đang tắt) — đây
 * là chỗ duy nhất của bản này cần một lượt chạy thật để chốt hẳn.
 */

const NGUON = { kind: 'column', text: 'amount' } as unknown as MeasureSourceDto;

function chiMuc(): ModelIndex {
  return {
    columns: new Map([
      [11, { cubeName: 'c_orders', label: 'Khu vực', chType: 'String', datasetName: 'Orders' }],
      [13, { cubeName: 'c_orders', label: 'Ngày đặt', chType: 'Date', datasetName: 'Orders' }],
    ]),
    measures: new Map([
      [
        21,
        {
          cubeName: 'c_orders',
          label: 'Doanh thu',
          datasetName: 'Orders',
          format: undefined as never,
          agg: 'sum' as const,
          availableAggs: ['sum', 'avg'] as const,
          nguon: NGUON,
        },
      ],
    ]),
  };
}

describe('Chiều thời gian', () => {
  it('đi vào truy vấn Cube với đúng mức gom', () => {
    const { query } = buildQuery(chiMuc(), {
      dimensionIds: [],
      measureIds: [21],
      timeDimension: { dimensionId: 13, granularity: 'month' },
    });

    expect(query.timeDimensions).toEqual([{ dimension: 'c_orders.d13', granularity: 'month' }]);
  });

  /** ⚠️ Chốt chính của bộ này. */
  it('sinh ra một CỘT KẾT QUẢ đọc được, với khoá mang hậu tố mức gom', () => {
    const { columns, keys } = buildQuery(chiMuc(), {
      dimensionIds: [],
      measureIds: [21],
      timeDimension: { dimensionId: 13, granularity: 'month' },
    });

    // Khoá phải là `…d13.month`, KHÔNG phải `…d13` — Cube trả về dưới khoá đầu.
    expect(keys).toContain('c_orders.d13.month');
    expect(keys).not.toContain('c_orders.d13');

    // Và nhãn phải nói ra mức gom: "Ngày đặt" một mình không phân biệt được
    // gom theo ngày với gom theo tháng.
    const cot = columns.find((c) => c.label.startsWith('Ngày đặt'));
    expect(cot).toEqual({ id: 13, label: 'Ngày đặt (Tháng)', kind: 'dimension' });
  });

  /*
   * `columns` và `keys` phải đi SONG SONG từng ô.
   *
   * `runExplorerQuery` đọc `rows` bằng `keys.map(...)` rồi gắn nhãn bằng
   * `columns` theo CHỈ SỐ. Lệch một ô là mọi cột đọc nhầm nhãn của cột bên
   * cạnh — con số vẫn đúng, tên thì sai hết, và không có gì báo động.
   */
  it('cột thời gian chen vào giữa chiều và thước đo mà không làm lệch hai mảng', () => {
    const { columns, keys } = buildQuery(chiMuc(), {
      dimensionIds: [11],
      measureIds: [21],
      timeDimension: { dimensionId: 13, granularity: 'quarter' },
    });

    expect(keys).toEqual(['c_orders.d11', 'c_orders.d13.quarter', 'c_orders.m21']);
    expect(columns.map((c) => c.label)).toEqual(['Khu vực', 'Ngày đặt (Quý)', 'Doanh thu']);
    expect(columns).toHaveLength(keys.length);
  });

  it('không khai chiều thời gian thì không có cột nào thêm vào', () => {
    const { columns, keys, query } = buildQuery(chiMuc(), {
      dimensionIds: [11],
      measureIds: [21],
    });

    expect(keys).toEqual(['c_orders.d11', 'c_orders.m21']);
    expect(columns).toHaveLength(2);
    expect(query.timeDimensions).toBeUndefined();
  });
});

/**
 * Đọc kết quả về: chịu được CẢ HAI cách Cube đặt tên cột thời gian.
 *
 * Hợp đồng REST của Cube trả chiều thời gian dưới khoá có hậu tố mức gom, và
 * `buildQuery` xin đúng khoá đó. Nhưng nhánh này chưa từng chạy với Cube thật
 * ở repo này, và cái giá của việc đoán sai là ÂM THẦM: `row[key]` ra
 * `undefined`, `toCell` biến thành `null`, bảng hiện "(trống)" ở mọi dòng.
 * Không lỗi, không cảnh báo, chỉ là một cột mất nhãn.
 *
 * Nên `runExplorerQuery` đọc được cả hai khoá. Hai bài dưới đây là hai câu trả
 * lời của Cube cho CÙNG một truy vấn; cả hai đều phải ra cùng một bảng.
 */
describe('Đọc cột thời gian từ kết quả Cube', () => {
  const CTX = { index: chiMuc(), schemaVersion: 'v1' };

  const TRUY_VAN = {
    dimensionIds: [],
    measureIds: [21],
    timeDimension: { dimensionId: 13, granularity: 'month' as const },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Cube trả khoá CÓ hậu tố mức gom', async () => {
    gia.loadFromCube.mockResolvedValue({
      data: [{ 'c_orders.d13.month': '2024-03-01T00:00:00.000', 'c_orders.m21': 1200 }],
    });

    const kq = await runExplorerQuery(1, 1, 1, TRUY_VAN, { ctx: CTX });

    expect(kq.rows).toEqual([['2024-03-01T00:00:00.000', 1200]]);
  });

  /** ⚠️ Nhánh dự phòng. Đỏ ở đây nghĩa là một cột thời gian sẽ hiện "(trống)". */
  it('Cube trả khoá KHÔNG hậu tố thì vẫn đọc được', async () => {
    gia.loadFromCube.mockResolvedValue({
      data: [{ 'c_orders.d13': '2024-03-01T00:00:00.000', 'c_orders.m21': 1200 }],
    });

    const kq = await runExplorerQuery(1, 1, 1, TRUY_VAN, { ctx: CTX });

    expect(kq.rows).toEqual([['2024-03-01T00:00:00.000', 1200]]);
  });

  /*
   * Nhánh dự phòng KHÔNG được biến một ô thiếu thành một ô bịa.
   *
   * Khoá chiều thường luôn kết thúc bằng `d<số>` nên phép cắt hậu tố không
   * khớp, và ô thiếu phải ra `(trống)` y như trước. Một ô trống nói đúng sự
   * thật; một ô mượn giá trị của cột khác thì ra số trông hợp lý.
   */
  it('chiều thường thiếu dữ liệu thì ra ô TRỐNG, không đi tìm khoá khác', async () => {
    gia.loadFromCube.mockResolvedValue({ data: [{ 'c_orders.m21': 1200 }] });

    const kq = await runExplorerQuery(
      1,
      1,
      1,
      { dimensionIds: [11], measureIds: [21] },
      { ctx: CTX },
    );

    expect(kq.rows).toEqual([[null, 1200]]);
  });
});
