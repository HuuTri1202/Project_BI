import { expect, test, type APIRequestContext } from '@playwright/test';

import { dangNhap, khongLoiNao, layToken, theoDoiLoi } from './helpers';

/**
 * Hành trình xương sống #4: mua gói — mã QR, đồng hồ, và vòng thăm dò.
 *
 * ═══ Ba thứ ở đây CHỈ trình duyệt thật trả lời được ═════════════════════════
 *
 *   1. Mã QR có VẼ ra không. `QrCode.tsx` gọi `QRCode.toString` rồi nhồi kết
 *      quả qua `dangerouslySetInnerHTML` — chỗ duy nhất trong repo dùng API đó.
 *      Một chuỗi VietQR đúng (`vietqr.ts` đã có test đơn vị) vẫn có thể ra một ô
 *      trống: thư viện ném, chunk không nạp được, hay `svg` bị CSS bóp về 0.
 *      Khách không quét được một mã không có ở đó.
 *   2. Đồng hồ đếm ngược có CHẠY không — `setInterval` thật, không fake timer.
 *   3. Và thứ đáng giá nhất: SERVER ĐỔI TRẠNG THÁI THÌ MÀN HÌNH TỰ BẮT.
 *      `useOrderStatus` hỏi lại mỗi 2 giây và dừng khi đơn rời
 *      `ORDER_STATUSES_LIVE`. Không ca jsdom nào kiểm được điều này: nó cần hai
 *      tiến trình — một đổi dữ liệu, một đang xem — và nó là chính lời hứa in
 *      trên màn hình ("màn hình này tự cập nhật, bạn không cần tải lại trang").
 *
 * ═══ Vì sao HUỶ, không phải TRẢ TIỀN ═══════════════════════════════════════
 *
 * Bộ e2e chạy trên database DEV. Một đơn `paid` bật subscription thật, ghi
 * `payment_transactions` và nhật ký — sổ cái tiền là append-only CÓ CHỦ ĐÍCH,
 * nên không có đường lùi. Huỷ đơn đi qua ĐÚNG vòng thăm dò đó bằng cùng cơ chế
 * (`ORDER_STATUSES_LIVE` -> ra khỏi danh sách -> màn hình đổi), và nó lùi được.
 *
 * Muốn kiểm thật nhánh `paid` thì phải cho e2e một API chạy trên
 * `bi_platform_test` — việc đáng làm, nhưng là việc khác.
 */

const API = 'http://127.0.0.1:4000/api';

/** `BI` + 10 ký tự Crockford base32 — xem `services/billing/orderCode.ts`. */
const MA_DON = /BI[0-9A-HJKMNP-TV-Z]{10}/;

/**
 * Mã đơn ca này tạo ra, để `afterEach` dọn.
 *
 * ⚠️ Lưu id là đúng ở ĐÂY, trong khi nó từng làm rò dữ liệu ở `tai-tep.spec.ts`
 * — khác biệt nằm ở chỗ nó được lưu KHI NÀO. Mã đơn có ngay ở bước thứ ba, nên
 * cửa sổ "đỏ mà chưa kịp lưu" chỉ còn phần đăng nhập. Và một đơn `pending` sót
 * lại không nguy hiểm: `findLivePendingOrder` khiến lần chạy sau DÙNG LẠI chính
 * nó thay vì chồng thêm đơn mới. Bộ dữ liệu sót thì không tự lành như vậy.
 */
let maDaTao: string | null = null;

