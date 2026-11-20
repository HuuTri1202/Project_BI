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

/**
 * Ngữ cảnh mô hình tối thiểu — `aggregateFromModel` tra kiểu cột ở đây để biết
 * chiều nào là THỜI GIAN (xem `nhanCua`). Không khai thì nó coi mọi chiều là
 * chữ, đúng thứ phần lớn ca ở đây cần.
 */
function ctxVoiCot(cot: Record<number, string> = {}): never {
  return {
    index: {
      columns: new Map(
        Object.entries(cot).map(([id, chType]) => [
          Number(id),
          { chType, label: '', cubeName: 'c', datasetName: 'd' },
        ]),
      ),
    },
    schemaVersion: 'v1',
  } as never;
}

const CTX = ctxVoiCot();

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

describe('Chiều THỜI GIAN: nhãn phải đọc được, không phải dấu thời gian máy', () => {
  /*
   * Đo được ngày 20/11/2026 trên một báo cáo thật: trục ngang của biểu đồ
   * đường là hai mươi chuỗi `2026-08-04T00:00:00.000` xoay dọc 90°. Cùng chuỗi
   * ấy đi vào tệp Excel, trang chia sẻ công khai và câu trả lời của khung hỏi
   * đáp — bốn mặt, một nguồn.
   *
   * `5` là `dimensionId` mà `cauHinh()` dùng.
   */
  it('nhãn chiều ngày thành dd/mm/yyyy', async () => {
    explorer.runExplorerQuery.mockResolvedValue(
      ketQua(['2026-08-04T00:00:00.000', '2026-08-07T00:00:00.000']),
    );

    const kq = await aggregateFromModel(
      1,
      1,
      9,
      cauHinh(),
      0,
      ctxVoiCot({ 5: "DateTime64(3, 'UTC')" }),
    );

    expect(kq.rows.map((r) => r.label)).toEqual(['04/08/2026', '07/08/2026']);
  });

  /*
   * ĐỐI CHỨNG — cột CHỮ không được đụng vào. Thiếu ca này thì một bản cài đặt
   * "cứ thấy chuỗi giống ngày thì đổi" vẫn xanh, và một mã đơn hàng dạng
   * `2026-08-04` sẽ bị viết lại thành `04/08/2026`.
   */
  it('cột chữ giữ nguyên từng ký tự', async () => {
    explorer.runExplorerQuery.mockResolvedValue(ketQua(['2026-08-04T00:00:00.000']));

    const kq = await aggregateFromModel(1, 1, 9, cauHinh(), 0, ctxVoiCot({ 5: 'String' }));

    expect(kq.rows[0]?.label).toBe('2026-08-04T00:00:00.000');
  });

  it('chiều NHÓM MÀU cũng đi qua cùng luật', async () => {
    // Nhánh nhiều chuỗi đọc BA cột, khác `ketQua` ở trên.
    explorer.runExplorerQuery.mockResolvedValue({
      columns: [
        { id: 5, label: 'Khu vực', kind: 'dimension' },
        { id: 7, label: 'Ngày bán', kind: 'dimension' },
        { id: 10, label: 'Doanh thu', kind: 'measure' },
      ],
      rows: [
        ['Miền Bắc', '2026-08-04T00:00:00.000', 10],
        ['Miền Nam', '2026-08-07T00:00:00.000', 20],
      ],
      truncated: false,
    });

    const kq = await aggregateFromModel(
      1,
      1,
      9,
      cauHinh({ seriesDimensionId: 7 }),
      0,
      ctxVoiCot({ 5: 'String', 7: 'Date' }),
    );

    expect(kq.rows.map((r) => r.series)).toEqual(['04/08/2026', '07/08/2026']);
    // Chiều nhóm là CHỮ nên không được đụng vào.
    expect(kq.rows.map((r) => r.label)).toEqual(['Miền Bắc', 'Miền Nam']);
  });
});

describe('Trục THỜI GIAN: câu hỏi gửi đi phải sắp theo chiều', () => {
  /** Mọi `options` đã đi ra, mỗi lời gọi một phần tử. */
  const tuyChon = (): Record<string, unknown>[] =>
    explorer.runExplorerQuery.mock.calls.map((c) => c[4] as Record<string, unknown>);

  it('`theoChieu` đi thẳng vào truy vấn', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh({ theoChieu: 'asc' }), 0, CTX);

    expect(tuyChon()[0]?.theoChieu).toBe('asc');
  });

  it('không khai thì KHÔNG gửi gì — truy vấn y như trước', async () => {
    await aggregateFromModel(1, 1, 9, cauHinh(), 0, CTX);

    expect(tuyChon()[0]).not.toHaveProperty('theoChieu');
  });

  /*
   * `pick: 'bottom'` nói "lấy các nhóm NHỎ NHẤT theo thước đo" — một câu hỏi về
   * thước đo. Sắp theo thời gian thì câu ấy không còn nghĩa, và quan trọng hơn:
   * phép ĐẢO MẢNG mà `bottom` kéo theo sẽ lật ngược trục thời gian.
   */
  it('sắp theo chiều thì `bottom` thôi đảo ngược kết quả', async () => {
    explorer.runExplorerQuery.mockResolvedValue(ketQua(['A', 'B', 'C']));

    const kq = await aggregateFromModel(
      1,
      1,
      9,
      cauHinh({ theoChieu: 'asc', pick: 'bottom' }),
      0,
      CTX,
    );

    expect(kq.rows.map((r) => r.label)).toEqual(['A', 'B', 'C']);
    expect(tuyChon()[0]).not.toHaveProperty('order');
  });

  it('đối chứng: KHÔNG sắp theo chiều thì `bottom` vẫn đảo như cũ', async () => {
    explorer.runExplorerQuery.mockResolvedValue(ketQua(['A', 'B', 'C']));

    const kq = await aggregateFromModel(1, 1, 9, cauHinh({ pick: 'bottom' }), 0, CTX);

    expect(kq.rows.map((r) => r.label)).toEqual(['C', 'B', 'A']);
    expect(tuyChon()[0]?.order).toBe('asc');
  });

  /*
   * Trình vẽ phải BIẾT là máy chủ đã sắp, nếu không nó sắp lại nhãn
   * `04/08/2026` theo bảng chữ cái và 01/09 nhảy lên trước 04/08.
   */
  it('trả lại cờ `theoChieu` cho trình vẽ', async () => {
    const kq = await aggregateFromModel(1, 1, 9, cauHinh({ theoChieu: 'asc' }), 0, CTX);

    expect(kq.theoChieu).toBe('asc');
  });
});
