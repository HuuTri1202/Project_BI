import { expect, test } from '@playwright/test';

import { dangNhap, khongLoiNao, theoDoiLoi } from './helpers';

/**
 * Hành trình xương sống #1: đăng nhập, và chunk nạp lười thật sự tải được.
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
 * Ca này chỉ ĐỌC, nên không cần dọn.
 */

test('đăng nhập -> trang chủ, và khung hỏi đáp nạp lười tải được', async ({ page }) => {
  const theoDoi = theoDoiLoi(page);

  await dangNhap(page);

  /*
   * Khung hỏi đáp: `NguCanhProvider` nạp lười nó, nên cái nút này chỉ xuất hiện
   * SAU khi trình duyệt tải xong một chunk riêng. Nó có mặt = chia chunk đúng.
   */
  const moKhung = page.getByRole('button', { name: 'Mở khung hỏi đáp về dữ liệu đang xem' });
  await expect(moKhung).toBeVisible();

  /*
   * Đặt ba người CHỜ TRƯỚC khi bấm, rồi mới bấm.
   *
   * ⚠️ Bản đầu của ca này khẳng định `xau` ngay sau khi panel hiện ra, và nó
   * XANH GIẢ: panel hiện trước, ba truy vấn ngữ cảnh về sau, nên lúc khẳng định
   * thì `xau` còn rỗng. Đột biến chứng minh: đặt lại `pageSize = 200` (đúng lỗi
   * ca này tìm ra) mà ca vẫn xanh.
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
  await moKhung.click();
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

  khongLoiNao(theoDoi);
});
