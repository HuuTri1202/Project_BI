/**
 * Cầu nối giữa bảng màu Tailwind và Vega.
 *
 * Tailwind v4 khai `@theme` bằng CSS custom property THẬT trên `:root`, nên đọc
 * được lúc chạy. Giá trị là chuỗi `oklch(...)`; Vega ghi thẳng nó vào thuộc tính
 * `fill` của SVG và trình duyệt tự phân giải — mọi trình duyệt chạy được
 * Tailwind v4 đều hiểu `oklch()`.
 *
 * Nhờ vậy đổi tông màu ở `index.css` là biểu đồ đổi theo. Nếu hard-code mã hex ở
 * đây thì đổi màu thương hiệu sẽ phải sửa hai nơi, và nơi thứ hai chắc chắn bị
 * quên.
 *
 * `fallback` không phải để cho có: hàm này chạy cả trong test (jsdom trả chuỗi
 * rỗng cho custom property chưa được khai) và sẽ chạy trong SSR nếu sau này có.
 */
export function readBrandColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

/** Màu trục, lưới, nhãn — dùng chung để hai biểu đồ trông cùng một bộ. */
export const CHART_AXIS_CONFIG = {
  labelColor: '#64748b',
  gridColor: '#e2e8f0',
  domainColor: '#e2e8f0',
  tickColor: '#e2e8f0',
} as const;
