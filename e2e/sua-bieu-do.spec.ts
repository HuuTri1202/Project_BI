import { expect, test } from '@playwright/test';

import {
  API,
  CANVAS_DATA_409_CHU_DICH,
  dangNhap,
  dungKhungMau,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình xương sống #7: đổi chiều của một ô bằng KÉO-THẢ, lưu, và số liệu đổi.
 *
 * ═══ Vì sao ca này không trùng với `keo-tha.spec.ts` ════════════════════════
 *
 * Hai cú kéo, hai API khác nhau, và `CanvasBoard` nói rõ vì sao:
 *
 *   · DI CHUYỂN một ô dùng Pointer Events — thao tác hình học liên tục, cần
 *     toạ độ ở từng khung hình. Đó là ca `keo-tha`.
 *   · KÉO MỘT TRƯỜNG từ bảng trường vào ô Trục dùng HTML5 drag-and-drop, vì ở
 *     đó cú kéo mang một MẨU DỮ LIỆU từ chỗ này sang chỗ khác.
 *
 * ═══ Và đây là chỗ jsdom không chỉ thiếu — nó CHO QUA cái sai ═══════════════
 *
 * `Shelf.onDragOver` gọi `e.preventDefault()`, và ghi chú ở đó nói đúng điều
 * quan trọng nhất: "`preventDefault` mới là thứ biến một phần tử thành nơi thả
 * được. Thiếu nó thì trình duyệt hiện con trỏ cấm và `drop` không bao giờ bắn."
 *
 * Cái cổng đó là của TRÌNH DUYỆT, và đây là chỗ tui ĐO thay vì suy luận. Xoá
 * đúng dòng `preventDefault()` đó rồi chạy cả hai bộ:
 *
 *     bộ jsdom      873/873 XANH   (58 tệp — không ca nào nhận ra)
 *     ca này        ĐỎ            ("ô Chiều dữ liệu phải nhận chiều mới")
 *
 * Nghĩa là: một thay đổi làm tính năng kéo-thả chết hẳn với MỌI người dùng đi
 * qua được toàn bộ bộ test cũ mà không một ca nào kêu. Đó là lý do ca này tồn
 * tại, phát biểu bằng một con số.
 *
 * ═══ Khẳng định cuối là SỐ LIỆU, không phải nhãn ════════════════════════════
 *
 * Đổi chiều xong thì mở lại TRANG XEM và đòi Vega vẽ nhóm hàng chứ không vẽ khu
 * vực. Một ô Trục hiện đúng tên trường mà truy vấn vẫn trả số cũ là lỗi tệ hơn
 * hẳn một ô Trục hiện sai tên.
 */

/** Tên RIÊNG của ca này — xem ghi chú ở `dungBaoCaoMau`. */
const TEN = { bo: 'e2e-sua-bieu-do', baoCao: 'e2e Đổi chiều' };

/** Ba nhóm hàng trong `TEP_MAU`, tính sẵn từ tệp: không phải ba khu vực. */
const NHOM_HANG = ['Gia dụng', 'Bánh kẹo', 'Đồ uống'] as const;

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('kéo một trường vào ô Trục: lưu được, và mở lại thì số liệu đã đổi', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);

  const token = await layToken(request);
  const auth = { Authorization: `Bearer ${token}` };
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const khung = await dungKhungMau(request, token, TEN);

  /*
   * Nhãn của chiều lấy từ BẢNG TRƯỜNG, không gõ tay vào ca test.
   *
   * Mô hình sinh nhãn từ tên cột qua một bước làm sạch, nên "Nhóm hàng" trong
   * tệp CSV không chắc là "Nhóm hàng" trong bảng trường. Đoán sai thì ca đỏ với
   * "không tìm thấy nút" — một câu không nói gì về chỗ sai.
   */
  const fields = await request.get(`${API}/v1/datamodels/${String(khung.datamodelId)}/fields`, {
    headers: auth,
  });
  expect(fields.status()).toBe(200);
  const dims = ((await fields.json()) as { dimensions: { id: number; label: string }[] })
    .dimensions;
  const chieuMoi = dims.find((d) => /nh[oó]m/i.test(d.label));
  expect(
    chieuMoi,
    `chiều "Nhóm hàng" không thấy; có: ${dims.map((d) => d.label).join(', ')}`,
  ).toBeDefined();

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(khung.reportId)}/edit`);

  // Chọn ô bên trái: các ô Trục / Giá trị / Nhóm màu thuộc về ô ĐANG CHỌN.
  const oTrai = page.getByRole('region', { name: `Ô biểu đồ: ${khung.tieuDe.trai}` });
  await expect(oTrai).toBeVisible({ timeout: 30_000 });
  await oTrai.click();

  /*
   * Ô thả khoanh theo nút "Bỏ …", rồi leo hai tầng DOM lên khối nhận cú thả.
   *
   * ⚠️ Bản đầu tui khoanh theo chữ "Trục" — nhãn đó KHÔNG tồn tại. Ảnh snapshot
   * của lần đỏ cho đúng tên: ô tên là "Chiều dữ liệu (Dimension) · trục X", và
   * nó còn cho một mỏ neo tốt hơn mọi cách khoanh theo chữ nhãn: nút dọn ô mang
   * `aria-label` = "Bỏ {trường} khỏi ô {tên ô}". Nó nói ra CẢ tên ô LẪN trường
   * đang nằm trong đó, nên nó vừa là mỏ neo vừa là khẳng định.
   *
   * `Shelf` không có `role` lẫn `aria-label`: nó là một `<div>` viền nét đứt.
   * Thêm một `data-*` vào sản phẩm chỉ để test khoanh được là sửa sản phẩm cho
   * tiện cho test; `.locator('../..')` thì bám đúng hai tầng và nói rõ nó bám gì.
   */
  const nutBo = (truong: string): ReturnType<typeof page.getByRole> =>
    page.getByRole('button', { name: `Bỏ ${truong} khỏi ô Chiều dữ liệu` });

  await expect(nutBo('Khu vực'), 'ô Chiều dữ liệu phải đang mang chiều cũ').toBeVisible();
  const oChieu = nutBo('Khu vực').locator('../..');

  // ─── Cú kéo HTML5: trường -> ô Chiều dữ liệu ──────────────────────────────

  /*
   * Lọc bằng ô tìm kiếm trước khi kéo — đúng thứ người dùng làm với một mô hình
   * có nhiều trường, và nó bỏ luôn chuyện khoanh trúng một trong nhiều nút cùng
   * mang chữ đó.
   */
  await page
    .getByRole('searchbox', { name: 'Tìm trường trong mô hình' })
    .fill(chieuMoi?.label ?? '');
  const truong = page
    .getByRole('button', { name: new RegExp(`^${chieuMoi?.label ?? ''}`) })
    .first();
  await expect(truong, 'bảng trường phải còn lại chiều mới').toBeVisible();

  // `dragTo` bắn chuỗi sự kiện THẬT của trình duyệt (dragstart -> dragover ->
  // drop), nên nó đi qua cổng `preventDefault` mà jsdom không có.
  await truong.dragTo(oChieu);

  await expect(nutBo(chieuMoi?.label ?? ''), 'ô Chiều dữ liệu phải nhận chiều mới').toBeVisible();

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();

  /*
   * Và sự thật ở đây là SỐ LIỆU trên trang xem, không phải chữ trong trình dựng.
   *
   * Mở lại bằng `goto` chứ không bằng state còn trong tay: đó là đường người
   * dùng đi sau khi lưu, và nó đọc lại từ database qua `GET /reports/:id`.
   */
  await page.goto(`/reports/${String(khung.reportId)}`);

  const marks = page.locator('svg.marks').first();
  await expect(marks, 'biểu đồ phải vẽ lại trên trang xem').toBeVisible({ timeout: 30_000 });

  for (const nhom of NHOM_HANG.slice(0, 2)) {
    await expect(marks, `trục phải mang nhóm hàng "${nhom}"`).toContainText(nhom, {
      timeout: 20_000,
    });
  }

  // Và chiều CŨ phải biến đi: một biểu đồ hiện cả hai là một biểu đồ chưa đổi.
  await expect(marks, 'chiều cũ không được còn trên trục').not.toContainText('Miền Bắc');

  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
