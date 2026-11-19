import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { dangNhap, khongLoiNao, layToken, theoDoiLoi } from './helpers';

/**
 * Hành trình xương sống #3: báo cáo đã lưu MỞ RA LÀ VẼ ĐƯỢC.
 *
 * ═══ Đây là chỗ jsdom không thể với tới, theo nghĩa chặt nhất ═══════════════
 *
 * `chartSpec.test.ts` kiểm *đặc tả* Vega-Lite — một object JavaScript. Nó không
 * trả lời được câu duy nhất người dùng quan tâm: có hình nào hiện ra không.
 * `VegaChart.tsx` gọi `vegaEmbed` với `renderer: 'svg'`, và jsdom không có
 * layout engine nên không bao giờ dựng ra một `<svg class="marks">` có nội
 * dung. Một đặc tả đúng vẫn có thể cho ra biểu đồ trắng: sai tên cột, dữ liệu
 * rỗng vì truy vấn 400, hay `vega-embed` ném trong lúc nạp lười.
 *
 * ═══ Dựng dữ liệu bằng API, kiểm hình bằng trình duyệt ══════════════════════
 *
 * CỐ Ý không dựng báo cáo qua giao diện: việc chọn chiều/thước đo đã có 873 ca
 * jsdom phủ, và đi lại đường đó ở đây chỉ làm ca dài ra rồi hỏng vì một nhãn
 * nút bị sửa. Phần API ở đây là bệ đỡ; phần được KIỂM là chuỗi
 * ClickHouse -> API -> Vega -> SVG.
 *
 * Lần PUT lên MinIO vẫn là PUT THẬT (`request.put` vào vé đã ký), nên bệ đỡ này
 * không mô phỏng chỗ nào.
 */

const TEP = path.resolve(__dirname, '../docs/kiem-thu/du-lieu-thu/kiem-thu-ban-hang.csv');
const TEN_BO = 'e2e-bieu-do';
const TEN_BAO_CAO = 'e2e Doanh thu theo Khu vực';

/** `kiem-thu-ban-hang.csv` có 3 khu vực: Miền Bắc, Miền Trung, Miền Nam. */
const SO_KHU_VUC = 3;

const API = 'http://127.0.0.1:4000/api';

async function xoaTheoTen(request: APIRequestContext, token: string): Promise<void> {
  const auth = { Authorization: `Bearer ${token}` };

  /*
   * ⚠️ `/v1/reports` ĐÒI `workspaceId`, và thiếu nó thì phần dọn chết âm thầm.
   *
   * Bản đầu gọi `?page=1&pageSize=100` rồi `if (status !== 200) return`. Lời gọi
   * đó trả 400 `{"workspaceId":"Expected number, received nan"}`, nên nhánh
   * `return` chạy và KHÔNG xoá gì. Ba lần chạy đỏ để lại ba báo cáo, và lần thứ
   * tư đụng hạn mức gói Miễn phí (tối đa 3 báo cáo) — ca đỏ vì một lý do hoàn
   * toàn khác với thứ nó đang kiểm.
   *
   * Hai danh sách có hợp đồng KHÁC nhau: báo cáo lọc theo workspace, bộ dữ liệu
   * thì không. Nên duyệt mọi workspace cho báo cáo, và gọi một lần cho bộ dữ
   * liệu.
   */
  const ws = await request.get(`${API}/v1/workspaces`, { headers: auth });
  if (ws.status() !== 200) return;

  // Báo cáo TRƯỚC bộ dữ liệu: xoá bộ dữ liệu còn báo cáo dùng nó thì bị từ chối.
  for (const w of (await ws.json()) as { id: number }[]) {
    const bc = await request.get(
      `${API}/v1/reports?page=1&pageSize=100&workspaceId=${String(w.id)}`,
      { headers: auth },
    );
    if (bc.status() !== 200) continue;
    const { items } = (await bc.json()) as { items: { id: number; name: string }[] };
    for (const r of items.filter((x) => x.name === TEN_BAO_CAO)) {
      await request.delete(`${API}/v1/reports/${String(r.id)}`, { headers: auth });
    }
  }

  const ds = await request.get(
    `${API}/v1/datasets?page=1&pageSize=100&q=${encodeURIComponent(TEN_BO)}`,
    { headers: auth },
  );
  if (ds.status() === 200) {
    const { items } = (await ds.json()) as { items: { id: number; name: string }[] };
    for (const d of items.filter((x) => x.name === TEN_BO)) {
      await request.delete(`${API}/v1/datasets/${String(d.id)}`, { headers: auth });
    }
  }
}

