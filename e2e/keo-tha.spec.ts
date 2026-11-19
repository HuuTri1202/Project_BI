import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  CANVAS_DATA_409_CHU_DICH,
  O_BAN_DAU,
  dangNhap,
  docToaDoO,
  dungKhungMau,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình xương sống #6: KÉO một ô trên khung, và chỗ nó đáp lại được lưu.
 *
 * ═══ Đây là hình học, nên nó cần một trình duyệt có hình ════════════════════
 *
 * `CanvasBoard` không dùng HTML5 drag-and-drop. Nó dùng Pointer Events với
 * `setPointerCapture`, đọc toạ độ con trỏ ở TỪNG khung hình, ghi thẳng vào
 * `el.style` trong `requestAnimationFrame`, và chỉ ghi vào state React MỘT lần
 * lúc thả tay. Không mảnh nào của việc đó tồn tại trong jsdom: không có layout
 * nên `getBoundingClientRect` trả về số 0, và bước quy về ô lưới chia cho bề
 * ngang khung — chia cho 0.
 *
 * Nói cách khác: toàn bộ §10.20 ("cải thiện độ mượt mà khi thao tác") là mã
 * CHƯA TỪNG chạy trong bất kỳ ca test nào trước ca này.
 *
 * ═══ Hai khẳng định, và cái thứ nhất là cái dễ mất ══════════════════════════
 *
 *   1. VÙNG CHẾT: kéo 2px thì KHÔNG được đổi gì. `DRAG_DEAD_ZONE_PX = 3` có mặt
 *      vì một cú bấm vào dải tiêu đề luôn kèm vài pixel rung tay, và không có
 *      nó thì mỗi lần chọn một ô là một bước hoàn tác rác. Đây là loại hành vi
 *      lặng lẽ mất đi trong một lần refactor mà không test nào kêu.
 *   2. CÚ KÉO THẬT: ô phải đáp xuống ĐÚNG ô lưới đã tính trước, và bấm Lưu thì
 *      toạ độ đó phải nằm trong database — kiểm bằng cách đọc lại qua API, chứ
 *      không bằng cách đọc lại DOM vừa tự mình kéo.
 */

/** Tên RIÊNG của ca này — xem ghi chú ở `dungBaoCaoMau`. */
const TEN = { bo: 'e2e-keo-tha', baoCao: 'e2e Khung hai ô' };

/**
 * Khung CỬA SỔ cao, để khung soạn thảo KHÔNG CUỘN ĐƯỢC — và đây là điều kiện
 * đúng đắn của ca này, không phải một mẹo cho qua.
 *
 * ⚠️ `onGrabMove` lưu `startScrollTop` và quãng đường của ô = quãng con trỏ CỘNG
 * độ cuộn đã thay đổi (có chủ ý: cuộn bằng con lăn giữa lúc kéo thì con trỏ đứng
 * yên nhưng khung chạy dưới nó). Hệ quả: nếu khung cuộn giữa cú kéo, ô đi xa hơn
 * con trỏ — và tui đã gặp đúng chuyện đó: cùng một mã cho `y = 14` ở lượt này và
 * `y = 9` ở lượt sau, vì độ cuộn phụ thuộc thời gian.
 *
 * Sửa bằng cách bỏ biến số đó đi: cửa sổ đủ cao để cả khung nằm trong tầm, rồi
 * KHẲNG ĐỊNH `scrollTop === 0` sau cú kéo. Ngày nào khung cuộn thật, ca này nói
 * ra chỗ đó chứ không đỏ bằng một con số lệch.
 */
test.use({ viewport: { width: 1440, height: 1100 } });

/** Số hàng lưới cần kéo xuống. 4 hàng: đủ xa để thấy rõ, đủ gần để không cuộn. */
const HANG_KEO = 4;

/**
 * Bước lưới ĐO TỪ TRANG, không nhập từ hằng số.
 *
 * ⚠️ Bản đầu của tui kéo `HANG_KEO * CANVAS_ROW_HEIGHT` = 352px và ca đỏ với
 * "Expected 8, Received 6": bước hàng là `CANVAS_ROW_HEIGHT + CANVAS_GAP`, không
 * phải `CANVAS_ROW_HEIGHT`. Bỏ quên khoảng hở thì kéo 8 hàng chỉ đi được 6.
 *
 * Nhưng `CANVAS_GAP` nằm ở `frontend/src/features/reports/canvasLayout.ts`, một
 * module React — kéo nó vào bộ e2e là kéo theo cả cây import của frontend. Và
 * nhập hằng số cũng là cách sai về nguyên tắc: ca này phải đo HÌNH HỌC MÀ CON
 * TRỎ ĐI QUA, không phải đồng ý với công thức của sản phẩm.
 *
 * Hai ô cạnh nhau cho đủ dữ kiện, thuần đại số trên số đo thật:
 *
 *   dx = xPhai - xTrai = 6 * (cột + hở)      (hai ô cùng y, mỗi ô w = 6)
 *   rộng = 6 * cột + 5 * hở
 *   => hở = dx - rộng
 *
 *   cao = h * HÀNG + (h - 1) * hở = h * bước - hở
 *   => bước = (cao + hở) / h
 */
