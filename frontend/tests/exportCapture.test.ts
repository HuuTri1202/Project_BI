import { afterEach, describe, expect, it } from 'vitest';

import {
  CANH_TOI_DA,
  choVeXong,
  DIEN_TICH_TOI_DA,
  LoiXuat,
  rgbaSangRgb,
  tenTepXuat,
  tiLeChup,
} from '../src/features/reports/export/chupBaoCao';

/**
 * Phần tính toán của việc xuất ảnh — thứ không cần trình duyệt thật để kiểm.
 *
 * Việc chụp (`modern-screenshot`, `canvas`) chỉ chạy được trên trình duyệt, nên
 * nó được kiểm bằng Chromium; ở đây là những quyết định quanh nó: đợi tới khi
 * nào, chụp ở tỉ lệ bao nhiêu, đặt tên tệp ra sao.
 */

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Tự cầm nhịp khung hình thay vì chờ theo mili giây.
 *
 * ─── Vì sao phải làm thế ────────────────────────────────────────────────────
 *
 * `choVeXong` đợi 3 KHUNG HÌNH yên liên tiếp. Bài test nào diễn tả điều đó bằng
 * `setTimeout` là đang đoán xem rAF của jsdom chạy nhanh bao nhiêu, và lời đoán
 * đó sai tuỳ máy. Đã trả giá hai lần trong cùng một bài:
 *
 *   - Khe hở 50ms cạnh ngưỡng ~48ms (3 khung × 16ms) -> đỏ khoảng một lần
 *     trong ba, và thông báo lỗi không nói gì về nguyên nhân.
 *   - Sau khi nới khe hở cho hết đỏ thì bài test hết đỏ THẬT, nhưng cũng hết
 *     kiểm: đo bằng đột biến (bỏ phép đặt lại bộ đếm) nó vẫn xanh.
 *
 * Cầm nhịp thì không còn đồng hồ nào trong bài test nữa: mỗi lần gọi `khung()`
 * là đúng một khung hình, trên mọi máy.
 */
