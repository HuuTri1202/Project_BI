import { expect, test, type Download } from '@playwright/test';

import {
  CANVAS_DATA_409_CHU_DICH,
  DOANH_THU_MAU,
  dangNhap,
  dungBaoCaoMau,
  khongLoiNao,
  layToken,
  theoDoiLoi,
  xoaBaoCaoVaBoTheoTen,
} from './helpers';

/**
 * Hành trình xương sống #5: bấm Xuất và một TỆP THẬT rơi xuống đĩa.
 *
 * ═══ Chỗ này jsdom không chỉ khó — nó không có khái niệm ════════════════════
 *
 * Toàn bộ việc xuất chạy TRONG trình duyệt, và từng mảnh của nó đều là thứ
 * jsdom thiếu:
 *
 *   · `modern-screenshot` tuần tự hoá DOM vào một `<foreignObject>` rồi rasterise
 *     qua `<canvas>`. jsdom không có layout engine và không có canvas vẽ được,
 *     nên đoạn này chưa từng chạy một lần nào trong 873 ca frontend;
 *   · `taiXuong()` tạo một `<a download>` rồi `click()`. Trong jsdom đó là một
 *     lời gọi không làm gì;
 *   · và câu hỏi cuối cùng — tệp có MỞ ĐƯỢC không — chỉ trả lời được trên tệp
 *     đã nằm trên đĩa.
 *
 * ═══ Ba khẳng định, ba câu hỏi khác nhau ════════════════════════════════════
 *
 *   PNG    có phải ảnh thật, đúng cỡ, và KHÔNG TRẮNG
 *   PDF    có phải PDF thật
 *   Excel  có mang ĐÚNG SỐ không — đọc ngược bằng `exceljs`
 *
 * Khẳng định cuối là khẳng định đáng giá nhất của cả ca. `xlsx.ts` tự ghi OOXML
 * bằng tay và đã có ca jsdom đọc ngược bằng `exceljs`, nhưng ca đó dựng blob từ
 * dữ liệu đặt sẵn — nó kiểm BỘ GHI. Ở đây dữ liệu do trình duyệt tự đi lấy
 * (`fetchReportCanvasData` / `fetchReportData`), nên nếu bước lấy số trả về rỗng
 * thì bộ ghi vẫn sinh ra một tệp Excel hoàn toàn hợp lệ và hoàn toàn trống.
 */

/** Tên RIÊNG của ca này — xem ghi chú ở `dungBaoCaoMau`. */
const TEN = { bo: 'e2e-xuat-tep', baoCao: 'e2e Xuất Doanh thu theo Khu vực' };

test.afterEach(async ({ request }) => {
  await xoaBaoCaoVaBoTheoTen(request, await layToken(request), TEN);
});