async function doBuocHang(oTrai: Locator, oPhai: Locator): Promise<number> {
  const a = await oTrai.boundingBox();
  const b = await oPhai.boundingBox();
  expect(a, 'phải đo được ô bên trái').not.toBeNull();
  expect(b, 'phải đo được ô bên phải').not.toBeNull();
  const t = a as { x: number; width: number; height: number };
  const ho = (b as { x: number }).x - t.x - t.width;
  return (t.height + ho) / O_BAN_DAU.trai.h;
}

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

/**
 * Kéo dải tiêu đề của một ô đi `dx`/`dy` pixel, bằng con trỏ THẬT.
 *
 * Đi nhiều chặng chứ không một bước: `onGrabMove` chỉ bắt đầu kéo sau khi vượt
 * vùng chết, và cú kéo đọc toạ độ ở từng `pointermove`. Một bước nhảy duy nhất
 * vẫn hoạt động nhưng không giống thao tác thật, và nó bỏ qua đúng đoạn mã
 * `requestAnimationFrame` mà ca này có mặt để kiểm.
 */
async function keo(
  page: Page,
  o: Locator,
  dx: number,
  dy: number,
  /** Chạy SAU chặng đầu, tức là lúc cú kéo chắc chắn đã bắt đầu. */
  giuaDuong?: () => Promise<void>,
): Promise<void> {
  const dai = o.locator('header');
  const hop = await dai.boundingBox();
  expect(hop, 'phải đo được dải tiêu đề của ô').not.toBeNull();
  const h = hop as { x: number; y: number; width: number; height: number };

  const x0 = h.x + h.width / 2;
  const y0 = h.y + h.height / 2;

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(x0 + (dx * i) / 10, y0 + (dy * i) / 10);
    if (i === 1 && giuaDuong !== undefined) await giuaDuong();
  }
  await page.mouse.up();
}

