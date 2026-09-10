import type { TopLevelSpec } from 'vega-lite';
import { describe, expect, it } from 'vitest';

import { khongKichThuoc, soDo } from '../src/components/charts/vegaSpecKey';

/**
 * Cái quyết định "vẽ lại từ đầu" hay "cập nhật tại chỗ" — §10.17.
 *
 * ═══ Vì sao hai hàm bé tí này đáng một file test ════════════════════════════
 *
 * Sai ở đây không đỏ ở đâu cả, và hỏng theo HAI hướng ngược nhau:
 *
 *   quá NHẠY   chìa khoá đổi khi chỉ có kích thước đổi -> mỗi nhịp kéo co giãn
 *              là một lần dựng lại view, tức đúng cái chớp trắng 7–22ms mà
 *              người dùng gọi là "giật màn hình".
 *
 *   quá TRƠ    chìa khoá KHÔNG đổi khi cấu trúc đổi -> đổi bảng màu hay đổi
 *              cách sắp mà biểu đồ đứng yên. Không lỗi, không request, chỉ là
 *              một ô chọn không làm gì.
 *
 * Hướng thứ hai nguy hiểm hơn nhiều, nên phần lớn ca dưới đây khoá nó.
 */

const NEN = {
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: { values: [] },
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'label', type: 'nominal', title: 'Khu vực' },
    y: { field: 'value', type: 'quantitative', title: 'Doanh thu' },
  },
} as unknown as TopLevelSpec;

const voi = (them: Record<string, unknown>): TopLevelSpec =>
  ({ ...(NEN as unknown as Record<string, unknown>), ...them }) as unknown as TopLevelSpec;

describe('khongKichThuoc', () => {
  it('CHỈ khác kích thước thì cùng một chìa — kéo co giãn không dựng lại view', () => {
    const a = voi({ width: 870, height: 333 });
    const b = voi({ width: 195, height: 109 });

    expect(khongKichThuoc(a)).toBe(khongKichThuoc(b));
  });

  it('có khai kích thước hay không cũng cùng một chìa', () => {
    // Khung hình đầu tiên chưa đo được nên spec vắng hẳn hai khoá đó. Đo xong
    // mà chìa đổi thì mọi biểu đồ dựng lại đúng một lần ngay lúc mở trang.
    expect(khongKichThuoc(voi({}))).toBe(khongKichThuoc(voi({ width: 400, height: 300 })));
  });

  it('đổi BẢNG MÀU thì chìa PHẢI đổi', () => {
    // Màu nằm trong `scale.range` của spec; Vega không có setter lúc chạy cho
    // nó, nên đây là ca bắt buộc dựng lại.
    const a = voi({ encoding: { color: { scale: { range: ['#118DFF'] } } } });
    const b = voi({ encoding: { color: { scale: { range: ['#2E69B2'] } } } });

    expect(khongKichThuoc(a)).not.toBe(khongKichThuoc(b));
  });

  it('đổi CÁCH SẮP, đổi LOẠI MARK, bỏ TÊN TRỤC — chìa đều đổi', () => {
    const goc = khongKichThuoc(NEN);

    expect(khongKichThuoc(voi({ mark: { type: 'line' } }))).not.toBe(goc);
    expect(
      khongKichThuoc(
        voi({
          encoding: {
            x: { field: 'label', type: 'nominal', title: 'Khu vực', sort: 'ascending' },
            y: { field: 'value', type: 'quantitative', title: 'Doanh thu' },
          },
        }),
      ),
    ).not.toBe(goc);
    // Bậc rút gọn của §10.16: ô nhỏ thì tên trục thành `null`.
    expect(
      khongKichThuoc(
        voi({
          encoding: {
            x: { field: 'label', type: 'nominal', title: null },
            y: { field: 'value', type: 'quantitative', title: 'Doanh thu' },
          },
        }),
      ),
    ).not.toBe(goc);
  });

  it('KHÔNG đọc tới số liệu — số liệu đi đường riêng', () => {
    /*
     * `VegaChart` ghi đè khoá `data` lúc embed, nên spec luôn mang một mảng
     * rỗng. Nếu chìa khoá lỡ đọc số liệu thật thì mỗi lần Cube trả lời là một
     * lần dựng lại — đúng thứ vừa bỏ đi.
     */
    const a = voi({ data: { values: [] } });
    const b = voi({ data: { values: [] } });

    expect(khongKichThuoc(a)).toBe(khongKichThuoc(b));
  });
});

describe('soDo', () => {
  it('trả về SỐ để đẩy vào view đang sống', () => {
    const spec = voi({ width: 420, height: 300 });

    expect(soDo(spec, 'width')).toBe(420);
    expect(soDo(spec, 'height')).toBe(300);
  });

  it('`container` và vắng mặt đều là `null` — để vega-embed tự đo', () => {
    // Trang xem một biểu đồ vẫn dùng `'container'`. Ghi đè bằng một con số ở đó
    // là giẫm lên phép đo của vega-embed.
    expect(soDo(voi({ width: 'container' }), 'width')).toBeNull();
    expect(soDo(voi({}), 'height')).toBeNull();
    // Thanh ngang ở chế độ cũ khai `height: { step: 24 }` — không phải số.
    expect(soDo(voi({ height: { step: 24 } }), 'height')).toBeNull();
  });
});
