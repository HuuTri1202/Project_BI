import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import {
  annotationStyle,
  cellStyle,
  rowsNeeded,
  CANVAS_GAP,
} from '../src/features/reports/canvasLayout';
import { freeBox, gridPitch, snapBox } from '../src/features/reports/builder/dragMath';

/**
 * Chú thích đặt được ở MỌI vị trí, không bám lưới — §10.24.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Đo trên Chromium trước khi sửa: kéo một đường kẻ dọc 40px thì nó đứng yên
 * hoàn toàn, kéo 60px thì nó nhảy 83px. Một bước lưới là 83px ngang và 56px
 * dọc, nên không có cách nào đặt đường kẻ vào khe giữa hai biểu đồ.
 *
 * Ba chỗ hỏng được canh ở đây, và cả ba đều hỏng ÂM THẦM:
 *
 *   1. Công thức đặt chú thích lệch khỏi công thức của lưới. Chú thích cũ (toạ
 *      độ nguyên) phải nằm ĐÚNG chỗ cũ, từng pixel — lệch thì mọi báo cáo đã
 *      lưu đều xô lệch một chút mà không ai báo gì.
 *   2. Biểu đồ mất bám lưới theo. Lưới là thứ làm mười hai biểu đồ thẳng hàng
 *      với nhau; bỏ nó thì báo cáo đọc như một bàn giấy bừa.
 *   3. Phép kéo tự do làm tròn quá thô, hoặc không làm tròn gì và ghi xuống
 *      JSON những con số 17 chữ số.
 */

const BUOC_HANG = CANVAS_ROW_HEIGHT + CANVAS_GAP;

describe('annotationStyle — cùng chỗ với lưới, nhưng nhận số thực', () => {
  it('toạ độ NGUYÊN rơi đúng chỗ lưới sẽ đặt', () => {
    // Cột 0 bắt đầu ở mép trái, và 12 cột phủ đúng 100% — hai mốc này khoá
    // công thức lại: sai một chút ở hệ số là một trong hai mốc lệch ngay.
    const goc = annotationStyle({ x: 0, y: 0, w: 12, h: 1 });
    expect(goc.left).toBe('calc(((100% - 132px) / 12) * 0 + 0px)');
    expect(goc.width).toBe('calc(((100% - 132px) / 12) * 12 + 132px)');
    expect(goc.top).toBe('0px');
    expect(goc.height).toBe(`${BUOC_HANG - CANVAS_GAP}px`);
  });

  it('hàng thứ y bắt đầu đúng chỗ hàng lưới thứ y', () => {
    // Hàng 10 của lưới nằm ở 10 × (44 + 12) = 560px. Đây là con số duy nhất
    // nối chú thích tuyệt đối với các ô lưới quanh nó.
    expect(annotationStyle({ x: 0, y: 10, w: 1, h: 1 }).top).toBe('560px');
    expect(annotationStyle({ x: 0, y: 0, w: 1, h: 6 }).height).toBe(`${6 * BUOC_HANG - 12}px`);
  });

  it('nhận toạ độ THỰC — đây là cả điểm của §10.24', () => {
    const o = annotationStyle({ x: 3.42, y: 2.5, w: 1.5, h: 1.25 });
    expect(o.left).toBe('calc(((100% - 132px) / 12) * 3.42 + 41.04px)');
    expect(o.top).toBe(`${2.5 * BUOC_HANG}px`);
    expect(o.height).toBe(`${1.25 * BUOC_HANG - CANVAS_GAP}px`);
  });

  it('định vị TUYỆT ĐỐI, không phải ô lưới — lưới không đặt được số thực', () => {
    const o = annotationStyle({ x: 1, y: 1, w: 1, h: 1 });
    expect(o.position).toBe('absolute');
    expect(o).not.toHaveProperty('gridColumn');
    // Biểu đồ thì vẫn là ô lưới, và phải giữ nguyên như vậy.
    expect(cellStyle({ x: 1, y: 1, w: 1, h: 1 }).gridColumn).toBe('2 / span 1');
  });
});

