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
 * Token cho các lời gọi API dọn dẹp.
 *
 * Dọn bằng API chứ không bằng giao diện: ca test phải dọn được cả khi nó đỏ ở
 * giữa đường, và lúc đó giao diện có thể đang ở một trạng thái bất kỳ.
 */
export async function layToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('http://127.0.0.1:4000/api/auth/login', {
    data: { email: TAI_KHOAN.email, password: TAI_KHOAN.matKhau },
  });
  expect(res.status(), 'đăng nhập để lấy token dọn dẹp').toBe(200);
  return (await res.json()).token as string;
}
