/**
 * Hàm biểu thức riêng mà spec của ta được phép gọi bên trong Vega — §10.22.
 *
 * File RIÊNG, không nằm trong `VegaChart.tsx`: cùng lý do `vegaSpecKey.ts` —
 * một module chỉ xuất component thì mới giữ được hot-reload. Và `chartSpec.ts`
 * chỉ cần TÊN hàm, nên nó import một hằng chuỗi chứ không kéo `vega` vào gói
 * tải đầu (xem chú thích nạp động ở `VegaChart`).
 *
 * ⚠️ Spec nào gọi một hàm ở đây thì CHỈ vẽ được qua `VegaChart`, nơi đăng ký
 * chúng lúc embed. Parse ở chỗ khác mà quên đăng ký thì Vega ném lỗi
 * "Unrecognized function" — `tests/axisLabels.test.ts` đăng ký đúng như vậy.
 */

/** Tên hàm đo độ rộng nhãn dài nhất — xem `nhanTrucNhom` trong `chartSpec.ts`. */
export const HAM_DO_RONG_NHAN = 'doRongNhanToiDa';

/** Đúng phần `vega.textMetrics` mà hàm đo cần. */
export interface DoChu {
  width: (item: { font: string; fontSize: number }, text: string) => number;
}

/**
 * Map đưa thẳng vào `expressionFunctions` của vega-embed.
 *
 * Đo bằng CHÍNH `textMetrics` của Vega chứ không tự dựng một canvas: đó là phép
 * đo Vega dùng để cắt nhãn theo `labelLimit` và để xếp chỗ khi vẽ, nên con số
 * dùng để QUYẾT ĐỊNH hướng nhãn không thể lệch khỏi con số dùng để VẼ nó. Có
 * canvas (trình duyệt) thì đo thật; không có (test chạy Node) thì Vega tự ước
 * lượng rộng tay hơn — sai theo hướng dựng đứng nhãn sớm, không bao giờ theo
 * hướng để nhãn đè lên nhau.
 */
export function hamBieuThucVega(doChu: DoChu): Record<string, (...args: never[]) => number> {
  return {
    [HAM_DO_RONG_NHAN]: (values: unknown, fontSize: number, font: string): number => {
      if (!Array.isArray(values)) return 0;
      let max = 0;
      for (const v of values) {
        max = Math.max(max, doChu.width({ font, fontSize }, String(v ?? '')));
      }
      return max;
    },
  };
}
