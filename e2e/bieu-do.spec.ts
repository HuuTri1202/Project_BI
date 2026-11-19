import { expect, test } from '@playwright/test';

import {
  CANVAS_DATA_409_CHU_DICH,
  dangNhap,
  dungBaoCaoMau,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình xương sống #3: báo cáo đã lưu MỞ RA LÀ VẼ ĐƯỢC.
 *
 * ═══ Đây là chỗ jsdom không thể với tới, theo nghĩa chặt nhất ═══════════════
 *
 * `chartSpec.test.ts` kiểm *đặc tả* Vega-Lite — một object JavaScript. Nó không
 * trả lời được câu duy nhất người dùng quan tâm: có hình nào hiện ra không.
 * `VegaChart.tsx` gọi `vegaEmbed` với `renderer: 'svg'`, và jsdom không có
 * layout engine nên không bao giờ dựng ra một `<svg class="marks">` có nội
 * dung. Một đặc tả đúng vẫn có thể cho ra biểu đồ trắng: sai tên cột, dữ liệu
 * rỗng vì truy vấn 400, hay `vega-embed` ném trong lúc nạp lười.
 *
 * ═══ Dựng dữ liệu bằng API, kiểm hình bằng trình duyệt ══════════════════════
 *
 * CỐ Ý không dựng báo cáo qua giao diện: việc chọn chiều/thước đo đã có 873 ca
 * jsdom phủ, và đi lại đường đó ở đây chỉ làm ca dài ra rồi hỏng vì một nhãn
 * nút bị sửa. Phần API ở đây là bệ đỡ; phần được KIỂM là chuỗi
 * ClickHouse -> API -> Vega -> SVG.
 *
 * Lần PUT lên MinIO vẫn là PUT THẬT (`request.put` vào vé đã ký), nên bệ đỡ này
 * không mô phỏng chỗ nào.
 */

/** Tên RIÊNG của ca này: hai ca e2e chạy nối nhau trên cùng database dev. */
const TEN = { bo: 'e2e-bieu-do', baoCao: 'e2e Doanh thu theo Khu vực' };

/** `kiem-thu-ban-hang.csv` có 3 khu vực: Miền Bắc, Miền Trung, Miền Nam. */
const SO_KHU_VUC = 3;

/** Dọn theo TÊN, nên nó chạy đúng cả khi ca đỏ ở giữa đường. */
test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('báo cáo đã lưu mở ra là Vega vẽ thật, đúng số nhóm', async ({ page, request }) => {
  // Nạp ClickHouse lần đầu phải tạo bảng; 90s là trần đã đo cho hành trình này.
  test.setTimeout(90_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const { reportId } = await dungBaoCaoMau(request, token, TEN);

  // ─── Và giờ mới là phần của trình duyệt ───────────────────────────────────

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);

  // Tên báo cáo nằm trong thanh trên (`banner`) dưới dạng `<p>`, KHÔNG phải
  // `<h1>` như các trang danh sách — kiểm bằng snapshot của Playwright, không
  // suy từ các trang khác.
  // 20 giây, không phải 5 giây mặc định — xem khối "ba khẳng định này đều chờ
  // hình" ở dưới.
  await expect(page.getByRole('banner'), 'thanh trên phải mang tên báo cáo').toContainText(
    TEN.baoCao,
    { timeout: 20_000 },
  );

  /*
   * `svg.marks` là thứ `vegaEmbed` dựng ra với `renderer: 'svg'`.
   *
   * Khẳng định SỐ CỘT, không chỉ khẳng định "có svg": một biểu đồ trắng cũng có
   * `<svg>`. Ba khu vực trong tệp mẫu -> ba hình chữ nhật mang dữ liệu. Vega
   * còn vẽ `rect` cho nền và vùng vẽ, nên đếm trong nhóm `mark-rect`.
   */
  const marks = page.locator('svg.marks');
  await expect(marks).toBeVisible({ timeout: 20_000 });

  const cot = marks.locator('g.mark-rect path, g.mark-rect rect');
  await expect(cot).toHaveCount(SO_KHU_VUC);

  /*
   * Nhãn trục phải là dữ liệu THẬT, không phải chỗ giữ chỗ.
   *
   * ⚠️ Ba khẳng định `toContainText` của ca này đều mang trần 20 giây, và lý do
   * là một lần đỏ ~50% tui đã đi tìm:
   *
   *   · triệu chứng: `Error: expect(locator).toContainText(expected) failed`,
   *     đỏ ở 2 trong 7 lượt chạy cả bộ, xanh cả hai lượt chạy riêng;
   *   · ảnh snapshot lúc đỏ cho thấy biểu đồ ĐÃ vẽ xong, đủ ba nhãn và đúng số
   *     liệu (9.482.000 / 8.462.000 / 7.102.000 khớp từng đồng với tệp CSV) —
   *     tức là trạng thái đúng tới MUỘN hơn trần, không phải không tới;
   *   · giả thiết đầu của tui — "nhãn tới sau lúc `svg.marks` visible" — ĐÃ BỊ
   *     BÁC: bóp trần xuống 1 giây vẫn xanh, nên bình thường nhãn tới gần như
   *     tức thì.
   *
   * Nên nguyên nhân là một lần ĐỨNG hiếm trên đường nạp, và nghi phạm đã đo
   * được: cả bộ chạy với Vite LẠNH (`netstat` xác nhận 5173 không listening
   * giữa các lượt, `reuseExistingServer` không có gì để dùng lại), nên lần đầu
   * vào trang báo cáo Vite phải biên dịch tại chỗ cả cây vega/vega-lite. Trần 5
   * giây mặc định là con số của Playwright, không phải con số của việc này.
   *
   * KHÔNG dùng `test.slow()` hay nâng trần cả ca: chỗ cần nới là đúng ba khẳng
   * định chờ hình. Và mỗi cái mang một CÂU — lần đỏ đầu chỉ nói
   * "toContainText failed" cho ba khẳng định giống nhau, nên tui mất một lượt
   * chạy chỉ để biết cái nào.
   */
  await expect(marks, 'nhãn trục phải có "Miền Bắc" từ dữ liệu thật').toContainText('Miền Bắc', {
    timeout: 20_000,
  });
  await expect(marks, 'nhãn trục phải có "Miền Nam" từ dữ liệu thật').toContainText('Miền Nam', {
    timeout: 20_000,
  });

  // Lý do của mẫu này nằm ở docblock của chính nó trong `helpers.ts`.
  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
