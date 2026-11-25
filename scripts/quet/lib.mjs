/**
 * Phần dùng chung của bộ quét — đăng nhập, gọi API, DÒ id, gom kết quả.
 *
 * ═══ Vì sao bộ này kiểm BẤT BIẾN, không so với bảng mã trả về ══════════════
 *
 * Cách dễ nghĩ nhất là chốt một bảng "route này phải trả 200, route kia 403"
 * rồi so từng lần. Bảng đó hỏng ngay lần đầu có người thêm một mô hình dữ liệu
 * hoặc đổi gói cước: nửa bảng đỏ lên vì DỮ LIỆU đổi, không phải vì MÃ đổi, và
 * một bộ kiểm tra hay báo động giả thì chỉ vài tuần là không ai đọc nữa.
 *
 * Nên ở đây mỗi phép kiểm là một CÂU LUÔN PHẢI ĐÚNG, bất kể database có gì:
 *
 *   1. Không endpoint nào được trả 5xx, kể cả khi nhận payload rác.
 *   2. `/admin/*`: chỉ superadmin vào được; mọi vai khác phải 403.
 *   3. Không token / token rác → 401.
 *   4. Tổ chức KHÁC hỏi id của tổ chức này → không bao giờ 2xx.
 *   5. Chủ sở hữu hỏi id của chính mình → phải 2xx.
 *   6. Mở một trang không được sinh exception, không được có request 5xx.
 *
 * Năm câu đầu đúng với mọi database; câu 4 là câu đã bắt được lỗi
 * `/datasets/:id/load/errors` ngày 25/11/2026.
 *
 * ═══ Vì sao PHẢI dò id, không được viết cứng ═══════════════════════════════
 *
 * Bản nháp của bộ này viết cứng `workspaceId=2, datasetId=532, datamodelId=229`
 * cộng mấy id của tổ chức khác. Hai hậu quả, cả hai đã xảy ra thật:
 *
 *   • Trên máy khác (hoặc sau một lần dọn database) những id ấy không tồn tại,
 *     nên cả bộ kiểm tra chạy xanh trong khi nó chỉ đang xác nhận 404.
 *   • Một id viết cứng bị nhập sai — `184` là id của một DATASET chứ không phải
 *     mô hình — và nó hiện ra thành "lỗi 404 ở /datamodels/184", tốn một vòng
 *     truy nguyên cho một thứ không tồn tại.
 *
 * Nên `doId` hỏi chính API xem tài khoản này đang có gì, và phép kiểm nào không
 * đủ dữ liệu thì BỎ QUA có ghi chú, chứ không im lặng xanh.
 */
import { setTimeout as cho } from 'node:timers/promises';

/** Địa chỉ backend. Đổi được để chạy với cổng khác, nhưng xem `canhCong` dưới. */
export const GOC = process.env.QUET_API ?? 'http://localhost:4000/api';

/** Origin hợp lệ — backend có `originGuard`, thiếu header này là 403 hàng loạt. */
export const NGUON = process.env.QUET_ORIGIN ?? 'http://localhost:5173';

/**
 * Tài khoản dùng để quét, theo `docs/tai-khoan-thu-nghiem.md`.
 *
 * Mật khẩu superadmin tới từ `ADMIN_PASSWORD` trong `backend/.env` nên đọc env
 * trước; các tài khoản còn lại là dữ liệu gieo của máy dev. Vai nào không đăng
 * nhập được thì những phép kiểm cần nó BỎ QUA có ghi chú — một máy mới gieo
 * chưa chắc có cả bốn.
 */
export const VAI = {
  sieu: {
    email: process.env.QUET_SUPER_EMAIL ?? 'admin@bi-platform.local',
    mk: process.env.QUET_SUPER_MK ?? process.env.ADMIN_PASSWORD ?? 'Admin@12345',
    mo: 'superadmin',
  },
  chu: {
    email: process.env.QUET_CHU_EMAIL ?? 'mai@anhduong.vn',
    mk: process.env.QUET_CHU_MK ?? 'Matkhau@123',
    mo: 'admin của một tổ chức',
  },
  xem: {
    email: process.env.QUET_XEM_EMAIL ?? 'viewer@bi-platform.local',
    mk: process.env.QUET_XEM_MK ?? 'Matkhau@123',
    mo: 'viewer',
  },
  khac: {
    email: process.env.QUET_KHAC_EMAIL ?? 'hanh@saomai.vn',
    mk: process.env.QUET_KHAC_MK ?? 'Matkhau@123',
    mo: 'admin của tổ chức KHÁC',
  },
};

/**
 * Chặn chạy ngoài localhost.
 *
 * `ghi.mjs` bơm payload rác vào 48 route ghi và `luong.mjs` TẠO RỒI XOÁ dữ liệu
 * thật. Trên máy dev đó là đúng việc; trỏ vào một máy chủ đang phục vụ người
 * dùng thì đó là phá hoại. Một biến môi trường đặt sai là đủ, nên cửa phải khoá
 * ở đây chứ không nằm trong trí nhớ người chạy.
 */