test('bấm Xuất: PNG không trắng, PDF mở được, và Excel mang đúng số', async ({ page, request }) => {
  // Nạp ClickHouse lần đầu phải tạo bảng, rồi ba lần xuất nối nhau.
  test.setTimeout(120_000);

  const token = await layToken(request);
  await xoaBaoCaoVaBoTheoTen(request, token, TEN);
  const { reportId } = await dungBaoCaoMau(request, token, TEN);

  const theoDoi = theoDoiLoi(page);
  await dangNhap(page);
  await page.goto(`/reports/${String(reportId)}`);

  // Chờ biểu đồ vẽ xong TRƯỚC khi xuất: `modern-screenshot` chụp những gì đang
  // có trên màn hình, nên xuất sớm là xuất một khung trống — và ảnh đó vẫn là
  // một PNG hợp lệ.
  await expect(page.locator('svg.marks')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('svg.marks'), 'phải có số liệu thật trước khi chụp').toContainText(
    'Miền Bắc',
    { timeout: 20_000 },
  );

  /**
   * Mở menu Xuất rồi bấm một định dạng, và trả về tệp đã tải.
   *
   * ⚠️ `waitForEvent('download')` phải được GƯƠNG LÊN TRƯỚC cú bấm. Đặt sau thì
   * tệp nhỏ tải xong trước lúc ta bắt đầu nghe, và ca treo tới hết giờ — cùng
   * lớp lỗi với `waitForResponse` ở `tai-tep.spec.ts`.
   *
   * Menu đóng lại sau mỗi lần xuất, nên mỗi định dạng mở lại một lần.
   */
  async function xuat(nhan: string, giay = 60): Promise<Download> {
    await page.getByRole('button', { name: 'Xuất' }).click();
    const cho = page.waitForEvent('download', { timeout: giay * 1000 });
    await page.getByRole('menuitem', { name: nhan }).click();
    return cho;
  }

  // ─── PNG: ảnh thật, đúng cỡ, và không trắng ───────────────────────────────

  const png = await xuat('Ảnh PNG');
  expect(png.suggestedFilename(), 'tên tệp lấy từ tên báo cáo').toContain(TEN.baoCao);
  expect(png.suggestedFilename()).toMatch(/\.png$/);

  const duongDanPng = await png.path();
  const bytePng = (await import('node:fs')).readFileSync(duongDanPng);

  // Chữ ký PNG theo chuẩn: 8 byte đầu là cố định.
  expect(
    bytePng.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'tám byte đầu phải là chữ ký PNG',
  ).toBe(true);

  /*
   * Cỡ ảnh đọc từ IHDR — khối đầu tiên, luôn ở offset 16 (big-endian).
   *
   * Đây là chỗ một ảnh HỎNG vẫn qua được bước chữ ký: `modern-screenshot` trả
   * về ảnh 0x0 nếu vùng được chụp chưa có kích thước, và tệp đó vẫn là một PNG
   * đúng chuẩn.
   */
  const rong = bytePng.readUInt32BE(16);
  const cao = bytePng.readUInt32BE(20);
  expect(rong, 'ảnh phải rộng bằng khung báo cáo thật').toBeGreaterThan(400);
  expect(cao, 'ảnh phải cao bằng khung báo cáo thật').toBeGreaterThan(200);

  /*
   * Và trong ảnh phải CÓ BIỂU ĐỒ — đếm điểm ảnh mang đúng MÀU CỘT.
   *
   * ⚠️ Ba thước đo trước đó của tui đều bị chính số đo bác bỏ, và chúng đáng ghi
   * lại vì cả ba đều "nghe có lý":
   *
   *   · `bytePng.length > 20_000` với lý lẽ "ảnh một màu nén xuống vài KB" —
   *     SAI: một PNG trắng trơn 2144x1552 do bộ mã hoá của Chromium sinh ra
   *     nặng 69.979 byte; nó không tối ưu bộ lọc dòng;
   *   · "tỉ lệ điểm không-trắng" — SAI: nền trang là slate-50 (`#f8fafc`, R=248)
   *     nên MỌI điểm nền đều không-trắng, và một ảnh trắng cho tỉ lệ 1,0;
   *   · "số màu phân biệt > 50" — SAI: một khung không có nội dung vẫn cho 355
   *     màu, vì viền, bóng đổ và chữ chống răng cưa.
   *
   * Thước đúng là thước TRỰC TIẾP: màu cột đọc từ chính `<svg>` đang hiển thị,
   * rồi đếm điểm ảnh mang màu đó trong tệp vừa tải. Và lần này hai đầu tách hẳn
   * nhau: ảnh thật cho 916.757 điểm, còn đột biến `g.mark-rect { display: none }`
   * — bỏ ĐÚNG ba cột và giữ nguyên mọi thứ khác — cho 0. Trần 5.000 nằm giữa hai
   * con số cách nhau năm bậc độ lớn, nên nó không phải một ngưỡng phải canh.
   *
   * Dùng CHÍNH TRÌNH DUYỆT làm bộ giải mã PNG: Node không có sẵn, và viết một
   * bộ un-filter scanline chỉ để đếm điểm ảnh là nhiều mã hơn thứ đang kiểm.
   */
  const mauCot = await page.evaluate(() => {
    const el = document.querySelector('g.mark-rect path, g.mark-rect rect');
    return el === null ? null : getComputedStyle(el).fill;
  });
  expect(mauCot, 'phải đọc được màu cột từ SVG đang hiển thị').toMatch(/^rgb/);

  const soDiemCot = await page.evaluate(
    async ([b64, mau]) => {
      const rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(mau as string);
      if (rgb === null) return -1;
      const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

      const img = new Image();
      img.src = `data:image/png;base64,${b64 as string}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (ctx === null) return -1;
      ctx.drawImage(img, 0, 0);

      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dem = 0;
      // Sai số 6 cho mỗi kênh: PNG ở đây không mất mát, nhưng vùng biên cột bị
      // chống răng cưa nên không đòi khớp từng byte.
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs((d[i] ?? 0) - r) <= 6 &&
          Math.abs((d[i + 1] ?? 0) - g) <= 6 &&
          Math.abs((d[i + 2] ?? 0) - b) <= 6
        ) {
          dem += 1;
        }
      }
      return dem;
    },
    [bytePng.toString('base64'), mauCot] as const,
  );

  expect(soDiemCot, 'ba cột của biểu đồ phải nằm trong ảnh').toBeGreaterThan(5_000);

  // ─── PDF: tệp thật ────────────────────────────────────────────────────────

  const pdf = await xuat('Tệp PDF');
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytePdf = (await import('node:fs')).readFileSync(await pdf.path());
  expect(bytePdf.subarray(0, 5).toString('latin1'), 'năm byte đầu của một PDF').toBe('%PDF-');
  /*
   * Với PDF chỉ kiểm tới đây, và nói rõ vì sao chứ không làm như đã kiểm hết.
   *
   * `pdfAnh.ts` nhúng CHÍNH tấm ảnh mà nhánh PNG ở trên vừa đếm từng điểm, nên
   * câu "ảnh có nội dung không" đã được trả lời ở đó — hỏi lại ở đây cần một bộ
   * giải nén luồng PDF, nhiều mã hơn thứ nó kiểm. Còn 20 KB thì chỉ nói "không
   * phải một PDF rỗng": tệp thật đo được 76.902 byte.
   */
  expect(bytePdf.length, 'PDF phải mang ảnh bên trong, không phải một trang rỗng').toBeGreaterThan(
    20_000,
  );

  // ─── Excel: đọc NGƯỢC bằng exceljs và so từng con số ──────────────────────

  const xlsx = await xuat('Bảng tính Excel');
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);

  /*
   * `exceljs` đã có trong `node_modules` của repo (backend dùng để nhập tệp),
   * nên đọc ngược ở đây không thêm phụ thuộc nào — và đây chính là lập luận
   * `xlsx.ts` ghi trong docblock của nó: "đọc được bằng một bộ đọc thật thì
   * Excel cũng mở được".
   */
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xlsx.path());

  const sheet = wb.worksheets[0];
  expect(sheet, 'tệp Excel phải có ít nhất một sheet').toBeDefined();

  /*
   * Gom mọi ô của sheet thành một bảng nhãn -> số.
   *
   * Không đoán ô nào ở đâu: bố cục sheet (có dòng tiêu đề hay không, cột nào
   * trước) là chuyện của `excelBaoCao.ts` và nó được phép đổi. Thứ KHÔNG được
   * phép đổi là ba cặp số này có mặt trong tệp.
   */
  const bang = new Map<string, number>();
  sheet?.eachRow((row) => {
    const o = row.values as unknown[];
    const nhan = typeof o[1] === 'string' ? o[1] : null;
    const so = typeof o[2] === 'number' ? o[2] : null;
    if (nhan !== null && so !== null) bang.set(nhan, so);
  });

  for (const [khuVuc, tong] of Object.entries(DOANH_THU_MAU)) {
    expect(bang.get(khuVuc), `Excel phải mang đúng doanh thu của ${khuVuc}`).toBe(tong);
  }

  // Cùng lý do với ca `bieu-do` — xem docblock của hằng trong `helpers.ts`.
  khongLoiNao(theoDoi, [CANVAS_DATA_409_CHU_DICH]);
});
