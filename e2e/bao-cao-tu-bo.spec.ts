import { expect, test } from '@playwright/test';

import {
  CANVAS_DATA_409_CHU_DICH,
  dangNhap,
  dungBoDuLieu,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình #8: từ MỘT BỘ DỮ LIỆU ĐÃ CÓ tới trình dựng biểu đồ — vá B2.
 *
 * ═══ Lỗ đã đo khi dùng hệ thống như người thật ═════════════════════════════
 *
 * Tải tệp lên xong rồi thì không có đường nào vẽ biểu đồ từ nó. Menu "Tạo báo
 * cáo" chỉ có "Tạo nhanh với file Excel/CSV" (mở lại đúng wizard tải lên — tức
 * là bảo người dùng tải tệp đó lên lần nữa) và "Tạo từ mô hình dữ liệu có sẵn".
 * Muốn dùng bộ vừa tải thì phải tự biết đường Kho dữ liệu → Tạo mô hình → Tạo
 * báo cáo, và phải học khái niệm "mô hình dữ liệu" trước khi thấy biểu đồ đầu
 * tiên.
 *
 * ═══ Vì sao ca này phải ở trình duyệt thật ═════════════════════════════════
 *
 * Việc được kiểm là một CHUỖI CHUYỂN TRANG: bấm một mục trong menu dòng, hệ
 * thống gọi `POST /datamodels` rồi điều hướng tới `/datamodels/:id/report/new`,
 * và trình dựng phải mở ra với ô thả có thật. jsdom không chạy được chuỗi đó —
 * nó không có router thật của trang, không có ClickHouse để mô hình dựng lên, và
 * `useTaoBaoCaoNhanh` thì chỉ trả lời được "hàm có gọi đúng API không".
 *
 * Dựng bộ dữ liệu bằng API (`dungBoDuLieu` chờ tới khi nạp xong), rồi đi hoàn
 * toàn bằng giao diện từ Kho dữ liệu trở đi — đó là đúng đoạn đường bị thiếu.
 */

const TEN = { bo: 'e2e-bao-cao-tu-bo', baoCao: 'e2e-bao-cao-tu-bo' };

test.afterEach(async ({ request }) => {
  // Dọn theo TÊN: mô hình sinh ra mang đúng tên bộ dữ liệu, và helper này xoá
  // báo cáo -> mô hình -> bộ dữ liệu theo thứ tự tham chiếu.
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('bộ dữ liệu trong kho -> menu dòng -> trình dựng biểu đồ', async ({ page, request }) => {
  test.setTimeout(90_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  await dungBoDuLieu(request, token, TEN.bo);

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);

  // Lọc bằng ô tìm kiếm chứ không dựa vào thứ tự: tổ chức này đã có hàng chục
  // bộ dữ liệu.
  await page.goto('/datasets');
  await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill(TEN.bo);
  const dong = page.getByRole('row').filter({ hasText: TEN.bo });
  await expect(dong.first()).toBeVisible({ timeout: 20_000 });

  await dong
    .first()
    .getByRole('button', { name: `Thao tác trên ${TEN.bo}` })
    .click();
  await page.getByRole('menuitem', { name: 'Tạo báo cáo' }).click();

  /*
   * Và đây là khẳng định của cả ca: một cú bấm từ Kho dữ liệu phải tới được
   * trình dựng, KHÔNG dừng ở màn tạo mô hình.
   *
   * URL mang id mô hình vừa được dựng ngầm, nên khớp bằng regex — id đổi mỗi
   * lần chạy.
   */
  await expect(page, 'một cú bấm phải tới trình dựng, không dừng ở màn mô hình').toHaveURL(
    /\/datamodels\/\d+\/report\/new/,
    { timeout: 30_000 },
  );

  // Trình dựng phải MỞ RA ĐƯỢC, không chỉ đổi URL: ô thả "Chiều dữ liệu" là thứ
  // chỉ có khi trường của mô hình đã nạp xong từ Cube.
  await expect(
    page.getByText('Chiều dữ liệu').first(),
    'trình dựng phải có ô thả, tức mô hình ngầm dựng được thật',
  ).toBeVisible({ timeout: 30_000 });

  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
