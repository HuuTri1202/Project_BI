import type { ReportModelConfigDto } from '@bi/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` được nâng lên TRƯỚC mọi import, nên import tĩnh ở đây vẫn nhận bản
// giả. `await import(...)` ở cấp cao nhất thì `tsc` từ chối dưới module CommonJS.
import { aggregateFromModel } from '../src/services/datamodel/modelReportData';

/**
 * Phép gộp chọn lại phải tới CẢ BỐN truy vấn của một biểu đồ — §10.22.
 *
 * ═══ Vì sao bài test này tồn tại ════════════════════════════════════════════
 *
 * Một biểu đồ có Nhóm màu chạy BA truy vấn (xếp hạng nhóm, xếp hạng chuỗi, rồi
 * truy vấn cuối lấy số); biểu đồ thường chạy một. Chỗ hỏng không phải "quên
 * hẳn" — quên hẳn thì số không đổi và ai cũng thấy. Chỗ hỏng là quên MỘT trong
 * ba:
 *
 *     xếp hạng nhóm tính bằng Tổng, còn cột vẽ ra là Trung bình
 *
 * Khi đó biểu đồ hiện đúng 20 cột, mỗi cột đúng một con số trung bình — nhưng
 * là trung bình của 20 nhóm CÓ TỔNG LỚN NHẤT, không phải 20 nhóm có trung bình
 * lớn nhất. Không có gì trên màn hình tố giác chuyện đó, và không ảnh chụp nào
 * bắt được.
 *
 * Nên bài này không nhìn màn hình: nó bắt `runExplorerQuery` và đọc từng câu
 * hỏi đi ra.
 */

const explorer = vi.hoisted(() => ({
  runExplorerQuery: vi.fn(),
  loadModelContext: vi.fn(),
}));

vi.mock('../src/services/datamodel/explorer', () => explorer);

/** Kết quả tối thiểu để `aggregateFromModel` chạy hết mà không cần Cube. */
function ketQua(nhan: string[]) {
  return {
    columns: [
      { id: 1, label: 'Category', kind: 'dimension' },
      { id: 2, label: 'Sales', kind: 'measure' },
    ],
    rows: nhan.map((n, i) => [n, i + 1]),
    truncated: false,
  };
}

const CTX = { moHinh: 'giả' } as never;

function cauHinh(p: Partial<ReportModelConfigDto> = {}): ReportModelConfigDto {
  return { dimensionId: 5, measureId: 10, limit: 20, ...p };
}

/** Mọi `measureAggs` đã đi ra, mỗi lời gọi một phần tử. */
const daGui = (): unknown[] => explorer.runExplorerQuery.mock.calls.map((c) => c[3]?.measureAggs);

beforeEach(() => {
  vi.clearAllMocks();
  explorer.runExplorerQuery.mockResolvedValue(ketQua(['A', 'B', 'C']));
});

describe('biểu đồ MỘT chuỗi', () => {
  it('không chọn phép -> không gửi gì, truy vấn y như trước', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh(), 0, CTX);
    expect(daGui()).toEqual([undefined]);
  });

  it('chọn phép -> gửi đúng thước đo và đúng phép', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh({ measureAgg: 'avg' }), 0, CTX);
    expect(daGui()).toEqual([[{ id: 10, agg: 'avg' }]]);
  });

  it('`null` được coi như không chọn — trình dựng gửi null khi gỡ lựa chọn', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh({ measureAgg: null }), 0, CTX);
    expect(daGui()).toEqual([undefined]);
  });
});

describe('biểu đồ có NHÓM MÀU — ba truy vấn, cả ba phải mang theo', () => {
  it('cả ba lời gọi đều nhận cùng một phép gộp', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh({ seriesDimensionId: 7, measureAgg: 'avg' }), 0, CTX);

    const gui = daGui();
    expect(gui).toHaveLength(3);
    // Đây là điều bài test bảo vệ: KHÔNG lời gọi nào bị bỏ sót. Thiếu một cái
    // thì bảng xếp hạng và các cột được tính bằng hai phép khác nhau.
    for (const g of gui) expect(g).toEqual([{ id: 10, agg: 'avg' }]);
  });

  it('không chọn phép thì cả ba đều để trống', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh({ seriesDimensionId: 7 }), 0, CTX);
    expect(daGui()).toEqual([undefined, undefined, undefined]);
  });
});
