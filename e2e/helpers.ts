import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, type APIRequestContext } from '@playwright/test';

/** Tài khoản của `docs/tai-khoan-thu-nghiem.md` — admin của Công ty Ánh Dương. */
export const TAI_KHOAN = { email: 'mai@anhduong.vn', matKhau: 'Matkhau@123' };

/**
 * Tiếng ồn của Google Sign-In, bỏ qua CÓ CHỦ ĐÍCH — và đây là một quan sát thật.
 *
 * Trên `http://localhost:5173`, nút Google (§1.9) trả 403 kèm
 * `[GSI_LOGGER]: The given origin is not allowed for the given client ID`:
 * origin này chưa nằm trong danh sách cho phép của client ID. Đó là cấu hình ở
 * Google Cloud Console, KHÔNG phải mã của dự án — đăng nhập bằng mật khẩu không
 * bị ảnh hưởng.
 *
 * Lọc theo HOST của bên thứ ba, không lọc theo câu chữ của lỗi: lọc theo câu
 * chữ sẽ lặng lẽ che cả lỗi của ta nếu câu chữ tình cờ giống.
 */
export const BEN_THU_BA = /accounts\.google\.com|GSI_LOGGER/;

/**
 * `Failed to load resource` bị bỏ qua ở kênh CONSOLE — và đó không phải nhượng bộ.
 *
 * Trình duyệt ghi câu này KHÔNG KÈM URL, nên nó không gán được cho origin nào:
 * dùng nó để phán xét thì hoặc che cả lỗi của ta, hoặc đỏ vì một 403 của
 * Google. Lỗi mạng đã có dụng cụ ĐÚNG là `theoDoiLoi().xau` — nó đọc `response`
 * nên biết chính xác host và mã. Kênh console để dành cho lỗi RUNTIME.
 */
const KHONG_GAN_DUOC_ORIGIN = /Failed to load resource/;

/**
 * Thu lỗi runtime và request hỏng CỦA CHÍNH TA, trong suốt một ca.
 *
 * Gắn TRƯỚC khi điều hướng. Đây là nửa giá trị của mỗi ca e2e: một chunk 404,
 * một biến undefined, một API trả 400 — tất cả đều hiện ra ở đây mà không ca
 * jsdom nào thấy (jsdom phân giải `import()` qua Vite, không qua HTTP).
 */
