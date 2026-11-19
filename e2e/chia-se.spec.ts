import { expect, test } from '@playwright/test';

import { dangNhap, dungKhungMau, layToken, xoaBaoCaoVaBoTheoTen } from './helpers';

/**
 * Hành trình #11: chia sẻ báo cáo bằng LIÊN KẾT — mong muốn D5.
 *
 * ═══ Vì sao ca này phải ở trình duyệt thật, và trong context THỨ HAI ═══════
 *
 * Khẳng định của cả tính năng là "người KHÔNG có tài khoản mở được". Bộ tích
 * hợp `reportShare.integration.test.ts` chứng minh phần máy chủ (quyền, vòng
 * đời, DTO không rò gì). Thứ nó không với tới được là phần còn lại của câu đó:
 * trang `/xem/:chuoi` có dựng ra được mà KHÔNG có token nào trong máy không, và
 * có bị `apiClient` đá về `/login` không.
 *
 * Nên ca này mở một context thứ hai, KHÔNG `storageState`, tức một trình duyệt
 * sạch — đúng cái máy của người kế toán nhận liên kết.
 */

const TEN = { bo: 'e2e-chia-se', baoCao: 'e2e Khung chia se' };

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('tạo liên kết, người KHÔNG đăng nhập mở được, thu hồi thì không mở được nữa', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const { reportId } = await dungKhungMau(request, token, TEN);

  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);

  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  await page.getByRole('button', { name: 'Tạo liên kết' }).click();

  const o = page.getByLabel('Đường dẫn chia sẻ');
  await expect(o).toBeVisible({ timeout: 20_000 });
  const url = await o.inputValue();
  expect(url, 'đường dẫn phải trỏ vào trang xem công khai').toContain('/xem/');

  /*
   * Và giờ là phần duy nhất chỉ ca này kiểm được: một trình duyệt SẠCH.
   *
   * Không `storageState`, nên không có token nào trong `localStorage` — đúng
   * tình huống của người nhận liên kết. Nếu trang này còn phụ thuộc phiên ở bất
   * kỳ chỗ nào, nó sẽ bị đá về `/login` và ca đỏ ngay.
   */
  const khach = await browser.newContext();
  const trangKhach = await khach.newPage();
  await trangKhach.goto(url);

  await expect(
    trangKhach.getByRole('heading', { name: TEN.baoCao }),
    'người không đăng nhập phải thấy tên báo cáo',
  ).toBeVisible({ timeout: 30_000 });
  await expect(trangKhach, 'KHÔNG được đá về trang đăng nhập').not.toHaveURL(/\/login/);

  // Biểu đồ phải VẼ THẬT, không chỉ có tiêu đề: đây là chỗ đường số liệu công
  // khai gặp Vega.
  await expect(trangKhach.locator('svg.marks').first()).toBeVisible({ timeout: 30_000 });

  // Và không có lối nào dẫn vào phần phải đăng nhập.
  await expect(trangKhach.getByRole('link', { name: /Đăng nhập/ })).toHaveCount(0);

  /*
   * Người ĐANG đăng nhập cũng mở được liên kết — và lời gọi KHÔNG mang token.
   *
   * Người gửi gần như luôn bấm thử liên kết của mình, trên chính trình duyệt
   * đang đăng nhập. Nếu trang đó gọi qua `apiClient` thì nó gắn header
   * `Authorization` của họ vào một route công khai: hai danh tính trong cùng
   * một lời gọi, và từ đó không ai biết route ấy có thật sự chạy được mà không
   * có token hay không.
   *
   * ⚠️ Khẳng định này tồn tại vì một ĐỘT BIẾN ĐI QUA được: đổi `axios` thành
   * `apiClient` trong `share/api.ts` mà ca này vẫn xanh, vì trình duyệt sạch
   * không có token nên không có gì để gắn. Phần duy nhất phân biệt được hai lựa
   * chọn là đúng dòng dưới đây.
   */
  let headerAuth: string | null | undefined;
  await page.route('**/api/public/reports/**', (route) => {
    headerAuth = route.request().headers()['authorization'] ?? null;
    void route.continue();
  });
  await page.goto(url);
  await expect(page.getByRole('heading', { name: TEN.baoCao })).toBeVisible({ timeout: 30_000 });
  expect(headerAuth, 'lời gọi công khai KHÔNG được mang token của người đang đăng nhập').toBeNull();
  await page.unroute('**/api/public/reports/**');

  // ─── Thu hồi, rồi mở lại bằng CHÍNH đường dẫn đó ──────────────────────────
  await page.goto(`/reports/${String(reportId)}`);
  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  await page.getByRole('button', { name: 'Thu hồi' }).first().click();
  await expect(page.getByText('Chưa có liên kết nào đang hoạt động.')).toBeVisible({
    timeout: 20_000,
  });

  const trangSauThuHoi = await khach.newPage();
  await trangSauThuHoi.goto(url);
  await expect(
    trangSauThuHoi.getByText(/đã bị người chia sẻ thu hồi/),
    'thu hồi rồi thì liên kết cũ phải nói đúng lý do',
  ).toBeVisible({ timeout: 30_000 });

  await khach.close();
});