async function huyDon(request: APIRequestContext, code: string): Promise<number> {
  const token = await layToken(request);
  const res = await request.post(`${API}/v1/orders/${code}/cancel`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status();
}

test.afterEach(async ({ request }) => {
  if (maDaTao === null) return;
  // 204 nếu đơn còn chờ, 409 nếu chính ca này đã huỷ nó rồi — cả hai đều xong
  // việc, nên không khẳng định mã ở đây.
  await huyDon(request, maDaTao);
  maDaTao = null;
});

test('mua gói: QR vẽ thật, đồng hồ chạy, và server đổi trạng thái thì màn hình tự bắt', async ({
  page,
  request,
}) => {
  const token = await layToken(request);
  const auth = { Authorization: `Bearer ${token}` };

  /*
   * Chọn gói bằng DỮ LIỆU, không hard-code "Chuyên nghiệp".
   *
   * Bảng giá là dữ liệu vận hành: đổi tên gói hay gỡ một gói khỏi bảng giá là
   * chuyện thường, và một ca đỏ vì điều đó là một ca nói sai chỗ.
   */
  const goiRes = await request.get(`${API}/v1/plans`, { headers: auth });
  expect(goiRes.status()).toBe(200);
  const goi = (
    (await goiRes.json()) as { id: number; name: string; priceVnd: number; isPublic: boolean }[]
  ).find((p) => p.isPublic && p.priceVnd > 0);
  expect(goi, 'bảng giá phải có ít nhất một gói trả tiền đang bán').toBeDefined();
  const g = goi as { id: number; name: string };

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);

  // Trang bảng giá: đi qua nó để biết route, chunk và API đều còn sống.
  await page.goto('/billing/plans');
  await expect(page.getByRole('heading', { level: 3, name: g.name })).toBeVisible();

  /*
   * Rồi VÀO thẳng màn thanh toán, không bấm "Nâng cấp ngay" trên thẻ gói.
   *
   * Tổ chức đang ở gói Free nên MỌI gói trả tiền đều hiện cùng một nhãn nút, và
   * khoanh đúng thẻ cần bấm phải leo từ `<h3>` lên div cha theo class — dòng dễ
   * vỡ nhất trong cả tệp, cho một cú bấm mà việc duy nhất của nó là gọi
   * `navigate()`, thứ đã có ca jsdom phủ. Phần được KIỂM ở đây nằm sau chỗ này.
   */
  await page.goto(`/billing/checkout/${String(g.id)}?cycle=monthly`);
  await expect(page.getByRole('heading', { name: 'Xác nhận đơn hàng' })).toBeVisible();

  // Chỉ một phương thức được cấu hình thì `CheckoutPage` tự chọn sẵn, nên không
  // bấm radio ở đây. Ngày có hai phương thức, ca này đỏ ngay ở bước dưới với
  // câu "Hãy chọn một phương thức thanh toán." — đúng chỗ.
  await page.getByRole('button', { name: 'Tạo đơn thanh toán' }).click();

  await page.waitForURL(/\/billing\/orders\/BI[0-9A-HJKMNP-TV-Z]{10}$/, { timeout: 15_000 });
  const maDon = MA_DON.exec(page.url())?.[0];
  expect(maDon, 'URL phải mang mã đơn — đóng tab rồi mở lại là về đúng mã QR đó').toBeDefined();
  maDaTao = maDon as string;

  // ─── 1. Mã QR phải VẼ RA, không chỉ chiếm chỗ ─────────────────────────────

  /*
   * Khoanh theo `aria-label` chứa mã đơn: nó kiểm luôn phần nhãn cho trình đọc
   * màn hình. Một ảnh QR không nhãn là một ô vuông vô nghĩa với người dùng
   * screen reader, và đây là màn CHUYỂN TIỀN.
   */
  const qr = page.getByRole('img', { name: new RegExp(maDon as string) });
  await expect(qr).toBeVisible();

  // Câu dự phòng của `QrCode` KHÔNG được xuất hiện — nó là nhánh "thư viện ném".
  await expect(page.getByText('Không vẽ được mã QR')).toHaveCount(0);

  /*
   * Và trong đó phải là một MA TRẬN THẬT.
   *
   * ⚠️ `qrcode` phát ra HAI `<path>`, và `.first()` là cái sai: path đầu là NỀN
   * TRẮNG (`M0 0h39v39H0z`, 13 ký tự) — viền bắt buộc theo chuẩn QR. Ma trận
   * nằm ở path CUỐI. Bản đầu đo path đầu và đỏ với "độ dài 13", một con số
   * trông như mã QR hỏng trong khi mã hoàn toàn đúng.
   *
   * Trần 1.500 là con số ĐO, và cả hai đầu đều đo được: chuỗi EMVCo của một đơn
   * dài 118 ký tự cho ma trận 39x39 với `d` dài ~2.180 ký tự, còn đột biến đổi
   * chuỗi QR thành một ký tự cho ma trận nhỏ nhất có thể — `d` dài 750. Trần
   * nằm giữa hai số đó, lệch về phía dưới đủ để chịu được một số tài khoản dài
   * hơn làm chuỗi EMVCo phình ra.
   */
  const d = await qr.locator('path').last().getAttribute('d');
  expect((d ?? '').length, 'ma trận QR phải đủ dày cho một chuỗi VietQR thật').toBeGreaterThan(
    1500,
  );

  // Đường chép tay phải mang ĐÚNG mã đơn: đó là chuỗi khách gõ vào ô nội dung
  // chuyển khoản, và hệ thống đối chiếu bằng chính nó.
  await expect(page.getByText(maDon as string, { exact: true })).toBeVisible();

  // ─── 2. Đồng hồ đếm ngược phải CHẠY ───────────────────────────────────────

  // `conLai` trả `mm:ss`, và đây là chuỗi duy nhất trên trang có hình dạng đó.
  const dongHo = page.getByText(/^\d{2}:\d{2}$/);
  const truoc = await dongHo.textContent();
  expect(truoc, 'phải có đồng hồ đếm ngược').not.toBeNull();
  // `not.toHaveText` tự thử lại tới khi khác — không cần `waitForTimeout`, nên
  // nó đỏ khi `setInterval` chết, không đỏ vì máy chậm.
  await expect(dongHo, 'đồng hồ phải nhảy mỗi giây').not.toHaveText(truoc as string, {
    timeout: 5_000,
  });

  // ─── 3. Server đổi trạng thái, màn hình tự bắt ────────────────────────────

  /*
   * Dấu để chứng minh trang KHÔNG tải lại.
   *
   * Thiếu nó thì ca này vẫn xanh nếu một ngày ai đó thêm `location.reload()`
   * vào vòng thăm dò — và lúc đó khẳng định dưới đây đúng vì lý do sai: một
   * trang mới nạp cũng hiện "đơn đã đóng". Thứ được hứa với khách là màn hình
   * tự cập nhật, không phải tự nạp lại.
   */
  await page.evaluate(() => {
    (window as unknown as { __e2eDau?: number }).__e2eDau = 1;
  });

  // Huỷ từ NGOÀI trình duyệt — tiến trình khác, không qua giao diện. Đúng hình
  // dạng của chuyện thật: webhook hay người vận hành đổi đơn, còn tab của khách
  // chỉ đang xem.
  expect(await huyDon(request, maDon as string), 'huỷ đơn từ ngoài trình duyệt').toBe(204);

  // Vòng thăm dò 2 giây; 15 giây là trần rộng rãi. Không bấm, không goto, không
  // reload — màn hình phải tự đổi.
  await expect(page.getByText('Đơn không còn ở trạng thái chờ thanh toán.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(qr, 'mã QR phải biến đi cùng với đơn').toHaveCount(0);

  expect(
    await page.evaluate(() => (window as unknown as { __e2eDau?: number }).__e2eDau),
    'trang không được tải lại — màn hình phải tự cập nhật',
  ).toBe(1);

  khongLoiNao(theoDoi);
});
