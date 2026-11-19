import path from 'node:path';

import { expect, test } from '@playwright/test';

import { dangNhap, khongLoiNao, layToken, theoDoiLoi } from './helpers';

/**
 * Hành trình xương sống #2: tải tệp lên → chốt → nạp vào Kho dữ liệu.
 *
 * ═══ Vì sao phải là trình duyệt thật ════════════════════════════════════════
 *
 * Đây là đường mà jsdom KHÔNG đi được, và không phải vì thiếu một API:
 *
 *   - Uppy mở một `XMLHttpRequest` PUT thẳng lên S3/MinIO bằng vé đã ký. Bộ test
 *     backend mô phỏng bước đó bằng `memoryStorage.putForTest` — tức là nó kiểm
 *     chính đoạn mã giả, không kiểm lần PUT thật.
 *   - `useUppyS3.test.tsx` kiểm phần cấu hình Uppy, không kiểm việc byte có tới
 *     được MinIO hay không.
 *   - Bước 3 chạy ba việc nối nhau (phân tích, chốt, nạp ClickHouse) qua nhiều
 *     request; jsdom không dựng được chuỗi đó với cùng thời gian thật.
 *
 * Dùng chính tệp mẫu của bộ kiểm thử (`docs/kiem-thu/du-lieu-thu/`): 6 cột,
 * tiếng Việt có dấu, và nó đã có đáp án ghi trong kịch bản.
 *
 * ═══ Ca này GHI dữ liệu, nên nó phải tự dọn ═════════════════════════════════
 *
 * Dọn bằng API trong `afterEach`, không bằng giao diện: `afterEach` phải chạy
 * được cả khi ca đỏ ở giữa đường, lúc đó giao diện đang ở trạng thái bất kỳ.
 */

const TEP = path.resolve(__dirname, '../docs/kiem-thu/du-lieu-thu/kiem-thu-ban-hang.csv');

/** Tên bộ dữ liệu wizard tự đặt từ tên tệp — xem `slugTenFile` không đụng tới tên hiển thị. */
const TEN_BO = 'kiem-thu-ban-hang';

/**
 * Dọn theo TÊN, không theo id mà ca đã ghi lại.
 *
 * ⚠️ Bản đầu lưu id vào một biến rồi `afterEach` xoá theo id đó. Nó rò dữ liệu
 * thật: id chỉ được ghi ở BƯỚC CUỐI, nên ba lần chạy đỏ ở giữa đường (selector
 * sai, hết giờ, thiếu token) để lại ba bộ dữ liệu sống trong database dev —
 * kiểm lại thấy đúng hai bản ghi `deleted_at = NULL`.
 *
 * Dọn theo tên thì không phụ thuộc ca đi được tới đâu. Tên này là tên tệp mẫu
 * của chính bộ kiểm thử, nên nó không trùng với dữ liệu người dùng đặt tay.
 */
test.afterEach(async ({ request }) => {
  const token = await layToken(request);
  const auth = { Authorization: `Bearer ${token}` };

  const ds = await request.get(
    `http://127.0.0.1:4000/api/v1/datasets?page=1&pageSize=100&q=${encodeURIComponent(TEN_BO)}`,
    { headers: auth },
  );
  if (ds.status() !== 200) return;

  const { items } = (await ds.json()) as { items: { id: number; name: string }[] };
  for (const d of items.filter((x) => x.name === TEN_BO)) {
    await request.delete(`http://127.0.0.1:4000/api/v1/datasets/${String(d.id)}`, {
      headers: auth,
    });
  }
});

