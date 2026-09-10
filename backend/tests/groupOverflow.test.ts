import { describe, expect, it } from 'vitest';

import { overflowOf } from '../src/services/datamodel/modelReportData';
import type { ModelContext } from '../src/services/datamodel/explorer';
import type { MeasureAgg, MeasureSourceDto, ReportModelConfigDto } from '@bi/shared';

/**
 * Phần vượt trần đi đâu — §10.14.
 *
 * ═══ Vì sao khối này là test ĐƠN VỊ, không phải test tích hợp ════════════════
 *
 * Luật ở đây quyết định dựa trên ĐỊNH NGHĨA của thước đo, không dựa trên dữ
 * liệu. Một ca tích hợp muốn chứng minh "trung bình thì chia trang" phải có một
 * bảng ClickHouse thật với nhiều hơn `limit` nhóm — mà `makeLoadedDataset` chỉ
 * chèn một dòng MySQL, phía sau nó không có bảng nào. Ca như vậy sẽ xanh vì môi
 * trường chứ không vì luật.
 *
 * Vòng đi trọn của `overflow` qua lưu/đọc đã có `§10.12` trong
 * `datamodel.integration.test.ts` lo. Ở đây chỉ khoá đúng câu quyết định.
 *
 * ═══ Điều được khoá ═════════════════════════════════════════════════════════
 *
 *     cộng được   -> gộp phần vượt thành cột "Khác"
 *     không cộng  -> CHIA TRANG
 *
 * Vế thứ hai là thứ §10.14 thêm vào. Trước đó phần vượt của một thước đo không
 * cộng được bị BỎ HẲN khỏi biểu đồ kèm một dòng chữ — người dùng thấy dữ liệu
 * mất mà không có đường nào tới nó.
 */

/** Một ngữ cảnh mô hình chỉ có đúng thứ `overflowOf` đọc tới. */
function ctxVoi(agg: MeasureAgg, kind: MeasureSourceDto['kind']): ModelContext {
  const nguon = { kind, expr: kind === 'rows' ? null : 'x' } as MeasureSourceDto;
  return {
    schemaVersion: '1',
    index: {
      columns: new Map(),
      measures: new Map([
        [
          7,
          {
            cubeName: 'dm1_ds1',
            label: 'Thước đo',
            datasetName: 'bang',
            format: 'number' as const,
            agg,
            availableAggs: [],
            nguon,
          },
        ],
      ]),
    },
  } as unknown as ModelContext;
}

const cauHinh = (overflow?: 'other' | 'pages'): ReportModelConfigDto =>
  ({
    dimensionId: 1,
    measureId: 7,
    limit: 20,
    ...(overflow ? { overflow } : {}),
  }) as ReportModelConfigDto;

describe('overflowOf — "Khác" khi cộng được, chia trang khi không', () => {
  /*
   * Bảng thay cho tám hàm `it`: mỗi dòng là một phép gộp, và thêm một phép mới
   * mà quên nghĩ tới chuyện này sẽ lộ ra ở đây chứ không lộ ra trên máy người
   * dùng.
   */
  const BANG: [MeasureAgg, MeasureSourceDto['kind'], boolean, string][] = [
    ['sum', 'column', true, 'tổng cộng được — giữ cột "Khác"'],
    ['count', 'column', true, 'đếm cộng được'],
    ['count', 'rows', true, 'đếm số dòng: tổng của các phần đếm chính là phần đếm của tổng'],
    ['avg', 'column', false, 'trung bình của các trung bình KHÔNG phải trung bình'],
    ['min', 'column', false, '"Khác" của min thì vô nghĩa'],
    ['max', 'column', false, '"Khác" của max thì vô nghĩa'],
    ['sum', 'formula', false, 'thước đo tính toán: tổng của các tỉ lệ không phải một tỉ lệ'],
    [
      'sum',
      'rowExpr',
      false,
      'giữ NGUYÊN ranh giới cũ — đổi là mọi báo cáo đang dùng nó mọc thêm một cột',
    ],
  ];

  for (const [agg, kind, congDuoc, vi] of BANG) {
    it(`${agg} trên ${kind}: ${congDuoc ? 'gộp "Khác"' : 'chia trang'} — ${vi}`, () => {
      const ket = overflowOf(ctxVoi(agg, kind), cauHinh(), false);
      expect(ket.additive).toBe(congDuoc);
      // Hai vế luôn ngược nhau: cộng được thì không chia trang, và ngược lại.
      expect(ket.paged).toBe(!congDuoc);
    });
  }

  it('chọn TAY "luôn chia trang" thắng cả thước đo cộng được', () => {
    // Ô chọn phải có tác dụng. Người dùng chọn chia trang trên một thước đo
    // tổng là đang nói "tôi muốn xem hết", không phải "tôi muốn một cột Khác".
    const ket = overflowOf(ctxVoi('sum', 'column'), cauHinh('pages'), false);
    expect(ket.paged).toBe(true);
    expect(ket.additive).toBe(false);
  });

  it('có chiều thứ hai thì LUÔN chia trang, kể cả với tổng', () => {
    // Nhánh hai chiều không bao giờ dựng được cột "Khác": phần bị cắt là một
    // mặt phẳng, chia nó cho từng chuỗi là bịa ra số. Nên lựa chọn còn lại chỉ
    // là bỏ dữ liệu hoặc mở đường tới nó.
    const ket = overflowOf(ctxVoi('sum', 'column'), cauHinh(), true);
    expect(ket.paged).toBe(true);
    expect(ket.additive).toBe(false);
  });

  it('thước đo đã bị xoá KHÔNG được coi là cộng được', () => {
    // Một báo cáo trỏ vào thước đo vừa bị đồng nghiệp xoá. Đoán "cộng được" ở
    // đây sẽ hỏi một truy vấn tổng cho một thước đo không tồn tại.
    const ctx = ctxVoi('sum', 'column');
    const ket = overflowOf(ctx, { ...cauHinh(), measureId: 999 } as ReportModelConfigDto, false);
    expect(ket.additive).toBe(false);
    expect(ket.paged).toBe(true);
  });
});
