import type { MeasureSourceDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { buildQuery, type ModelIndex } from '../src/services/datamodel/explorer';

/**
 * Sắp theo CHÍNH CHIỀU thay vì theo thước đo — §A4.
 *
 * ═══ Lỗi bộ này canh ═══════════════════════════════════════════════════════
 *
 * Thả "Ngày bán" vào một biểu đồ: Cube được hỏi "hai mươi dòng có thước đo lớn
 * nhất", rồi trục ngang xếp lại hai mươi dòng ấy theo tên. Ra một đường nối hai
 * mươi ngày RỜI RẠC rút từ ba tháng — một hình có dáng xu hướng mà không phải
 * xu hướng. Lật sang trang 2 thì nhận hai mươi ngày lớn kế tiếp, cũng rời rạc.
 *
 * Chỗ duy nhất chữa được là CÂU HỎI gửi đi, nên bộ này đọc đúng câu hỏi đó.
 */

const NGUON: MeasureSourceDto = { kind: 'column', text: 'amount' } as unknown as MeasureSourceDto;

function chiMuc(): ModelIndex {
  return {
    columns: new Map([
      [11, { cubeName: 'c_orders', label: 'Khu vực', chType: 'String', datasetName: 'Orders' }],
      [
        12,
        {
          cubeName: 'c_orders',
          label: 'Ngày bán',
          chType: "DateTime64(3, 'UTC')",
          datasetName: 'Orders',
        },
      ],
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

const HOI = { dimensionIds: [12], measureIds: [21] };

describe('buildQuery — thứ tự của câu hỏi gửi xuống Cube', () => {
  it('mặc định vẫn sắp theo THƯỚC ĐO, giảm dần', () => {
    const { query } = buildQuery(chiMuc(), HOI);

    expect(query.order).toEqual({ 'c_orders.m21': 'desc' });
  });

  it('`theoChieu` đổi sang sắp theo CHIỀU', () => {
    const { query } = buildQuery(chiMuc(), HOI, { theoChieu: 'asc' });

    expect(query.order).toEqual({ 'c_orders.d12': 'asc' });
  });

  it('chiều mới → cũ', () => {
    const { query } = buildQuery(chiMuc(), HOI, { theoChieu: 'desc' });

    expect(query.order).toEqual({ 'c_orders.d12': 'desc' });
  });

  /*
   * `theoChieu` THẮNG `order`.
   *
   * Hai trường cùng nói về thứ tự nên phải có một cái nhường. `order` chỉ tồn
   * tại cho "lấy các nhóm NHỎ NHẤT" — một câu hỏi về thước đo — nên khi người
   * dùng đã nói "sắp theo thời gian" thì câu kia không còn nghĩa gì.
   */
  it('`theoChieu` thắng `order` khi cả hai cùng có mặt', () => {
    const { query } = buildQuery(chiMuc(), HOI, { theoChieu: 'asc', order: 'asc' });

    expect(query.order).toEqual({ 'c_orders.d12': 'asc' });
  });

  /*
   * Chia trang vẫn là chia trang — `offset` không được đổi nghĩa.
   *
   * Đây là nửa còn lại của bản vá: sắp theo thời gian mà `offset` bị bỏ thì
   * trang 2 lại về đúng hai mươi mốc đầu.
   */
  it('vẫn mang theo offset của trang', () => {
    const { query } = buildQuery(chiMuc(), HOI, { theoChieu: 'asc', offset: 40 });

    expect(query.offset).toBe(40);
    expect(query.order).toEqual({ 'c_orders.d12': 'asc' });
  });
});
