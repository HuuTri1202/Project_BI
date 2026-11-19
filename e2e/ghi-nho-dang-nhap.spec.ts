import { expect, test } from '@playwright/test';

import { TAI_KHOAN } from './helpers';

/**
 * Hành trình #10: "Ghi nhớ đăng nhập trên máy này" — mong muốn D7.
 *
 * ═══ Vì sao PHẢI là trình duyệt thật, và là HAI context ════════════════════
 *
 * Luật "đóng app là hết phiên" đứng trên ba thứ của trình duyệt mà jsdom không
 * có: `sessionStorage` chết theo TAB, Web Locks nhả khi tab đóng, và
 * `localStorage` sống qua cả lần đóng trình duyệt. `appSession.test.ts` kiểm
 * luật đó bằng ba bản giả — nó không trả lời được câu "trình duyệt thật có hành
 * xử như ba bản giả ấy không".
 *
 * Mở một context thứ hai từ `storageState` của context đầu là mô phỏng ĐÚNG lần
 * đóng trình duyệt: Playwright chỉ chép `localStorage` (và cookie), không chép
 * `sessionStorage`, nên tab mới không có dấu tab và không có khoá nào đang giữ —
 * y hệt tình huống mà luật kia được viết ra để xử lý.
 *
 * Hai chiều, và cả hai đều cần: tích thì giữ phiên, không tích thì mất phiên.
 * Sửa lệch một chiều là bỏ luôn lớp bảo vệ cho máy dùng chung.
 */

async function dangNhapCo(page: import('@playwright/test').Page, ghiNho: boolean): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TAI_KHOAN.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(TAI_KHOAN.matKhau);
  if (ghiNho) {
    await page.getByRole('checkbox', { name: /Ghi nhớ đăng nhập trên máy này/ }).check();
  }
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào');
}

test('tích ghi nhớ -> mở lại trình duyệt vẫn còn phiên', async ({ browser }) => {
  const dau = await browser.newContext();
  const trang = await dau.newPage();
  await dangNhapCo(trang, true);

  // Ảnh trạng thái CHỈ gồm localStorage + cookie, đúng những gì sống qua lần
  // đóng trình duyệt.
  const anh = await dau.storageState();
  await dau.close();

  const sau = await browser.newContext({ storageState: anh });
  const trangMoi = await sau.newPage();
  await trangMoi.goto('/');

  await expect(
    trangMoi.getByRole('heading', { level: 1 }),
    'đã tích ghi nhớ thì mở lại phải vào thẳng trang chủ',
  ).toContainText('Xin chào', { timeout: 20_000 });
  await sau.close();
});

test('KHÔNG tích -> mở lại trình duyệt là về trang đăng nhập', async ({ browser }) => {
  const dau = await browser.newContext();
  const trang = await dau.newPage();
  await dangNhapCo(trang, false);

  const anh = await dau.storageState();
  await dau.close();

  const sau = await browser.newContext({ storageState: anh });
  const trangMoi = await sau.newPage();
  await trangMoi.goto('/');

  // Luật cũ vẫn nguyên: trên máy dùng chung, người ngồi sau không vào thẳng
  // tài khoản của người ngồi trước.
  await expect(trangMoi, 'không tích thì phải quay về trang đăng nhập').toHaveURL(/\/login/, {
    timeout: 20_000,
  });
  await sau.close();
});