function nhipKhung(): { khung: (n?: number) => Promise<void>; tra: () => void } {
  const hangDoi: FrameRequestCallback[] = [];
  const goc = globalThis.requestAnimationFrame;

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    hangDoi.push(cb)) as typeof requestAnimationFrame;

  return {
    async khung(n = 1) {
      for (let i = 0; i < n; i += 1) {
        // `splice` TRƯỚC khi gọi: mỗi callback lại đăng ký khung kế tiếp, và gọi
        // ngay cái vừa đăng ký sẽ nuốt nhiều khung vào một lần.
        for (const cb of hangDoi.splice(0)) cb(0);
        // Nhả cho vòng chờ chạy nốt phần `await` của nó rồi mới sang khung sau.
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    tra() {
      globalThis.requestAnimationFrame = goc;
    },
  };
}

describe('choVeXong', () => {
  function vung(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it('đợi tới khi ô "Đang tải…" và biểu đồ đang vẽ đều biến mất', async () => {
    const el = vung('<p data-dang-tai>Đang tải…</p><div data-dang-ve></div>');
    let xong = false;
    const cho = choVeXong(el, 5_000).then(() => (xong = true));

    await new Promise((r) => setTimeout(r, 400));
    el.querySelector('p')?.remove();
    await new Promise((r) => setTimeout(r, 400));
    // Còn một biểu đồ đang vẽ — CHƯA được chụp.
    expect(xong).toBe(false);

    el.querySelector('div')?.removeAttribute('data-dang-ve');
    await cho;
    expect(xong).toBe(true);
  });

  it('dấu bận hiện lại giữa chừng thì ĐẾM LẠI TỪ ĐẦU, không đếm tiếp', async () => {
    // Đúng tình huống thật: số liệu về, ô vừa hết "Đang tải…" thì một nhịp sau
    // Vega mới bắt đầu vẽ. Chụp ở khoảng lặng một nhịp đó là chụp ô trống.
    //
    // Bài này canh đúng chữ "TỪ ĐẦU". Dồn bộ đếm lên 2 khung yên, cho dấu bận
    // hiện lại, rồi thả ra và chờ ĐÚNG MỘT khung:
    //
    //   đếm lại từ đầu -> yen = 1, chưa xong   (đúng)
    //   đếm tiếp       -> yen = 3, đã xong     (sai — và đây là thứ phải đỏ)
    //
    // Khác biệt chỉ lộ ra ở đúng một khung đó, nên bài test phải tự cầm nhịp.
    const nhip = nhipKhung();
    try {
      const el = vung('<p data-dang-tai></p>');
      let xong = false;
      void choVeXong(el, 5_000).then(() => (xong = true));

      await nhip.khung(); // vòng chờ thấy dấu bận -> yen = 0
      el.querySelector('p')?.remove();
      await nhip.khung(2); // hai khung yên -> yen = 2, vẫn thiếu một
      expect(xong, 'hai khung yên là CHƯA đủ ba').toBe(false);

      const bieuDo = document.createElement('div');
      bieuDo.setAttribute('data-dang-ve', '');
      el.appendChild(bieuDo);
      await nhip.khung(); // bận trở lại -> phải đặt bộ đếm về 0

      bieuDo.removeAttribute('data-dang-ve');
      await nhip.khung(); // yên một khung: 1 nếu đếm lại, 3 nếu đếm tiếp
      expect(xong, 'đếm TIẾP thay vì đếm LẠI thì ảnh chụp sẽ trống').toBe(false);

      await nhip.khung(2); // đủ ba khung yên
      expect(xong).toBe(true);
    } finally {
      nhip.tra();
    }
  });

  it('vùng đang hiện lỗi thì dừng NGAY, và nói đúng câu lỗi đó', async () => {
    const el = vung('<div data-loi-xuat="Kho phân tích tạm thời không trả lời."></div>');
    await expect(choVeXong(el, 5_000)).rejects.toThrow('Kho phân tích tạm thời không trả lời.');
  });

  it('không bao giờ vẽ xong thì báo hết hạn, không treo nút mãi', async () => {
    const el = vung('<p data-dang-tai></p>');
    const loi = await choVeXong(el, 500).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(LoiXuat);
    expect((loi as Error).message).toMatch(/chưa vẽ xong/);
  });

  it('vùng đã bị gỡ khỏi trang (người dùng rời đi) thì dừng', async () => {
    const el = vung('<p data-dang-tai></p>');
    const cho = choVeXong(el, 5_000);
    el.remove();
    await expect(cho).rejects.toThrow(/đã đóng/);
  });
});

describe('tiLeChup', () => {
  it('báo cáo cỡ màn hình chụp ở tỉ lệ 2', () => {
    expect(tiLeChup(1456, 824)).toBe(2);
  });

  it('báo cáo rất dài hạ tỉ lệ để khung vẽ không vượt giới hạn — vượt là ra ảnh TRẮNG', () => {
    for (const [rong, cao] of [
      [1456, 12_000],
      [1456, 40_000],
      [20_000, 300],
    ] as const) {
      const k = tiLeChup(rong, cao);
      expect(Math.max(rong, cao) * k).toBeLessThanOrEqual(CANH_TOI_DA);
      expect(rong * k * cao * k).toBeLessThanOrEqual(DIEN_TICH_TOI_DA * 1.000001);
      expect(k).toBeGreaterThan(0);
    }
  });
});

describe('rgbaSangRgb', () => {
  it('điểm ảnh đặc giữ nguyên màu, điểm trong suốt thành TRẮNG chứ không đen', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 128]);
    expect([...rgbaSangRgb(rgba)]).toEqual([10, 20, 30, 255, 255, 255, 127, 127, 127]);
  });
});

describe('tenTepXuat', () => {
  it('giữ tiếng Việt, thay ký tự Windows cấm, nối tên trang', () => {
    expect(tenTepXuat(['Doanh thu quý IV / 2026: miền Bắc?', 'Tổng quan'], 'png')).toBe(
      'Doanh thu quý IV 2026 miền Bắc - Tổng quan.png',
    );
  });

  it('bỏ phần rỗng, bỏ dấu chấm cuối (Windows tự cắt), rỗng hẳn thì có tên thay', () => {
    expect(tenTepXuat(['Báo cáo...', null], 'pdf')).toBe('Báo cáo.pdf');
    expect(tenTepXuat(['  <>|  '], 'pdf')).toBe('bao-cao.pdf');
  });

  it('dạng dấu tổ hợp (NFD) được gộp lại — cùng một tên ra cùng một tệp', () => {
    expect(tenTepXuat(['Quý'.normalize('NFD')], 'png')).toBe(`${'Quý'.normalize('NFC')}.png`);
  });

  it('tên quá dài bị cắt, đuôi tệp vẫn còn', () => {
    const ten = tenTepXuat(['a'.repeat(300)], 'pdf');
    expect(ten).toBe(`${'a'.repeat(120)}.pdf`);
  });
});