export function canhCong() {
  const u = new URL(GOC);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) {
    console.error(
      `\n✘ Bộ quét TỪ CHỐI chạy với QUET_API=${GOC}\n` +
        '  Nó ghi và xoá dữ liệu thật, nên chỉ chạy được trên localhost.\n',
    );
    process.exit(2);
  }
}

const dau = (token) => ({
  origin: NGUON,
  'content-type': 'application/json',
  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
});

/** Một lời gọi API. KHÔNG bao giờ ném — lỗi mạng trả `ma: 0` để phép kiểm thấy. */
export async function goi(method, duong, { body, token } = {}) {
  try {
    const res = await fetch(`${GOC}${duong}`, {
      method,
      headers: dau(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const chu = await res.text();
    let json = null;
    try {
      json = JSON.parse(chu);
    } catch {
      /* không phải JSON — giữ nguyên `chu` */
    }
    return { ma: res.status, json, chu: chu.slice(0, 200) };
  } catch (err) {
    return { ma: 0, json: null, chu: String(err?.message ?? err) };
  }
}

/** Đăng nhập. Trả `{ token, nguoi }`, hoặc `{ loi }` để nơi gọi bỏ qua vai này. */
export async function dangNhap({ email, mk }) {
  const r = await goi('POST', '/auth/login', { body: { email, password: mk } });
  if (r.json?.token === undefined) {
    return { loi: `${r.ma} ${r.json?.error ?? r.json?.message ?? r.chu}`.slice(0, 90) };
  }
  return { token: r.json.token, nguoi: r.json.user ?? null };
}

/** Đăng nhập cả bốn vai. Vai hỏng KHÔNG làm cả bộ dừng. */
export async function dangNhapTatCa() {
  const ra = {};
  for (const [ten, tk] of Object.entries(VAI)) {
    ra[ten] = { ...tk, ...(await dangNhap(tk)) };
  }
  return ra;
}

/**
 * Hỏi API xem tài khoản này đang có những gì.
 *
 * Mỗi giá trị có thể `undefined` — tài khoản chưa có mô hình nào là chuyện bình
 * thường, và phép kiểm cần nó sẽ tự bỏ qua. `tenantId` lấy từ `/v1/tenant` vì
 * phép kiểm cách ly cần biết hai vai có khác tổ chức thật hay không.
 */
export async function doId(token) {
  const mot = async (duong, lay) => {
    const r = await goi('GET', duong, { token });
    if (r.ma !== 200) return undefined;
    try {
      return lay(r.json) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const dau0 = (j) => (Array.isArray(j) ? j[0] : j?.items?.[0]);

  const toChuc = await mot('/v1/tenant', (j) => j?.id);
  const ws = await mot('/v1/workspaces', (j) => dau0(j)?.id);
  const moHinh = await mot('/v1/datamodels', (j) => dau0(j)?.id);
  const boDl =
    ws === undefined
      ? undefined
      : await mot(`/v1/datasets?workspaceId=${ws}&page=1&pageSize=5`, (j) => dau0(j)?.id);
  const baoCao =
    ws === undefined ? undefined : await mot(`/v1/reports?workspaceId=${ws}`, (j) => dau0(j)?.id);
  const ketNoi = await mot('/v1/connections', (j) => dau0(j)?.id);
  const thanhVien = await mot('/v1/members', (j) => dau0(j)?.userId ?? dau0(j)?.id);
  const cachTra = await mot('/v1/payment-methods', (j) => dau0(j)?.id);
  const donHang = await mot('/v1/orders', (j) => dau0(j)?.code);

  return { toChuc, ws, moHinh, boDl, baoCao, ketNoi, thanhVien, cachTra, donHang };
}

/**
 * Sổ ghi kết quả của một mục quét.
 *
 * `bo()` là BỎ QUA, khác hẳn `dat()`: thiếu dữ liệu để kiểm thì phải nói ra, vì
 * một phép kiểm im lặng không chạy trông y hệt một phép kiểm đã đạt.
 */
export function soGhi(ten) {
  const ca = [];
  return {
    ten,
    ca,
    dat: (nhan, chiTiet = '') => ca.push({ nhan, trang: 'dat', chiTiet }),
    truot: (nhan, chiTiet = '') => ca.push({ nhan, trang: 'truot', chiTiet }),
    bo: (nhan, vi = '') => ca.push({ nhan, trang: 'bo', chiTiet: vi }),
    /** Gộp một phép kiểm boolean cho gọn chỗ gọi. */
    can: (dieu, nhan, chiTiet = '') =>
      dieu
        ? ca.push({ nhan, trang: 'dat', chiTiet: '' })
        : ca.push({ nhan, trang: 'truot', chiTiet }),
  };
}

export { cho };
