import { describe, expect, it } from 'vitest';

import { parseCanvas } from '../src/repositories/reports';

/**
 * ĐỌC LẠI một khung đã lưu — và bộ này canh đúng một kiểu hỏng.
 *
 * ═══ "Lưu được, xem lại thì mất" ═══════════════════════════════════════════
 *
 * `parseCanvas` đọc cột JSON tự do bằng một DANH SÁCH TRẮNG. Trường nào quên
 * khai ở đó thì đường ghi vẫn nhận, MySQL vẫn giữ, và đường đọc lặng lẽ bỏ nó
 * đi. Hậu quả không trông như lỗi: biểu đồ vẫn vẽ, vẫn có số, chỉ là một con số
 * KHÁC — thường là lớn hơn, vì thứ bị mất là một điều kiện lọc.
 *
 * Đo được ngày 20/11/2026: lọc "Kênh bán = GrabFood" trong trình dựng (biểu đồ
 * đổi đúng), bấm Lưu, JSON trong MySQL có đủ điều kiện, mở trang xem thì hiện
 * lại tổng của toàn bộ dữ liệu. `measureAgg` đang hỏng y hệt và chưa ai gặp,
 * chỉ vì chưa báo cáo nào được lưu với một phép gộp chọn lại.
 *
 * Nên mỗi trường của `ReportModelConfigDto` đáng một ca ở đây.
 */

function khung(config: Record<string, unknown>): unknown {
  return {
    pages: [
      {
        id: 'p1',
        name: 'Trang 1',
        visuals: [{ id: 'o1', chartType: 'bar', config, x: 0, y: 0, w: 6, h: 7 }],
      },
    ],
  };
}

const TOI_THIEU = { dimensionId: 11, measureId: 21 };

/** Cấu hình của ô đầu tiên, sau một vòng đọc. */
function doc(config: Record<string, unknown>) {
  return parseCanvas(khung(config))?.pages[0]?.visuals[0]?.config;
}

describe('Điều kiện lọc sống sót qua một vòng lưu–đọc', () => {
  it('giữ nguyên từng trường của điều kiện', () => {
    const c = doc({
      ...TOI_THIEU,
      filters: [{ dimensionId: 2323, operator: 'equals', values: ['GrabFood'] }],
    });

    expect(c?.filters).toEqual([{ dimensionId: 2323, operator: 'equals', values: ['GrabFood'] }]);
  });

  it('nhiều điều kiện thì giữ đủ cả danh sách', () => {
    const c = doc({
      ...TOI_THIEU,
      filters: [
        { dimensionId: 1, operator: 'equals', values: ['A'] },
        { dimensionId: 2, operator: 'gte', values: ['2026-10-01'] },
      ],
    });

    expect(c?.filters).toHaveLength(2);
  });

  it('`set`/`notSet` không có giá trị vẫn hợp lệ', () => {
    const c = doc({ ...TOI_THIEU, filters: [{ dimensionId: 1, operator: 'notSet', values: [] }] });

    expect(c?.filters).toEqual([{ dimensionId: 1, operator: 'notSet', values: [] }]);
  });

  /*
   * Bỏ một điều kiện làm biểu đồ RỘNG ra chứ không hẹp lại — hiện nhiều dữ liệu
   * hơn người dùng đã chọn. Nên hình dạng lạ bị bỏ RIÊNG nó, và ca này nói rõ
   * là phần còn lại vẫn sống.
   */
  it('điều kiện hỏng bị bỏ riêng, không kéo theo cả ô', () => {
    const c = doc({
      ...TOI_THIEU,
      filters: [
        { dimensionId: 'không phải số', operator: 'equals', values: ['A'] },
        { dimensionId: 2, operator: 'toán tử lạ', values: ['B'] },
        { dimensionId: 3, operator: 'equals', values: [] },
        { dimensionId: 4, operator: 'equals', values: ['C'] },
      ],
    });

    expect(c?.filters).toEqual([{ dimensionId: 4, operator: 'equals', values: ['C'] }]);
  });

  it('không có điều kiện nào thì KHÔNG có trường `filters`', () => {
    expect(doc(TOI_THIEU)).not.toHaveProperty('filters');
  });
});

describe('Hai trường khác của cùng danh sách trắng', () => {
  it('`measureAgg` sống sót — một ô khai Trung bình phải vẽ ra Trung bình', () => {
    expect(doc({ ...TOI_THIEU, measureAgg: 'avg' })?.measureAgg).toBe('avg');
  });

  it('`measureAgg` lạ rơi về `null`, không làm hỏng ô', () => {
    const c = doc({ ...TOI_THIEU, measureAgg: 'trung bình cộng dồn' });

    expect(c).not.toBeUndefined();
    expect(c?.measureAgg).toBeNull();
  });

  it('`theoChieu` sống sót — trục thời gian phải giữ thứ tự thời gian', () => {
    expect(doc({ ...TOI_THIEU, theoChieu: 'asc' })?.theoChieu).toBe('asc');
  });

  it('`theoChieu` lạ thì vắng mặt', () => {
    expect(doc({ ...TOI_THIEU, theoChieu: 'ngược' })).not.toHaveProperty('theoChieu');
  });
});