describe('rowsNeeded — chừa đủ chỗ cho toạ độ thực', () => {
  it('làm TRÒN LÊN: một mũi tên kết thúc ở hàng 9,3 cần đủ 10 hàng', () => {
    // Thiếu bước này thì khung cao 9 hàng, và ba phần mười hàng cuối của mũi
    // tên nằm ngoài vùng cuộn — không cuộn tới được, không xuất ảnh được.
    expect(rowsNeeded([{ y: 8.3, h: 1 }])).toBe(10);
    expect(rowsNeeded([{ y: 2.5, h: 1.25 }])).toBe(8); // vẫn dưới sàn 8 hàng
  });

  it('toạ độ nguyên cho ra đúng con số cũ', () => {
    expect(rowsNeeded([{ y: 10, h: 1 }])).toBe(11);
    expect(rowsNeeded([])).toBe(8);
  });
});

describe('freeBox — kéo tới đâu nằm tới đó', () => {
  const start = { x: 2, y: 3, w: 4, h: 2 };
  const min = { w: 1, h: 1 };
  const pitch = gridPitch(1200, 1);

  it('quãng NHỎ hơn nửa bước vẫn dịch — chỗ `snapBox` đứng im', () => {
    // 20px là chưa tới một phần tư bước cột (≈101px). Bám lưới thì nó là 0.
    expect(snapBox('move', start, min, 20, 0, pitch).x).toBe(start.x);
    expect(freeBox('move', start, min, 20, 0, pitch).x).toBeCloseTo(start.x + 20 / pitch.x, 3);
  });

  it('dịch đúng TỈ LỆ với quãng con trỏ đi, không nhảy bậc', () => {
    const buoc = [10, 20, 40, 80].map(
      (dx) => freeBox('move', start, min, dx, 0, pitch).x - start.x,
    );
    // Bốn quãng gấp đôi nhau liên tiếp phải cho bốn kết quả gấp đôi nhau.
    expect(buoc[1] / (buoc[0] as number)).toBeCloseTo(2, 3);
    expect(buoc[2] / (buoc[1] as number)).toBeCloseTo(2, 3);
    expect(buoc[3] / (buoc[2] as number)).toBeCloseTo(2, 3);
  });

  it('làm tròn ba chữ số — đủ mịn, mà JSON vẫn đọc được bằng mắt', () => {
    const b = freeBox('move', start, min, 37, 19, pitch);
    expect(String(b.x)).toMatch(/^\d+(\.\d{1,3})?$/);
    expect(String(b.y)).toMatch(/^\d+(\.\d{1,3})?$/);
  });

  it('vẫn bị kẹp trong khung: không trôi ra ngoài mép trái hay mép phải', () => {
    expect(freeBox('move', start, min, -10_000, 0, pitch).x).toBe(0);
    expect(freeBox('move', start, min, 10_000, 0, pitch).x).toBe(CANVAS_COLUMNS - start.w);
    // Lên trên hàng đầu cũng không.
    expect(freeBox('move', start, min, 0, -10_000, pitch).y).toBe(0);
  });

  it('co giãn cũng tự do, và vẫn không nhỏ hơn cỡ tối thiểu', () => {
    expect(freeBox('resize', start, min, 30, 0, pitch).w).toBeCloseTo(start.w + 30 / pitch.x, 3);
    expect(freeBox('resize', start, min, -10_000, -10_000, pitch)).toMatchObject({ w: 1, h: 1 });
  });

  it('biểu đồ vẫn đi đường CŨ — `snapBox` không đổi một chút nào', () => {
    // Nửa bước là ngưỡng làm tròn: dưới thì đứng yên, trên thì nhảy nguyên ô.
    expect(snapBox('move', start, min, pitch.x * 0.49, 0, pitch).x).toBe(2);
    expect(snapBox('move', start, min, pitch.x * 0.51, 0, pitch).x).toBe(3);
  });
});