export function theoDoiLoi(page: Page): { loi: string[]; xau: string[] } {
  const loi: string[] = [];
  const xau: string[] = [];

  page.on('pageerror', (err) => loi.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' && !BEN_THU_BA.test(t) && !KHONG_GAN_DUOC_ORIGIN.test(t)) {
      loi.push(`console.error: ${t}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !BEN_THU_BA.test(res.url())) {
      xau.push(`${String(res.status())} ${res.request().method()} ${res.url()}`);
    }
  });

  return { loi, xau };
}

/**
 * Khẳng định cuối ca: không lỗi nào của chính ta trên cả đường đi.
 *
 * `boQua` dành cho những request mà SẢN PHẨM cố ý để hỏng, có ghi chú trong mã.
 * Mỗi mẫu truyền vào phải kèm lý do ở nơi gọi — danh sách này là chỗ dễ nhất để
 * âm thầm làm bộ test mất hiệu lực, nên nó không được có mục nào "cho qua cho
 * xong".
 */
export function khongLoiNao(theoDoi: { loi: string[]; xau: string[] }, boQua: RegExp[] = []): void {
  const xau = theoDoi.xau.filter((d) => !boQua.some((m) => m.test(d)));
  expect(xau, 'không request nào của chính ta trả >= 400').toEqual([]);
  expect(theoDoi.loi, 'không lỗi runtime nào của chính ta').toEqual([]);
}

/**
 * Cái 409 DUY NHẤT được phép bỏ qua, và nó là chủ đích của sản phẩm.
 *
 * `ReportViewPage` cố ý bắn `useReportCanvasData(id, null)` NGAY khi vào trang,
 * trước khi biết báo cáo thuộc nhánh nào, để hai request không xếp hàng sau
 * nhau. Ghi chú ở đó đo được: `GET /reports/:id` xong ở 360ms, `canvas-data`
 * xong ở 1109ms nhưng chỉ bắt đầu lúc 360ms — nổ cùng lúc thì phần chờ chỉ còn
 * cái dài hơn. Báo cáo MỘT biểu đồ (§7.6) không có khung, nên lời gọi đó bị từ
 * chối; 4xx không được thử lại và không ai đọc kết quả.
 *
 * Ca `bieu-do` tìm ra nó rồi tui đi đọc mã: nó đã được ghi chú hẳn một đoạn.
 * Nên chỗ đúng để sửa là KHẲNG ĐỊNH, không phải sản phẩm.
 *
 * Mẫu hẹp đúng một endpoint — KHÔNG mở thành "bỏ qua mọi 409". Và nó nằm ở đây,
 * có tên, vì hai ca cùng cần: một mẫu regex sao y ở hai chỗ là hai chỗ để âm
 * thầm nới rộng.
 */
export const CANVAS_DATA_409_CHU_DICH = /409 GET \S+\/reports\/\d+\/canvas-data/;

/**
 * Đăng nhập qua GIAO DIỆN, không qua API.
 *
 * Cố ý đi đường người dùng đi: nó kiểm luôn form, proxy `/api`, cookie phiên và
 * lần điều hướng sau đăng nhập. Rẻ (dưới 2 giây) nên không cần `storageState`.
 *
 * `exact: true` ở ô mật khẩu là bắt buộc: nhãn "Mật khẩu" khớp cả ô nhập lẫn
 * nút "Hiện mật khẩu", và strict mode của Playwright từ chối hai kết quả.
 */
export async function dangNhap(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TAI_KHOAN.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(TAI_KHOAN.matKhau);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào');
}

/**
 * Token cho các lời gọi API dọn dẹp. NHỚ LẠI, một lần cho cả tiến trình.
 *
 * Dọn bằng API chứ không bằng giao diện: ca test phải dọn được cả khi nó đỏ ở
 * giữa đường, và lúc đó giao diện có thể đang ở một trạng thái bất kỳ.
 *
 * ⚠️ Nhớ lại là BẮT BUỘC, không phải tối ưu. Đăng nhập bị bó nhịp
 * `LOGIN_MAX_ATTEMPTS = 10` trong `LOGIN_LOCKOUT_MINUTES = 15` phút, theo IP.
 * Bản đầu gọi lại mỗi lần, và khi bộ e2e lên 6 ca thì một lượt chạy gọi khoảng
 * 20 lần — hai trong ba lượt đỏ với "đăng nhập để lấy token dọn dẹp", một câu
 * không nói gì về nguyên nhân. Mười bốn lần trong số đó là lãng phí thuần: cùng
 * một tài khoản, cùng một tiến trình.
 *
 * Còn lại 1 lời gọi API + 6 lần đăng nhập QUA GIAO DIỆN (mỗi ca một lần, và đó
 * là phần của hành trình). Tức 7 trên 10 — còn chỗ cho ba ca nữa. Vượt quá thì
 * cách đúng là một `storageState` dựng một lần ở `globalSetup`, không phải nới
 * hạn nhịp.
 */
let tokenDaCo: string | null = null;

export async function layToken(request: APIRequestContext): Promise<string> {
  if (tokenDaCo !== null) return tokenDaCo;

  const res = await request.post('http://127.0.0.1:4000/api/auth/login', {
    data: { email: TAI_KHOAN.email, password: TAI_KHOAN.matKhau },
  });
  expect(res.status(), 'đăng nhập để lấy token dọn dẹp').toBe(200);
  tokenDaCo = (await res.json()).token as string;
  return tokenDaCo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bệ đỡ dùng chung: một báo cáo THẬT dựng từ một tệp THẬT
// ─────────────────────────────────────────────────────────────────────────────

export const API = 'http://127.0.0.1:4000/api';

/** Tệp mẫu của chính bộ kiểm thử: 6 cột, 36 dòng, 3 khu vực, tiếng Việt có dấu. */
export const TEP_MAU = path.resolve(
  __dirname,
  '../docs/kiem-thu/du-lieu-thu/kiem-thu-ban-hang.csv',
);

/** Tổng doanh thu mỗi khu vực trong `TEP_MAU` — con số để đối chiếu, không phải để tin. */
export const DOANH_THU_MAU = {
  'Miền Trung': 9_482_000,
  'Miền Nam': 8_462_000,
  'Miền Bắc': 7_102_000,
} as const;

export interface BaoCaoMau {
  workspaceId: number;
  datasetId: number;
  reportId: number;
}

/**
 * Dựng một báo cáo cột từ `TEP_MAU`: tệp thật -> MinIO thật -> ClickHouse thật.
 *
 * ═══ Vì sao dựng bằng API chứ không qua giao diện ══════════════════════════
 *
 * Việc chọn chiều/thước đo trong trình dựng đã có 873 ca jsdom phủ, và đi lại
 * đường đó trong mỗi ca e2e chỉ làm ca dài ra rồi hỏng vì một nhãn nút bị sửa.
 * Đây là BỆ ĐỠ; phần được kiểm nằm ở chỗ ca gọi nó làm gì tiếp.
 *
 * Lần PUT lên MinIO vẫn là PUT THẬT (`request.put` vào vé đã ký) nên bệ đỡ này
 * không mô phỏng bước nào — đó cũng là bước mà test backend thay bằng
 * `memoryStorage.putForTest`, tức là kiểm chính đoạn mã giả.
 *
 * Mỗi ca truyền TÊN RIÊNG: hai ca chạy nối nhau trên cùng database dev, và dùng
 * chung một tên thì phần dọn của ca này xoá dữ liệu đang dùng của ca kia.
 */
export async function dungBaoCaoMau(
  request: APIRequestContext,
  token: string,
  ten: { bo: string; baoCao: string },
): Promise<BaoCaoMau> {
  const auth = { Authorization: `Bearer ${token}` };
  const { workspaceId, datasetId } = await dungBoDuLieu(request, token, ten.bo);

  const tao = await request.post(`${API}/v1/reports`, {
    headers: auth,
    data: { datasetId, name: ten.baoCao },
  });
  expect(tao.status(), await tao.text()).toBe(201);
  const reportId = ((await tao.json()) as { id: number }).id;

  const cauHinh = await request.patch(`${API}/v1/reports/${String(reportId)}`, {
    headers: auth,
    data: {
      name: ten.baoCao,
      chartType: 'bar',
      config: { dimension: 'Khu vực', measure: 'Doanh thu', aggregate: 'sum', limit: 20 },
    },
  });
  expect(cauHinh.status(), await cauHinh.text()).toBe(200);

  return { workspaceId, datasetId, reportId };
}

/** Tải `TEP_MAU` lên, chốt, và chờ nó nạp xong vào Kho dữ liệu. */
export async function dungBoDuLieu(
  request: APIRequestContext,
  token: string,
  tenBo: string,
): Promise<{ workspaceId: number; datasetId: number }> {
  const auth = { Authorization: `Bearer ${token}` };

  const ws = await request.get(`${API}/v1/workspaces`, { headers: auth });
  expect(ws.status()).toBe(200);
  // Endpoint này trả MẢNG THUẦN, không bọc `{items}` như các danh sách phân
  // trang khác — đã kiểm bằng một lời gọi thật, không suy từ tên.
  const workspaceId = ((await ws.json()) as { id: number }[])[0]?.id;
  expect(workspaceId, 'tổ chức phải có ít nhất một workspace').toBeDefined();

  const xin = await request.post(`${API}/v1/datasets/uploads`, {
    headers: auth,
    data: { workspaceId, filename: `${tenBo}.csv` },
  });
  expect(xin.status(), await xin.text()).toBe(201);
  const { datasetId, uploadUrl } = (await xin.json()) as { datasetId: number; uploadUrl: string };

  const put = await request.put(uploadUrl, {
    data: readFileSync(TEP_MAU),
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
    data: { name: tenBo, sheets: [sheet] },
  });
  expect(chot.status(), await chot.text()).toBe(200);

  /*
   * Chờ nạp xong bằng cách HỎI trạng thái, không bằng `waitForTimeout`.
   *
   * Nạp chạy nền (§9 ingest runner), nên không có mốc nào khác để chờ. Nếu một
   * ngày nó thôi chạy, `expect.poll` hết giờ và nói rõ trạng thái cuối nó thấy —
   * còn một lần sleep thì chỉ làm ca đỏ ở bước sau, xa nguyên nhân.
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

  return { workspaceId: workspaceId as number, datasetId };
}

export interface KhungMau {
  workspaceId: number;
  datasetId: number;
  datamodelId: number;
  reportId: number;
  /** Mã hai ô, đúng thứ tự đã đặt: trái rồi phải. */
  o: { trai: string; phai: string };
  /** Tiêu đề hai ô — dùng để khoanh `aria-label` của `<section>` trong trình dựng. */
  tieuDe: { trai: string; phai: string };
}

/** Toạ độ ban đầu của hai ô, để ca test biết nó đang kéo từ đâu. */
export const O_BAN_DAU = {
  trai: { x: 0, y: 0, w: 6, h: 7 },
  phai: { x: 6, y: 0, w: 6, h: 7 },
} as const;

/**
 * Dựng một báo cáo KHUNG NHIỀU Ô trên một mô hình dữ liệu — §10.10.
 *
 * ═══ Vì sao phải có mô hình, không dùng lại `dungBaoCaoMau` ════════════════
 *
 * Báo cáo dựng trên BỘ DỮ LIỆU là báo cáo chỉ xem (§7.6) — thanh trên của nó
 * ghi hẳn "Dựng trên bộ dữ liệu — chỉ xem", và không có trình dựng. Trình dựng
 * (`/reports/:id/edit`, `CanvasBoard`) chỉ mở cho báo cáo trên MÔ HÌNH, vì mỗi ô
 * là một truy vấn Cube trên chiều và thước đo của mô hình.
 *
 * Nên bệ đỡ này dài hơn: bộ dữ liệu -> mô hình -> thước đo -> đọc bảng trường ->
 * báo cáo khung. Năm lời gọi, và không bước nào mô phỏng được.
 *
 * ═══ Cube tự nhận schema ở môi trường dev ══════════════════════════════════
 *
 * `cubeQuery.integration.test.ts` phải tự sao file schema sang thư mục Cube đọc,
 * vì lane test ghi vào `CUBE_SCHEMA_DIR` RIÊNG (`tmp/cube-schema-test`) để không
 * đụng thư mục mà container đang bind-mount. Ở đây là server dev thật, nên
 * `CUBE_SCHEMA_DIR` chính là `./cube` — container thấy file ngay, không cần sao.
 */
export async function dungKhungMau(
  request: APIRequestContext,
  token: string,
  ten: { bo: string; baoCao: string },
): Promise<KhungMau> {
  const auth = { Authorization: `Bearer ${token}` };
  const { workspaceId, datasetId } = await dungBoDuLieu(request, token, ten.bo);

  const mh = await request.post(`${API}/v1/datamodels`, {
    headers: auth,
    data: { workspaceId, name: ten.bo, datasetIds: [datasetId] },
  });
  expect(mh.status(), await mh.text()).toBe(201);
  const datamodelId = ((await mh.json()) as { id: number }).id;

  const sc = await request.get(`${API}/v1/datamodels/${String(datamodelId)}/schema`, {
    headers: auth,
  });
  expect(sc.status(), await sc.text()).toBe(200);
  const bang = (
    (await sc.json()) as {
      datasets: { id: number; columns: { id: number; columnName: string }[] }[];
    }
  ).datasets[0];
  const cot = bang?.columns.find((c) => c.columnName === 'Doanh thu');
  expect(
    cot,
    `cột "Doanh thu" không thấy; có: ${(bang?.columns ?? []).map((c) => c.columnName).join(', ')}`,
  ).toBeDefined();

  const td = await request.post(`${API}/v1/datamodels/${String(datamodelId)}/measures`, {
    headers: auth,
    data: {
      datamodelDatasetId: bang?.id,
      name: 'Tổng doanh thu',
      agg: 'sum',
      columnId: cot?.id,
    },
  });
  expect(td.status(), await td.text()).toBe(201);
  const measureId = ((await td.json()) as { id: number }).id;

  /*
   * Bảng trường là nguồn DUY NHẤT cho `dimensionId`.
   *
   * Không suy id của chiều từ id của cột: chúng là hai không gian số khác nhau,
   * và `POST /reports/canvas` kiểm từng ô bằng chính bảng trường này — đoán sai
   * thì nhận 400 nói về một ô, không nói về chỗ sai.
   */
  const fields = await request.get(`${API}/v1/datamodels/${String(datamodelId)}/fields`, {
    headers: auth,
  });
  expect(fields.status(), await fields.text()).toBe(200);
  const dims = (await fields.json()) as { dimensions: { id: number; label: string }[] };
  const chieu = dims.dimensions.find((d) => d.label.includes('Khu v'));
  expect(
    chieu,
    `chiều "Khu vực" không thấy; có: ${dims.dimensions.map((d) => d.label).join(', ')}`,
  ).toBeDefined();

  const config = { dimensionId: chieu?.id, measureId, limit: 20 };
  const tieuDe = { trai: 'Ô bên trái', phai: 'Ô bên phải' };

  const bc = await request.post(`${API}/v1/reports/canvas`, {
    headers: auth,
    data: {
      datamodelId,
      name: ten.baoCao,
      canvas: {
        pages: [
          {
            id: 'p1',
            name: 'Trang 1',
            visuals: [
              { id: 'o-trai', chartType: 'bar', config, title: tieuDe.trai, ...O_BAN_DAU.trai },
              { id: 'o-phai', chartType: 'bar', config, title: tieuDe.phai, ...O_BAN_DAU.phai },
            ],
          },
        ],
      },
    },
  });
  expect(bc.status(), await bc.text()).toBe(201);
  const reportId = ((await bc.json()) as { id: number }).id;

  return {
    workspaceId,
    datasetId,
    datamodelId,
    reportId,
    o: { trai: 'o-trai', phai: 'o-phai' },
    tieuDe,
  };
}

/** Đọc lại toạ độ các ô của trang đầu — nguồn sự thật để khẳng định sau khi lưu. */
export async function docToaDoO(
  request: APIRequestContext,
  token: string,
  reportId: number,
): Promise<Map<string, { x: number; y: number; w: number; h: number }>> {
  const res = await request.get(`${API}/v1/reports/${String(reportId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), await res.text()).toBe(200);
  const r = (await res.json()) as {
    canvas: { pages: { visuals: { id: string; x: number; y: number; w: number; h: number }[] }[] };
  };
  const visuals = r.canvas.pages[0]?.visuals ?? [];
  return new Map(visuals.map((v) => [v.id, { x: v.x, y: v.y, w: v.w, h: v.h }]));
}

/**
 * Dọn báo cáo rồi bộ dữ liệu, THEO TÊN.
 *
 * ⚠️ `/v1/reports` ĐÒI `workspaceId`, và thiếu nó thì phần dọn chết âm thầm.
 * Bản đầu gọi `?page=1&pageSize=100` rồi `if (status !== 200) return`. Lời gọi
 * đó trả 400 `{"workspaceId":"Expected number, received nan"}`, nên nhánh
 * `return` chạy và KHÔNG xoá gì. Ba lần chạy đỏ để lại ba báo cáo, và lần thứ
 * tư đụng hạn mức gói Miễn phí (tối đa 3 báo cáo) — ca đỏ vì một lý do hoàn
 * toàn khác với thứ nó đang kiểm.
 *
 * Hai danh sách có hợp đồng KHÁC nhau: báo cáo lọc theo workspace, bộ dữ liệu
 * thì không. Nên duyệt mọi workspace cho báo cáo, và gọi một lần cho bộ dữ liệu.
 *
 * Báo cáo TRƯỚC bộ dữ liệu: xoá bộ dữ liệu còn báo cáo dùng nó thì bị từ chối.
 */
export async function xoaBaoCaoVaBoTheoTen(
  request: APIRequestContext,
  token: string,
  ten: { bo: string; baoCao: string },
): Promise<void> {
  const auth = { Authorization: `Bearer ${token}` };

  const ws = await request.get(`${API}/v1/workspaces`, { headers: auth });
  if (ws.status() !== 200) return;

  for (const w of (await ws.json()) as { id: number }[]) {
    const bc = await request.get(
      `${API}/v1/reports?page=1&pageSize=100&workspaceId=${String(w.id)}`,
      { headers: auth },
    );
    if (bc.status() !== 200) continue;
    const { items } = (await bc.json()) as { items: { id: number; name: string }[] };
    for (const r of items.filter((x) => x.name === ten.baoCao)) {
      await request.delete(`${API}/v1/reports/${String(r.id)}`, { headers: auth });
    }
  }

  /*
   * MÔ HÌNH trước BỘ DỮ LIỆU, cùng một luật với báo cáo trước mô hình.
   *
   * Ca khung (`dungKhungMau`) tạo thêm một mô hình mang CÙNG tên với bộ dữ liệu.
   * Bỏ bước này thì lần xoá bộ dữ liệu bị từ chối vì còn mô hình tham chiếu, và
   * lần chạy sau tải lên một bộ nữa — rò dữ liệu đúng kiểu `tai-tep.spec.ts`
   * từng mắc, chỉ là ở một bảng khác.
   */
  const mh = await request.get(
    `${API}/v1/datamodels?page=1&pageSize=100&q=${encodeURIComponent(ten.bo)}`,
    { headers: auth },
  );
  if (mh.status() === 200) {
    const { items } = (await mh.json()) as { items: { id: number; name: string }[] };
    for (const m of items.filter((x) => x.name === ten.bo)) {
      await request.delete(`${API}/v1/datamodels/${String(m.id)}`, { headers: auth });
    }
  }

  const ds = await request.get(
    `${API}/v1/datasets?page=1&pageSize=100&q=${encodeURIComponent(ten.bo)}`,
    { headers: auth },
  );
  if (ds.status() !== 200) return;
  const { items } = (await ds.json()) as { items: { id: number; name: string }[] };
  for (const d of items.filter((x) => x.name === ten.bo)) {
    await request.delete(`${API}/v1/datasets/${String(d.id)}`, { headers: auth });
  }
}
