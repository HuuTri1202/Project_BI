/**
 * Mức thu phóng khung soạn thảo — §10.20.
 *
 * Bậc cố định chứ không phải thanh trượt: người sắp xếp một báo cáo muốn "nhìn
 * cả trang" hoặc "nhìn cho rõ", không muốn 83%. Bậc cố định còn làm nút phóng
 * to rồi thu nhỏ quay về ĐÚNG mức cũ.
 */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export const ZOOM_MIN = ZOOM_LEVELS[0];
export const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] as number;

/** Bậc kế tiếp theo hướng `direction`; mức lạ (từ bản cũ) rơi về bậc gần nhất. */
export function zoomStep(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_LEVELS.find((z) => z > current + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_LEVELS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_MIN;
}

const STORAGE_KEY = 'bi.builder.zoom';

/**
 * Nhớ theo trình duyệt, cùng lý do với cột bên gấp lại (§10.15): đây là sở thích
 * của người đang ngồi trước màn hình, không thuộc về báo cáo — lưu vào báo cáo
 * thì đồng nghiệp mở ra thấy khung bị thu nhỏ theo màn hình của người khác.
 */
export function readZoom(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return (ZOOM_LEVELS as readonly number[]).includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

export function writeZoom(zoom: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(zoom));
  } catch {
    // Không nhớ được thì lần sau về 100%. Không đáng chặn thao tác.
  }
}