test('tải CSV lên -> chốt -> bộ dữ liệu nằm trong Kho dữ liệu', async ({ page, request }) => {
  /*
   * 90 giây, không phải 30 mặc định — và con số này là số ĐO, không phải số đoán.
   *
   * Hành trình này nối sáu việc thật: vé ghi đã ký, PUT lên MinIO, phân tích
   * tệp, chốt, nạp ClickHouse (lần đầu còn phải tạo bảng), rồi tải lại danh
   * sách. Bản đầu dùng 30s và hết giờ ở bước cuối trong khi năm bước trước đã
   * xong đúng — một ca đỏ nói sai chỗ.
   */
  test.setTimeout(90_000);

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);

  await page.goto('/datasets');
  /*
   * Khoanh vào `<header>` của trang.
   *
   * Nút này có HAI chỗ: phần đầu trang (luôn có) và khối "chưa có gì" (chỉ khi
   * danh sách rỗng). `.first()` sẽ đúng hôm nay và sai ngày ai đó đổi thứ tự
   * DOM; `PageHeader` thì luôn render ra `<header>`, còn khối rỗng nằm trong
   * `PageBody`.
   */
  await page.locator('header').getByRole('button', { name: '+ Tạo bộ dữ liệu' }).click();

  const wizard = page.getByRole('dialog');
  await expect(wizard.getByText('Tạo bộ dữ liệu từ file')).toBeVisible();

  /*
   * Đặt tệp vào `input[type=file]` của Uppy Dashboard.
   *
   * Uppy giấu ô này sau vùng kéo-thả, nên `setInputFiles` là cách đúng: nó đặt
   * tệp rồi phát `change`, y như trình duyệt làm khi người dùng chọn tệp. Không
   * mô phỏng kéo-thả ở đây — kéo-thả là chuyện của Uppy, còn ca này canh đường
   * đi của byte.
   */
  // `:not([webkitdirectory])` — Uppy dựng HAI ô: một cho tệp, một cho cả thư
  // mục. Lấy `.first()` thì đúng hôm nay và sai ngày Uppy đổi thứ tự.
  await wizard.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(TEP);

  /*
   * Chờ lần PUT THẬT lên MinIO — đây là điểm của cả ca này.
   *
   * Vé ghi trỏ thẳng vào MinIO ở cổng 9000, KHÔNG qua proxy `/api`, nên nó
   * không nằm trong `theoDoi.xau` (hàm đó chỉ xét host của ta). Phải khẳng định
   * riêng.
   */
  const put = await page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url().includes(':9000/'),
    { timeout: 20_000 },
  );
  expect(put.status(), 'lần PUT lên MinIO phải thành công').toBeLessThan(300);

  await wizard.getByRole('button', { name: 'Tiếp tục' }).click();

  // Bước 2: CSV cho ra đúng một sheet, nên nhãn nút nói "1 bộ dữ liệu".
  await wizard.getByRole('button', { name: 'Tạo 1 bộ dữ liệu' }).click();

  /*
   * Bước 3 tự chạy: phân tích → chốt → nạp ClickHouse. Cho nó 25 giây vì lần
   * nạp đầu phải tạo bảng trong kho phân tích.
   */
  await expect(wizard.getByText('Đã tạo bộ dữ liệu thành công!')).toBeVisible({ timeout: 25_000 });

  await wizard.getByRole('button', { name: 'Xem bộ dữ liệu' }).click();

  /*
   * Và nó phải CÓ THẬT trong danh sách, không chỉ có thật trong hộp thoại.
   *
   * Lọc bằng ô tìm kiếm thay vì đọc trang đầu: tổ chức này đã có hàng chục bộ
   * dữ liệu, và một ca dựa vào thứ tự sắp xếp là một ca hỏng khi dữ liệu đổi.
   */
  // `searchbox`, không phải `textbox`: ô này là `<input type="search">`.
  await page.getByRole('searchbox', { name: 'Tìm kiếm' }).fill(TEN_BO);
  const dong = page.getByRole('row').filter({ hasText: TEN_BO });
  await expect(dong.first()).toBeVisible();

  /*
   * Và nó phải mang ĐÚNG hình dạng tệp: 6 cột, 36 dòng.
   *
   * Hai con số này là bằng chứng bước phân tích đã đọc được tệp thật, không chỉ
   * là một bản ghi rỗng mang tên tệp. `kiem-thu-ban-hang.csv` có 6 cột và 36
   * dòng dữ liệu — cùng con số mà kịch bản `docs/kiem-thu` đã chốt.
   */
  await expect(dong.first()).toContainText('6');
  await expect(dong.first()).toContainText('36');

  /*
   * Lấy id để dọn — đọc từ API chứ không bới DOM: `afterEach` cần đúng một con
   * số, và đường dẫn trong DOM có thể đổi mà không ai sửa ca này.
   *
   * ⚠️ Phải gắn Bearer TAY. `page.request` chia sẻ cookie của trình duyệt, mà
   * ứng dụng này xác thực bằng token trong header — nên không gắn thì lời gọi
   * trả 401 và `items` là `undefined`. Bản đầu mắc đúng chỗ đó và chết bằng
   * `Cannot read properties of undefined (reading 'find')`, một thông báo không
   * nói gì về nguyên nhân.
   */
  const token = await layToken(request);
  const ds = await request.get(
    `http://127.0.0.1:4000/api/v1/datasets?page=1&pageSize=100&q=${encodeURIComponent(TEN_BO)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(ds.status(), 'tra lại bộ dữ liệu qua API').toBe(200);
  const body = (await ds.json()) as { items: { id: number; name: string }[] };
  const vua = body.items.find((d) => d.name === TEN_BO);

  /*
   * Khẳng định qua API, không phải để lấy id đi dọn — `afterEach` dọn theo tên.
   *
   * Nó trả lời một câu khác với câu bảng trên màn hình đã trả lời: bản ghi có
   * tồn tại ở phía máy chủ, chứ không chỉ có một dòng trong DOM. Hai thứ đó
   * từng lệch nhau thật: wizard báo "Đã tạo thành công" trong khi danh sách còn
   * rỗng, vì danh sách đọc từ cache của react-query.
   */
  expect(vua, 'phải tìm lại được bộ dữ liệu vừa tạo qua API').toBeDefined();

  khongLoiNao(theoDoi);
});
