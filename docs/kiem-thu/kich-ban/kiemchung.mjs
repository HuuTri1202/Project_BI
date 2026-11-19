/**
 * Bộ kiểm chứng chạy thẳng vào API đang sống ở localhost:4000.
 *
 * Mục đích: điền cột "kết quả thực tế" của tài liệu test case bằng thứ QUAN SÁT
 * ĐƯỢC, không phải bằng suy luận từ code. Mỗi ca in ra đúng cái mà server trả về.
 */

import { execSync } from 'node:child_process';

const API = 'http://127.0.0.1:4000/api';

const ACCOUNTS = {
  superadmin: { email: 'admin@bi-platform.local', password: 'Admin@12345' },
  admin: { email: 'mai@anhduong.vn', password: 'Matkhau@123' },
  viewer: { email: 'viewer@bi-platform.local', password: 'Matkhau@123' },
  multi: { email: 'hanh@saomai.vn', password: 'Matkhau@123' },
};

const tokens = {};

async function req(path, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  return { status: res.status, json, text };
}

/**
 * Xoá bộ đếm chặn dò mật khẩu của 127.0.0.1.
 *
 * ─── Vì sao nó phải nằm ở ĐÂY, trong `login` ────────────────────────────────
 *
 * `XT-21` cố ý đăng nhập sai 13 lần để chứng minh chốt chặn dò mật khẩu có
 * thật, và nó để lại bộ đếm ở mức 13 với TTL hàng chục phút. Ba module còn lại
 * (`mod-phanquyen`, `mod-thuocdo`, `mod-luongdulieu`) KHÔNG dọn bộ đếm đó, nên
 * chạy đúng thứ tự README ghi thì module thứ hai chết ngay ở lời gọi `login`
 * đầu tiên với HTTP 429 — tức là quy trình trong tài liệu không chạy được.
 *
 * Đặt trong `login` chứ không thêm một dòng vào đầu từng module: `login` là
 * phễu DUY NHẤT mọi module đi qua để lấy token, nên module viết sau này không
 * phải nhớ gì cả.
 *
 * KHÔNG làm yếu `XT-21`: ca đó gọi `req('/auth/login', ...)` trực tiếp chứ
 * không qua `login`, nên bộ đếm nó dựng lên vẫn được đo nguyên vẹn.
 */
function donBoDemDangNhap() {
  try {
    /*
     * Xoá theo MẪU, không gọi tên một khoá.
     *
     * Khoá là `ratelimit:login:<ip>` với `<ip>` đúng như Express nhìn thấy, và
     * có ÍT NHẤT hai dạng: `::ffff:127.0.0.1` khi gọi thẳng bằng IPv4 (đường
     * của bộ kịch bản này), và `::1` khi đi qua Vite proxy từ trình duyệt
     * (đường của bộ e2e). Bản đầu của hàm này chỉ xoá khoá IPv4 — đủ cho ở đây,
     * nhưng lúc chẩn đoán một ca e2e đỏ, kiểm khoá IPv4 thấy TRỐNG nên tưởng
     * không phải rate limit, trong khi `::1` đang giữ. Một khoá bị bỏ sót hiện
     * ra dưới dạng lỗi chập chờn ở chỗ khác.
     */
    const r = 'docker exec bi-redis redis-cli -a redispassword --no-auth-warning';
    const khoa = execSync(`${r} --scan --pattern "ratelimit:login:*"`, { encoding: 'utf8' })
      .split('\n')
      .map((d) => d.trim())
      .filter((d) => d !== '');
    if (khoa.length > 0)
      execSync(`${r} DEL ${khoa.map((k) => `"${k}"`).join(' ')}`, { stdio: 'ignore' });
  } catch {
    // Không với tới được Redis thì vẫn cứ thử đăng nhập: nếu đó là vấn đề thật
    // thì `login` bên dưới sẽ ném ra kèm mã trạng thái, rõ hơn một lỗi docker.
  }
}

async function login(which) {
  donBoDemDangNhap();
  const a = ACCOUNTS[which];
  const r = await req('/auth/login', { method: 'POST', body: a });
  if (r.status !== 200) throw new Error(`không đăng nhập được ${which}: ${r.status} ${r.text}`);
  tokens[which] = r.json.token;
  return r.json;
}

// ── khung chạy ────────────────────────────────────────────────────────────────

const results = [];

async function tc(id, title, fn) {
  try {
    const out = await fn();
    results.push({ id, title, pass: out.pass, actual: out.actual });
    const mark = out.pass ? 'DAT   ' : 'KHONG ';
    console.log(`${mark} ${id}  ${title}\n           -> ${out.actual}`);
  } catch (err) {
    results.push({ id, title, pass: false, actual: `LỖI KHI CHẠY: ${err.message}` });
    console.log(`LOI    ${id}  ${title}\n           -> ${err.message}`);
  }
}

/** Rút gọn thân phản hồi để in vào bảng. */
function brief(r, keys = []) {
  if (r.json === null) return `HTTP ${r.status}, thân không phải JSON (${r.text.slice(0, 60)})`;
  if (keys.length) {
    const picked = {};
    for (const k of keys) if (r.json[k] !== undefined) picked[k] = r.json[k];
    return `HTTP ${r.status} ${JSON.stringify(picked)}`;
  }
  return `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 140)}`;
}

export { API, ACCOUNTS, tokens, req, login, tc, results, brief };
