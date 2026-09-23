import type { ReportDataDto } from '@bi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as chup from '../src/features/reports/export/chupBaoCao';
import { xuatMotO } from '../src/features/reports/export/xuatMotO';

/**
 * Vành "đang chọn" phải TẮT trong lúc chụp, và thẻ phải về nguyên trạng.
 *
 * ═══ Vì sao tách khỏi `xuatMotO.test.ts` ════════════════════════════════════
 *
 * File kia chạy môi trường `node` vì `exceljs` cần stream của Node. Ca này thì
 * ngược lại: nó cần một ELEMENT THẬT. Bản đầu tiên dùng thẻ giả, và đột biến
 * "xoá hẳn đoạn trả style về nguyên trạng" vẫn xanh — vì thẻ giả giữ `style` và
 * thuộc tính `style` ở hai chỗ rời nhau, nên ghi vào cái này không ai thấy ở
 * cái kia. DOM thật ràng hai thứ đó với nhau, và đó chính là thứ đang được kiểm.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Vành sáng xanh là trạng thái của TRÌNH DỰNG. Lọt vào tệp thì ảnh đọc ra như
 * ảnh chụp màn hình phần mềm chứ không phải một biểu đồ để dán vào báo cáo — đo
 * được trên Chromium. Và quên trả style về thì tệ hơn nữa: ô mất viền "đang
 * chọn" ngay trên màn hình, im lặng, cho tới lần React vẽ lại tiếp theo.
 */

vi.mock('../src/features/reports/export/chupBaoCao', async (importOriginal) => ({
  ...(await importOriginal<typeof chup>()),
  chupCacVung: vi.fn(),
  canvasSangPng: vi.fn(),
  taiXuong: vi.fn(),
}));

const SO_LIEU = {
  rows: [{ label: 'a', value: 1 }],
  dimensionLabel: 'Nhóm',
  measureLabel: 'Doanh thu',
  grouped: false,
} as ReportDataDto;

const CANVAS_GIA = { width: 10, height: 10 } as HTMLCanvasElement;

/** Thẻ ô như `Card` dựng ra: vị trí lưới do React đặt, cộng vành đang chọn. */
function oThat(): HTMLElement {
  const el = document.createElement('section');
  el.setAttribute('style', 'grid-column: 1 / span 6; z-index: 2');
  document.body.append(el);
  return el;
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('chụp một ô', () => {
  it('vành tắt trong lúc chụp, rồi thẻ về NGUYÊN TRẠNG', async () => {
    const el = oThat();
    const goc = el.getAttribute('style');
    const luc: Record<string, string> = {};
    vi.mocked(chup.chupCacVung).mockImplementation(async ([e]) => {
      const s = (e as HTMLElement).style;
      luc.boxShadow = s.boxShadow;
      luc.borderColor = s.borderColor;
      return { canvas: CANVAS_GIA, rongCss: 1, caoCss: 1 };
    });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));

    await xuatMotO({ kieu: 'png', el, ten: 'X', tenBaoCao: 'BC', data: SO_LIEU });

    expect(luc.boxShadow).toBe('none');
    expect(luc.borderColor).toBe('rgb(226, 232, 240)');
    // Vị trí lưới do React đặt phải còn nguyên — xoá trắng là ô nhảy về góc.
    expect(el.getAttribute('style')).toBe(goc);
    expect(el.style.boxShadow).toBe('');
  });

  it('chụp hỏng thì thẻ VẪN về nguyên trạng', async () => {
    const el = oThat();
    const goc = el.getAttribute('style');
    vi.mocked(chup.chupCacVung).mockRejectedValue(new chup.LoiXuat('hỏng'));

    await expect(
      xuatMotO({ kieu: 'png', el, ten: 'X', tenBaoCao: 'BC', data: SO_LIEU }),
    ).rejects.toThrow('hỏng');

    expect(el.getAttribute('style')).toBe(goc);
    expect(el.style.boxShadow).toBe('');
  });

  it('thẻ vốn không có style thì chụp xong cũng KHÔNG mọc ra một cái', async () => {
    const el = document.createElement('section');
    document.body.append(el);
    vi.mocked(chup.chupCacVung).mockResolvedValue({
      canvas: CANVAS_GIA,
      rongCss: 1,
      caoCss: 1,
    });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));

    await xuatMotO({ kieu: 'png', el, ten: 'X', tenBaoCao: 'BC', data: SO_LIEU });

    expect(el.hasAttribute('style')).toBe(false);
  });
});
