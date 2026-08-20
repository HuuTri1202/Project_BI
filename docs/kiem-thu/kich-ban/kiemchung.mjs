/**
 * Bộ kiểm chứng chạy thẳng vào API đang sống ở localhost:4000.
 *
 * Mục đích: điền cột "kết quả thực tế" của tài liệu test case bằng thứ QUAN SÁT
 * ĐƯỢC, không phải bằng suy luận từ code. Mỗi ca in ra đúng cái mà server trả về.
 */

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
  try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: res.status, json, text };
}

async function login(which) {
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
