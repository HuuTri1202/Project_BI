import { expect, test } from '@playwright/test';

import { API, TAI_KHOAN, dangNhap, dungKhungMau, layToken, xoaBaoCaoVaBoTheoTen } from './helpers';

/**
 * Hành trình #12: đặt lịch gửi báo cáo định kỳ — mong muốn D6.
 *
 * ═══ Vì sao ca này ở trình duyệt, khi đã có 11 ca tích hợp ═════════════════
 *
 * Bộ `reportSchedule.integration.test.ts` canh luật người nhận, quyền, luật
 * chéo của tần suất, và một lượt gửi thật với mailer giả. Thứ nó không với tới
 * được là phần người dùng thật đi qua: ba ô chọn ở hộp thoại có gửi lên đúng
 * `tanSuat`/`thu`/`gio` không, và câu lỗi "chỉ gửi cho thành viên" có HIỆN RA
 * cho họ đọc không — đó là câu duy nhất giải thích vì sao địa chỉ của kế toán
 * thuê ngoài bị từ chối.
 */

const TEN = { bo: 'e2e-dinh-ky', baoCao: 'e2e Khung dinh ky' };

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('đặt lịch sáng thứ Hai, và người ngoài tổ chức bị từ chối kèm lý do', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const { reportId } = await dungKhungMau(request, token, TEN);

  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);
  await page.getByRole('button', { name: 'Gửi định kỳ' }).click();

  const hop = page.getByRole('dialog');
  await expect(hop.getByText('Gửi báo cáo định kỳ qua email')).toBeVisible({ timeout: 20_000 });

  /*
   * Người NGOÀI tổ chức trước: đây là luật an toàn của D6, và người dùng phải
   * đọc được lý do chứ không chỉ thấy một cú bấm không có gì xảy ra.
   */
  await hop.getByRole('textbox').fill('nguoi.la@gmail.com');
  await hop.getByRole('button', { name: 'Đặt lịch' }).click();
  const canhBao = hop.getByRole('alert');
  await expect(canhBao).toContainText('nguoi.la@gmail.com', { timeout: 20_000 });
  await expect(canhBao, 'phải chỉ đường đi đúng cho người ngoài tổ chức').toContainText(
    'Chia sẻ bằng liên kết',
  );

  // Và giờ là lịch thật: mặc định đã là "hằng tuần, Thứ Hai, 08:00".
  await hop.getByRole('textbox').fill(TAI_KHOAN.email);
  await hop.getByRole('button', { name: 'Đặt lịch' }).click();

  await expect(hop.getByText(/Hằng tuần, Thứ Hai lúc 08:00/)).toBeVisible({ timeout: 20_000 });
  await expect(hop.getByText(TAI_KHOAN.email)).toBeVisible();

  /*
   * Mốc gửi kế tiếp phải ở TƯƠNG LAI và đúng 8 giờ sáng giờ Việt Nam. Đọc qua
   * API vì màn hình hiện nó theo định dạng địa phương, còn thứ cần khẳng định
   * là con số đã lưu.
   */
  const res = await request.get(`${API}/v1/reports/${String(reportId)}/schedules`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const { items } = (await res.json()) as {
    items: { tanSuat: string; thu: number; gio: number; nextRunAt: string; isActive: boolean }[];
  };
  expect(items).toHaveLength(1);
  expect(items[0]?.tanSuat).toBe('hang-tuan');
  expect(items[0]?.thu).toBe(1);
  expect(items[0]?.gio).toBe(8);
  expect(items[0]?.isActive).toBe(true);

  const moc = new Date(items[0]?.nextRunAt ?? '');
  expect(moc.getTime()).toBeGreaterThan(Date.now());
  // 8 giờ Việt Nam = 1 giờ UTC. Đây là chỗ một lỗi múi giờ sẽ hiện ra.
  expect(moc.getUTCHours(), 'mốc phải là 01:00 UTC, tức 08:00 giờ Việt Nam').toBe(1);
  expect(moc.getUTCDay(), 'và phải là thứ Hai').toBe(1);

  // Tắt được, và trạng thái đổi trên màn hình.
  await hop.getByRole('button', { name: 'Tắt' }).click();
  await expect(hop.getByText('đang tắt')).toBeVisible({ timeout: 20_000 });
});