/** Dọn theo TÊN, nên nó chạy đúng cả khi ca đỏ ở giữa đường. */
test.afterEach(async ({ request }) => {
  await xoaTheoTen(request, await layToken(request));
});

test('báo cáo đã lưu mở ra là Vega vẽ thật, đúng số nhóm', async ({ page, request }) => {
  // Nạp ClickHouse lần đầu phải tạo bảng; 90s là trần đã đo cho hành trình này.
  test.setTimeout(90_000);

  const token = await layToken(request);
  const auth = { Authorization: `Bearer ${token}` };
  await xoaTheoTen(request, token);

  // ─── Bệ đỡ: tệp thật -> MinIO thật -> ClickHouse thật ─────────────────────

  const ws = await request.get(`${API}/v1/workspaces`, { headers: auth });
  expect(ws.status()).toBe(200);
  // Endpoint này trả MẢNG THUẦN, không bọc `{items}` như các danh sách phân
  // trang khác — đã kiểm bằng một lời gọi thật, không suy từ tên.
  const workspaceId = ((await ws.json()) as { id: number }[])[0]?.id;
  expect(workspaceId, 'tổ chức phải có ít nhất một workspace').toBeDefined();

  const xin = await request.post(`${API}/v1/datasets/uploads`, {
    headers: auth,
    data: { workspaceId, filename: 'e2e-bieu-do.csv' },
  });
  expect(xin.status(), await xin.text()).toBe(201);
  const { datasetId, uploadUrl } = (await xin.json()) as {
    datasetId: number;
    uploadUrl: string;
  };

  // PUT THẬT vào vé đã ký — không `putForTest`, không mock.
  const put = await request.put(uploadUrl, {
    data: readFileSync(TEP),
    headers: { 'content-type': 'text/csv' },
  });
  expect(put.status(), 'PUT lên MinIO').toBeLessThan(300);

  const phanTich = await request.post(`${API}/v1/datasets/${String(datasetId)}/analyze`, {
    headers: auth,
  });
  expect(phanTich.status(), await phanTich.text()).toBe(200);
  const sheet = ((await phanTich.json()) as { sheets: { name: string }[] }).sheets[0]?.name;

  const chot = await request.post(`${API}/v1/datasets/${String(datasetId)}/commit`, {
    headers: auth,
    data: { name: TEN_BO, sheets: [sheet] },
  });
  expect(chot.status(), await chot.text()).toBe(200);

  /*
   * Chờ nạp xong bằng cách HỎI trạng thái, không bằng `waitForTimeout`.
   *
   * Nạp chạy nền (§9 ingest runner), nên không có mốc nào khác để chờ. Nếu một
   * ngày nó thôi chạy, `expect.poll` hết giờ và nói rõ trạng thái cuối nó thấy
   * — còn một lần sleep thì chỉ làm ca đỏ ở bước sau, xa nguyên nhân.
   */
  await expect
    .poll(
      async () => {
        const r = await request.get(`${API}/v1/datasets/${String(datasetId)}`, { headers: auth });
        return r.status() === 200 ? ((await r.json()) as { loadStatus: string }).loadStatus : 'lỗi';
      },
      { timeout: 45_000, intervals: [500, 1000, 2000] },
    )
    .toBe('loaded');

  // ─── Báo cáo: tạo rồi cấu hình, đúng hai lời gọi người dùng vẫn gọi ───────

  const tao = await request.post(`${API}/v1/reports`, {
    headers: auth,
    data: { datasetId, name: TEN_BAO_CAO },
  });
  expect(tao.status(), await tao.text()).toBe(201);
  const reportId = ((await tao.json()) as { id: number }).id;

  const cauHinh = await request.patch(`${API}/v1/reports/${String(reportId)}`, {
    headers: auth,
    data: {
      name: TEN_BAO_CAO,
      chartType: 'bar',
      config: { dimension: 'Khu vực', measure: 'Doanh thu', aggregate: 'sum', limit: 20 },
    },
  });
  expect(cauHinh.status(), await cauHinh.text()).toBe(200);

  // ─── Và giờ mới là phần của trình duyệt ───────────────────────────────────

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);

  // Tên báo cáo nằm trong thanh trên (`banner`) dưới dạng `<p>`, KHÔNG phải
  // `<h1>` như các trang danh sách — kiểm bằng snapshot của Playwright, không
  // suy từ các trang khác.
  // 20 giây, không phải 5 giây mặc định — xem khối "ba khẳng định này đều chờ
  // hình" ở dưới.
  await expect(page.getByRole('banner'), 'thanh trên phải mang tên báo cáo').toContainText(
    TEN_BAO_CAO,
    { timeout: 20_000 },
  );

  /*
   * `svg.marks` là thứ `vegaEmbed` dựng ra với `renderer: 'svg'`.
   *
   * Khẳng định SỐ CỘT, không chỉ khẳng định "có svg": một biểu đồ trắng cũng có
   * `<svg>`. Ba khu vực trong tệp mẫu -> ba hình chữ nhật mang dữ liệu. Vega
   * còn vẽ `rect` cho nền và vùng vẽ, nên đếm trong nhóm `mark-rect`.
   */
  const marks = page.locator('svg.marks');
  await expect(marks).toBeVisible({ timeout: 20_000 });

  const cot = marks.locator('g.mark-rect path, g.mark-rect rect');
  await expect(cot).toHaveCount(SO_KHU_VUC);

  /*
   * Nhãn trục phải là dữ liệu THẬT, không phải chỗ giữ chỗ.
   *
   * ⚠️ Ba khẳng định `toContainText` của ca này đều mang trần 20 giây, và lý do
   * là một lần đỏ ~50% tui đã đi tìm:
   *
   *   · triệu chứng: `Error: expect(locator).toContainText(expected) failed`,
   *     đỏ ở 2 trong 7 lượt chạy cả bộ, xanh cả hai lượt chạy riêng;
   *   · ảnh snapshot lúc đỏ cho thấy biểu đồ ĐÃ vẽ xong, đủ ba nhãn và đúng số
   *     liệu (9.482.000 / 8.462.000 / 7.102.000 khớp từng đồng với tệp CSV) —
   *     tức là trạng thái đúng tới MUỘN hơn trần, không phải không tới;
   *   · giả thiết đầu của tui — "nhãn tới sau lúc `svg.marks` visible" — ĐÃ BỊ
   *     BÁC: bóp trần xuống 1 giây vẫn xanh, nên bình thường nhãn tới gần như
   *     tức thì.
   *
   * Nên nguyên nhân là một lần ĐỨNG hiếm trên đường nạp, và nghi phạm đã đo
   * được: cả bộ chạy với Vite LẠNH (`netstat` xác nhận 5173 không listening
   * giữa các lượt, `reuseExistingServer` không có gì để dùng lại), nên lần đầu
   * vào trang báo cáo Vite phải biên dịch tại chỗ cả cây vega/vega-lite. Trần 5
   * giây mặc định là con số của Playwright, không phải con số của việc này.
   *
   * KHÔNG dùng `test.slow()` hay nâng trần cả ca: chỗ cần nới là đúng ba khẳng
   * định chờ hình. Và mỗi cái mang một CÂU — lần đỏ đầu chỉ nói
   * "toContainText failed" cho ba khẳng định giống nhau, nên tui mất một lượt
   * chạy chỉ để biết cái nào.
   */
  await expect(marks, 'nhãn trục phải có "Miền Bắc" từ dữ liệu thật').toContainText('Miền Bắc', {
    timeout: 20_000,
  });
  await expect(marks, 'nhãn trục phải có "Miền Nam" từ dữ liệu thật').toContainText('Miền Nam', {
    timeout: 20_000,
  });

  /*
   * `canvas-data` ăn 409 ở đây là CHỦ ĐÍCH của sản phẩm, không phải lỗi.
   *
   * `ReportViewPage` cố ý bắn `useReportCanvasData(id, null)` NGAY khi vào
   * trang, trước khi biết báo cáo thuộc nhánh nào, để hai request không xếp
   * hàng sau nhau. Ghi chú ở đó đo được: `GET /reports/:id` xong ở 360ms,
   * `canvas-data` xong ở 1109ms nhưng chỉ bắt đầu lúc 360ms — nổ cùng lúc thì
   * phần chờ chỉ còn cái dài hơn. Báo cáo MỘT biểu đồ (§7.6) như ca này không
   * có khung, nên lời gọi đó bị từ chối; 4xx không được thử lại và không ai đọc
   * kết quả.
   *
   * Ca này tìm ra nó rồi tui đi đọc mã: nó đã được ghi chú hẳn một đoạn. Nên
   * chỗ đúng để sửa là KHẲNG ĐỊNH, không phải sản phẩm. Mẫu hẹp đúng một
   * endpoint — không mở rộng thành "bỏ qua mọi 409".
   */
  khongLoiNao(theoDoi, [/409 GET \S+\/reports\/\d+\/canvas-data/]);
});
