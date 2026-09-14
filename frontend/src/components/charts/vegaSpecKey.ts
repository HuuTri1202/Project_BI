import type { TopLevelSpec } from 'vega-lite';

/**
 * Hai phép thuần của `VegaChart` — §10.17.
 *
 * File RIÊNG, không nằm trong `VegaChart.tsx`: quy tắc `react-refresh` yêu cầu
 * một module chỉ xuất component thì mới thay nóng được. Trộn hàm thuần vào đó
 * làm cả file mất hot-reload — cùng lý do `canvasLayout.ts` tồn tại tách khỏi
 * `CanvasGrid`.
 *
 * Tách ra còn cho chúng một bộ test riêng, và chúng đáng có: chúng quyết định
 * một lần đổi là VẼ LẠI TỪ ĐẦU hay CẬP NHẬT TẠI CHỖ, mà sai theo hướng "vẽ lại"
 * thì không có gì đỏ ở đâu cả — chỉ là màn hình giật, đúng thứ §10.17 sinh ra
 * để dẹp.
 */

/**
 * Spec KHÔNG tính kích thước — chìa khoá để biết một lần đổi có cần dựng lại.
 *
 * Kéo tay nắm co giãn đổi `width`/`height` và KHÔNG đổi gì khác. So chuỗi này
 * là cách rẻ nhất nhận ra điều đó: spec của một biểu đồ chỉ vài trăm byte JSON,
 * và phép so chạy một lần cho mỗi lần render chứ không phải mỗi khung hình.
 *
 * ⚠️ `JSON.stringify` nhạy với THỨ TỰ KHOÁ, nên hai spec cùng nội dung mà khác
 * thứ tự sẽ ra hai chìa khác nhau. Không sao: `buildChartSpec` dựng spec theo
 * cùng một trình tự mỗi lần, nên thứ tự chỉ đổi khi chính mã nguồn đổi. Sai
 * theo hướng này cũng chỉ tốn một lần dựng lại thừa, không cho ra hình sai.
 */
export function khongKichThuoc(spec: TopLevelSpec): string {
  const { width: _w, height: _h, ...conLai } = spec as unknown as Record<string, unknown>;
  return JSON.stringify(conLai);
}

/**
 * `width`/`height` của spec, chỉ khi nó là SỐ.
 *
 * `null` cho `'container'` và cho khi spec không khai gì: ở đó vega-embed đang
 * tự đo thẻ bọc, và ghi đè bằng một con số là giẫm lên phép đo của nó.
 */
export function soDo(spec: TopLevelSpec, khoa: 'width' | 'height'): number | null {
  const v = (spec as unknown as Record<string, unknown>)[khoa];
  return typeof v === 'number' ? v : null;
}
