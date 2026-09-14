import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';

import { clampBox } from './visual';

/**
 * Phép tính của một cú kéo trên khung — §10.20. Hàm thuần, không DOM.
 *
 * Tách khỏi `CanvasBoard` vì từ §10.20 cú kéo có HAI lớp chạy song song: hộp đi
 * theo con trỏ từng pixel, và khung nét đứt nhảy theo ô lưới báo trước chỗ sẽ
 * đặt. Hai lớp đó phải đồng ý với nhau từng ô — lệch nhau là thả tay ra hộp rơi
 * vào một chỗ khác chỗ khung nét đứt vừa chỉ.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Phải khớp `gap` của `CanvasGrid` — hai số lệch nhau thì ô trôi dần khi kéo. */
export const CANVAS_GAP = 12;

/**
 * Bước lưới tính bằng pixel MÀN HÌNH — tức là đã nhân với mức thu phóng.
 *
 * `gridWidth` là bề rộng lưới đo trên màn hình (`getBoundingClientRect`), còn
 * `scale` là tỉ lệ giữa nó và bề rộng bố cục thật. Con trỏ chuột báo toạ độ
 * màn hình, nên mọi phép chia phải dùng bước màn hình — dùng bước bố cục ở mức
 * 50% thì kéo một ô đi được gấp đôi quãng con trỏ đi.
 */
export function gridPitch(gridWidth: number, scale: number): { x: number; y: number } {
  const gap = CANVAS_GAP * scale;
  const column = (gridWidth - gap * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS;
  // BƯỚC lưới, không phải bề rộng ô: hai ô cạnh nhau cách nhau một bề rộng CỘNG
  // một khoảng hở. Bỏ quên khoảng hở thì kéo ngang qua 12 cột lệch mất hơn một cột.
  return { x: column + gap, y: (CANVAS_ROW_HEIGHT + CANVAS_GAP) * scale };
}

/**
 * Ô lưới mà hộp sẽ rơi vào nếu thả tay ngay bây giờ.
 *
 * Kéo dời giữ nguyên cỡ và bị kẹp trong khung; co giãn giữ nguyên góc trên-trái,
 * nên bề rộng bị chặn bởi mép phải chứ không được đẩy hộp sang trái như
 * `clampBox` sẽ làm.
 */
export function snapBox(
  mode: 'move' | 'resize',
  start: Box,
  min: { w: number; h: number },
  dx: number,
  dy: number,
  pitch: { x: number; y: number },
): Box {
  const cols = Math.round(dx / pitch.x);
  const rows = Math.round(dy / pitch.y);

  if (mode === 'move') {
    return clampBox({ ...start, x: start.x + cols, y: start.y + rows }, min);
  }
  return {
    ...start,
    w: Math.min(Math.max(start.w + cols, min.w), CANVAS_COLUMNS - start.x),
    h: Math.max(start.h + rows, min.h),
  };
}

export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Bề rộng / cao bố cục (px) của `cells` ô lưới liền nhau. */
export function spanPx(cells: number, pitch: number): number {
  return cells * pitch - CANVAS_GAP;
}

/** Quãng dưới ngưỡng này là một cú BẤM run tay, không phải một cú kéo. */
export const DRAG_DEAD_ZONE_PX = 3;
