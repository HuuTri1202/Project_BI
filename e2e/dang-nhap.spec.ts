import { expect, test } from '@playwright/test';

/**
 * Hành trình xương sống #1: đăng nhập, vào được trang chủ, và chunk nạp lười
 * thật sự tải được qua HTTP.
 *
 * ─── Vì sao ca ĐẦU TIÊN là ca này ───────────────────────────────────────────
 *
 * Nó chứng minh cả bộ khung chạy được (hai server, proxy `/api`, cookie phiên,
 * điều hướng sau đăng nhập) với ít giả định nhất về dữ liệu có sẵn. Và nó kiểm
 * đúng một thứ mà 873 ca jsdom KHÔNG kiểm được: `React.lazy` có thật sự tách
 * chunk và tải được qua mạng hay không.
 *
 * Điểm đó không phải lý thuyết. Chunk vào cổng đi từ 364 xuống 154 kB gzip bằng
 * ba lần nạp lười (31 trang, wizard tải tệp, khung hỏi đáp). Nếu một trong ba
 * chunk đó 404 trên máy thật, mọi bài test jsdom vẫn xanh — vì jsdom phân giải
 * `import()` qua Vite, không qua HTTP.
 *
 * ─── Không ghi một dòng dữ liệu nào ─────────────────────────────────────────
 *
 * Ca này chỉ đọc, nên không cần dọn. Ca nào GHI phải tự dọn — xem ghi chú ở
 * `playwright.config.ts`.
 */

/** Tài khoản của `docs/tai-khoan-thu-nghiem.md` — admin của Công ty Ánh Dương. */
const TAI_KHOAN = { email: 'mai@anhduong.vn', matKhau: 'Matkhau@123' };

/**
 * Tiếng ồn của Google Sign-In, bỏ qua CÓ CHỦ ĐÍCH — và đây là một quan sát thật.
 *
 * Trên `http://localhost:5173`, nút Google (§1.9) trả 403 kèm
 * `[GSI_LOGGER]: The given origin is not allowed for the given client ID`:
 * origin này chưa nằm trong danh sách cho phép của client ID. Đó là cấu hình ở
 * Google Cloud Console, KHÔNG phải mã của dự án — và đăng nhập bằng mật khẩu
 * không bị ảnh hưởng (ca này chạy xanh qua đúng đường đó).
 *
 * Lọc theo HOST của bên thứ ba, không lọc theo câu chữ của lỗi: lọc theo câu
 * chữ sẽ lặng lẽ che cả lỗi của ta nếu câu chữ tình cờ giống.
 */
const BEN_THU_BA = /accounts\.google\.com|GSI_LOGGER/;

/**
 * `Failed to load resource` bị bỏ qua ở kênh CONSOLE — và đó không phải nhượng bộ.
 *
 * Trình duyệt ghi câu này KHÔNG KÈM URL, nên nó không gán được cho origin nào:
 * dùng nó để phán xét thì hoặc che cả lỗi của ta, hoặc đỏ vì một 403 của
 * Google. Lỗi mạng đã có dụng cụ ĐÚNG là `xau` bên dưới — nó đọc `response` nên
 * biết chính xác host và mã. Kênh console để dành cho lỗi RUNTIME: ngoại lệ
 * chưa bắt, cảnh báo của React.
 */
const KHONG_GAN_DUOC_ORIGIN = /Failed to load resource/;