test('kéo một ô trên khung: vùng chết không đổi gì, cú kéo thật lưu đúng ô lưới', async ({
  page,
  request,
}) => {
  // Bệ đỡ dài: bộ dữ liệu -> nạp ClickHouse -> mô hình -> thước đo -> khung.
  test.setTimeout(150_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const khung = await dungKhungMau(request, token, TEN);

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(khung.reportId)}/edit`);

  const oTrai = page.getByRole('region', { name: `Ô biểu đồ: ${khung.tieuDe.trai}` });
  await expect(oTrai, 'trình dựng phải mở ra với hai ô đã đặt sẵn').toBeVisible({
    timeout: 30_000,
  });
  const oPhai = page.getByRole('region', { name: `Ô biểu đồ: ${khung.tieuDe.phai}` });
  await expect(oPhai).toBeVisible();

  // ─── 1. Vùng chết: 2px thì không có gì xảy ra ─────────────────────────────

  /*
   * Hai dụng cụ đo, và tui đã thử SAI hai lần trước khi tìm ra chúng — cả hai
   * lần sai đều ghi lại ở đây vì cả hai nghe rất hợp lý:
   *
   *   · `expect(nút Lưu).toBeDisabled()` với lập luận "chưa thay đổi thì chưa
   *     lưu được" — SAI: nút Lưu BẬT SẴN từ lúc mở trình dựng, và hợp lý thôi,
   *     người dùng mở báo cáo rồi bấm Lưu để đổi tên. Nó không theo dõi bố cục.
   *   · `expect(nút Hoàn tác).toBeDisabled()` sau cú kéo 2px — đúng nhưng KHÔNG
   *     đo vùng chết: đột biến `DRAG_DEAD_ZONE_PX = 0` vẫn cho ca xanh. Vì có
   *     HAI lớp chắn, và lớp thứ hai (`sameBox` — quy về đúng ô lưới cũ thì
   *     không ghi) một mình đã giữ lịch sử sạch.
   *
   * Vậy nên:
   *
   *   `[data-drag-ghost]` đo ĐÚNG vùng chết. Vượt ngưỡng là `ghost.hidden =
   *   false` ngay trong `paint()`, không qua React — và đó là hệ quả duy nhất
   *   của `DRAG_DEAD_ZONE_PX` mà người dùng thấy được.
   *
   *   Nút Hoàn tác đo lời hứa Ở MỨC NGƯỜI DÙNG: một cú bấm kèm rung tay không
   *   để lại bước hoàn tác rác. Nó không ghim được hằng số, và sau khi đo thì
   *   tui giữ nó đúng với nghĩa đó chứ không gọi nó là ca kiểm vùng chết.
   *
   * Cả hai đều không đọc `el.style`: với cú kéo 2px, ô quy về ĐÚNG ô lưới cũ nên
   * vị trí cuối giống nhau dù vùng chết có hoạt động hay không.
   */
  const nutHoanTac = page.getByRole('button', { name: 'Hoàn tác (Ctrl+Z)' });
  const bongKeo = page.locator('[data-drag-ghost]');
  await expect(nutHoanTac, 'vừa mở trình dựng thì chưa có gì để hoàn tác').toBeDisabled();

  const dai = await oTrai.locator('header').boundingBox();
  expect(dai, 'phải đo được dải tiêu đề').not.toBeNull();
  const d = dai as { x: number; y: number; width: number; height: number };
  const cx = d.x + d.width / 2;
  const cy = d.y + d.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // `Math.hypot(2, 2) = 2,83 < 3` — vẫn trong vùng chết.
  await page.mouse.move(cx + 2, cy + 2);
  await expect(
    bongKeo,
    'kéo 2px (dưới DRAG_DEAD_ZONE_PX = 3) chưa được coi là một cú kéo',
  ).toBeHidden();
  await page.mouse.up();

  await expect(
    nutHoanTac,
    'một cú bấm kèm rung tay không được để lại một bước hoàn tác rác',
  ).toBeDisabled();

  // ─── 2. Cú kéo thật ──────────────────────────────────────────────────────

  const buoc = await doBuocHang(oTrai, oPhai);
  await keo(page, oTrai, 0, HANG_KEO * buoc, async () => {
    // Chiều NGƯỢC của khẳng định trên: vượt vùng chết thì khung nét đứt bật lên,
    // báo trước ô lưới hộp sẽ đáp xuống. Chỉ thấy được GIỮA cú kéo — thả tay ra
    // là nó ẩn lại, nên không có cách nào kiểm nó sau khi xong.
    await expect(bongKeo, 'vượt vùng chết thì khung nét đứt phải bật lên').toBeVisible();
  });

  // Bất biến của ca này — xem `test.use` ở đầu tệp.
  expect(
    await page.evaluate(() => document.querySelector('[data-canvas-scroller]')?.scrollTop ?? -1),
    'khung không được cuộn giữa cú kéo: quãng đường của ô sẽ cộng thêm độ cuộn',
  ).toBe(0);

  await expect(nutHoanTac, 'kéo thật phải ghi đúng một bước lịch sử').toBeEnabled();
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();

  /*
   * Và sự thật nằm ở DATABASE, không ở DOM.
   *
   * Đọc lại qua API: DOM vừa bị chính ca này kéo, nên đọc lại nó là tự hỏi tự
   * trả lời. `docToaDoO` đi qua `GET /reports/:id` — đúng đường mà lần mở lại
   * của người dùng sẽ đi.
   */
  await expect
    .poll(async () => (await docToaDoO(request, token, khung.reportId)).get(khung.o.trai)?.y, {
      timeout: 15_000,
      intervals: [300, 600, 1000],
    })
    .toBe(HANG_KEO);

  const sau = await docToaDoO(request, token, khung.reportId);
  const trai = sau.get(khung.o.trai);

  // Kéo DỌC, nên cột không được đổi — và bề rộng/cao cũng không.
  expect(trai?.x, 'kéo dọc không được đổi cột').toBe(O_BAN_DAU.trai.x);
  expect(trai?.w, 'di chuyển không được đổi bề rộng').toBe(O_BAN_DAU.trai.w);
  expect(trai?.h, 'di chuyển không được đổi chiều cao').toBe(O_BAN_DAU.trai.h);

  // Và ô KHÔNG bị kéo phải nằm y nguyên: một cú kéo chạm vào hai ô là lỗi.
  expect(sau.get(khung.o.phai), 'ô còn lại không được nhúc nhích').toEqual(O_BAN_DAU.phai);

  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
