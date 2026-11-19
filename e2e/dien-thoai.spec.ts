import { expect, test } from '@playwright/test';

import {
  CANVAS_DATA_409_CHU_DICH,
  dangNhap,
  dungKhungMau,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình #9: ĐIỆN THOẠI — vá B5.
 *
 * ═══ Hai lỗi đã đo trên màn 390px ══════════════════════════════════════════
 *
 *   Kho dữ liệu   cột thư mục (`w-56`, 224px, `shrink-0`) và bảng xếp CẠNH
 *                 nhau, nên bảng chỉ còn ~150px cho một `min-w-[52rem]`: tên bộ
 *                 dữ liệu bị cắt giữa chừng, nút "Sau" của phân trang bị xén, và
 *                 bốn cột cuối nằm ngoài tầm.
 *   Trang báo cáo ô biểu đồ giữ nguyên 6/12 cột của desktop, nên nó chiếm đúng
 *                 nửa màn hình và nửa còn lại để trắng.
 *
 * ═══ Vì sao PHẢI là trình duyệt thật ═══════════════════════════════════════
 *
 * Cả hai bản vá là CSS thuần: `lg:flex-row` cho cột thư mục, và một khối
 * `@media (max-width: 1023px)` cho khung báo cáo. jsdom không có engine bố cục —
 * mọi `getBoundingClientRect` của nó trả về 0 — nên ở đó không có cách nào phân
 * biệt một bản vá đúng với một bản vá không chạy. Ca này ĐO bằng pixel thật.
 *
 * Trần dưới 300px (trên 390px màn hình, trừ padding trang) là con số chọn để
 * khẳng định "rộng gần hết khung" mà không khoá vào một giá trị padding cụ thể.
 */

test.use({ viewport: { width: 390, height: 844 } });

const TEN = { bo: 'e2e-dien-thoai', baoCao: 'e2e Khung dien thoai' };
const RONG_TOI_THIEU = 300;

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('Kho dữ liệu trên điện thoại: cột thư mục xếp TRÊN bảng, không cạnh bảng', async ({
  page,
}) => {
  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto('/datasets');

  const thuMuc = page.getByRole('navigation', { name: /Thư mục/ });
  await expect(thuMuc).toBeVisible({ timeout: 20_000 });

  /*
   * Đo CỘT DANH SÁCH, không đo cái bảng.
   *
   * Workspace của tài khoản e2e thường rỗng — mọi ca khác đều dọn dữ liệu của
   * mình — nên ở đây là `EmptyState`, không có thẻ `table` nào. Mà khẳng định
   * của ca này là về BỐ CỤC, và bố cục phải đúng cả khi danh sách rỗng. Bản đầu
   * đo `table` và đỏ vì đúng lý do đó, không phải vì bản vá sai.
   */
  const cot = page.locator('[data-cot-danh-sach]');
  await expect(cot).toBeVisible({ timeout: 20_000 });

  const oThuMuc = await thuMuc.boundingBox();
  const oCot = await cot.boundingBox();
  expect(oThuMuc, 'cột thư mục phải đo được').not.toBeNull();
  expect(oCot, 'cột danh sách phải đo được').not.toBeNull();

  // Xếp DỌC: đáy cột thư mục không được thấp hơn đỉnh cột danh sách.
  expect(
    (oThuMuc?.y ?? 0) + (oThuMuc?.height ?? 0),
    'cột thư mục phải nằm TRÊN cột danh sách, không cạnh nó',
  ).toBeLessThanOrEqual((oCot?.y ?? 0) + 1);

  // Và cột danh sách nhận gần hết bề rộng — trước bản vá nó còn ~150px.
  expect(oCot?.width ?? 0, 'cột danh sách phải rộng gần hết màn hình').toBeGreaterThan(
    RONG_TOI_THIEU,
  );

  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});

test('Khung báo cáo trên điện thoại: hai ô 6/12 xếp dọc, mỗi ô rộng hết khung', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const { reportId, o } = await dungKhungMau(request, token, TEN);

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);

  const oTrai = page.locator(`[data-visual-id="${o.trai}"]`);
  const oPhai = page.locator(`[data-visual-id="${o.phai}"]`);
  await expect(oTrai).toBeVisible({ timeout: 30_000 });
  await expect(oPhai).toBeVisible({ timeout: 30_000 });

  const t = await oTrai.boundingBox();
  const p = await oPhai.boundingBox();
  expect(t).not.toBeNull();
  expect(p).not.toBeNull();

  /*
   * Hai ô cùng `y: 0` và `w: 6` trên desktop nằm CẠNH nhau. Trên điện thoại
   * chúng phải xếp dọc — đây là khẳng định chính của ca này.
   */
  expect((t?.y ?? 0) + (t?.height ?? 0), 'ô bên trái phải nằm TRÊN ô bên phải').toBeLessThanOrEqual(
    (p?.y ?? 0) + 1,
  );

  // Và mỗi ô rộng gần hết khung, không phải nửa màn hình.
  expect(t?.width ?? 0, 'ô thứ nhất phải rộng gần hết màn hình').toBeGreaterThan(RONG_TOI_THIEU);
  expect(p?.width ?? 0, 'ô thứ hai phải rộng gần hết màn hình').toBeGreaterThan(RONG_TOI_THIEU);

  // Cao đủ để đọc được trục — `min-height: 15rem` trong `index.css`.
  expect(t?.height ?? 0, 'ô phải cao đủ để biểu đồ đọc được').toBeGreaterThan(200);

  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