test('đăng nhập -> trang chủ, và khung hỏi đáp nạp lười tải được', async ({ page }) => {
  /*
   * Thu lỗi runtime TRƯỚC khi điều hướng.
   *
   * Đây là nửa giá trị của ca này: một chunk 404, một biến undefined, một
   * `Suspense` không bắt được lỗi — tất cả đều hiện ra ở đây mà không ca jsdom
   * nào thấy. Thu cả `pageerror` (ngoại lệ chưa bắt) lẫn `console.error`.
   */
  const loi: string[] = [];
  page.on('pageerror', (err) => loi.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' && !BEN_THU_BA.test(t) && !KHONG_GAN_DUOC_ORIGIN.test(t)) {
      loi.push(`console.error: ${msg.text()}`);
    }
  });

  /*
   * Mọi phản hồi >= 400 TỪ CHÍNH TA — không riêng `.js`/`.css`.
   *
   * Một chunk 404 là lỗi im lặng nhất có thể xảy ra sau khi chia chunk: `lazy`
   * chỉ ném ở ranh giới `Suspense`, nên trang chỉ trắng một góc và không ca
   * jsdom nào thấy (jsdom phân giải `import()` qua Vite, không qua HTTP). Bắt
   * luôn cả request API hỏng thì cùng một ca canh được hai loại lỗi.
   */
  const xau: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400 && !BEN_THU_BA.test(res.url())) {
      xau.push(`${String(res.status())} ${res.request().method()} ${res.url()}`);
    }
  });

  await page.goto('/login');

  await page.getByLabel('Email').fill(TAI_KHOAN.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(TAI_KHOAN.matKhau);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();

  // Trang chủ chào bằng tên người đăng nhập — khẳng định phần KHÔNG đổi theo
  // tài khoản, để ca này không hỏng khi ai đó sửa tên hiển thị.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào');

  /*
   * Khung hỏi đáp: `NguCanhProvider` nạp lười nó, nên cái nút này chỉ xuất hiện
   * SAU khi trình duyệt tải xong một chunk riêng. Nó có mặt = chia chunk đúng.
   */
  await expect(
    page.getByRole('button', { name: 'Mở khung hỏi đáp về dữ liệu đang xem' }),
  ).toBeVisible();

  /*
   * Đặt ba người CHỜ TRƯỚC khi bấm, rồi mới bấm.
   *
   * ⚠️ Bản đầu của ca này khẳng định `xau` ngay sau khi panel hiện ra, và nó
   * XANH GIẢ: panel hiện trước, ba truy vấn ngữ cảnh về sau, nên lúc khẳng định
   * thì `xau` còn rỗng. Đột biến chứng minh: đặt lại `TRAN = 200` (đúng lỗi vừa
   * sửa) mà ca vẫn xanh. Chỉ khi chẩn đoán riêng, có chờ, mới thấy ba dòng 400.
   *
   * Nên chờ ĐÚNG BA phản hồi, không `waitForTimeout`: nếu một ngày panel thôi
   * nạp ngữ cảnh thì người chờ sẽ hết giờ và ca đỏ kèm tên truy vấn thiếu —
   * còn một lần `sleep` thì chỉ làm ca chậm đi rồi xanh.
   */
  const NGU_CANH = ['datasets', 'datamodels', 'orders'] as const;
  const choNguCanh = NGU_CANH.map((ten) =>
    page.waitForResponse((res) => res.url().includes(`/api/v1/${ten}?`)),
  );

  // Bấm vào để phần thân (chunk `goiYBieuDo`, 13,38 kB) cũng phải tải được.
  await page.getByRole('button', { name: 'Mở khung hỏi đáp về dữ liệu đang xem' }).click();
  await expect(page.getByRole('region', { name: 'Hỏi đáp về dữ liệu đang xem' })).toBeVisible();

  /*
   * Ba truy vấn này là thứ khung hỏi đáp DỰA VÀO để biết tổ chức có gì. Một mã
   * 400 ở đây không hiện ra lỗi nào trên giao diện — nó chỉ làm khung trả lời
   * như thể tổ chức chưa có dữ liệu. Chính lỗi đó: `pageSize=200` vượt trần 100.
   */
  const phanHoi = await Promise.all(choNguCanh);
  for (const [i, res] of phanHoi.entries()) {
    expect(res.status(), `truy vấn ngữ cảnh ${NGU_CANH[i] ?? '?'} phải thành công`).toBeLessThan(
      400,
    );
  }

  expect(xau, 'không request nào của chính ta trả >= 400').toEqual([]);
  expect(loi, 'không lỗi runtime nào của chính ta trên đường đi').toEqual([]);
});
