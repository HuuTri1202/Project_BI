/** Module XT — Xác thực. Chạy: node mod-xacthuc.mjs */
import { req, login, tc, results, brief, tokens } from './kiemchung.mjs';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Xoá bộ đếm chặn dò mật khẩu.
 *
 * Bắt buộc trước mỗi ca có gọi /auth/login: ngưỡng là 10 lần / 15 phút cho CẢ
 * IP, nên nếu không xoá thì các ca sau bị chính bộ chặn trả 429 và phép đo
 * không còn nói về thứ nó định đo. Đây là bài học rút ra khi chạy lần đầu —
 * XT-04 báo lệch 99% chỉ vì một nửa số request đã bị chặn ở cửa (trả về sau
 * 4ms) thay vì đi tới bước so khớp bcrypt.
 */
function xoaBoDem() {
  execSync('docker exec bi-redis redis-cli -a redispassword --no-auth-warning DEL "ratelimit:login:::ffff:127.0.0.1"', { stdio: 'ignore' });
}

const CHUNG = 'Email hoặc mật khẩu không đúng.';
const rnd = () => Math.floor(Math.random() * 1e9);

// Đăng nhập sẵn các vai trò dùng chung cho mọi module sau.
xoaBoDem();
await login('admin');
await login('superadmin');
await login('viewer');
await login('multi');

await tc('XT-01', 'Đăng nhập đúng thông tin', async () => {
  xoaBoDem();
  const r = await req('/auth/login', { method: 'POST', body: { email: 'mai@anhduong.vn', password: 'Matkhau@123' } });
  const ok = r.status === 200 && typeof r.json?.token === 'string' && r.json.token.split('.').length === 3;
  return { pass: ok, actual: `HTTP ${r.status}, trả token JWT 3 phần, tenant="${r.json?.tenant?.name}", role="${r.json?.role}"` };
});

await tc('XT-02', 'Đăng nhập sai mật khẩu', async () => {
  xoaBoDem();
  const r = await req('/auth/login', { method: 'POST', body: { email: 'mai@anhduong.vn', password: 'SaiBet@999' } });
  return { pass: r.status === 401 && r.json?.message === CHUNG, actual: `HTTP ${r.status} "${r.json?.message}"` };
});

await tc('XT-03', 'Email chưa đăng ký — KHÔNG được lộ ra là email không tồn tại', async () => {
  xoaBoDem();
  const r = await req('/auth/login', { method: 'POST', body: { email: `khongtontai${rnd()}@vidu.vn`, password: 'SaiBet@999' } });
  const ok = r.status === 401 && r.json?.message === CHUNG;
  return { pass: ok, actual: `HTTP ${r.status} "${r.json?.message}" — giống hệt thông báo của XT-02` };
});

await tc('XT-04', 'Chênh lệch thời gian giữa email có thật và email không có (kênh dò email)', async () => {
  xoaBoDem();
  const dothu = async (email) => {
    const t = [];
    for (let i = 0; i < 3; i++) {
      const s = performance.now();
      await req('/auth/login', { method: 'POST', body: { email, password: 'SaiBet@999' } });
      t.push(performance.now() - s);
    }
    return t.reduce((a, b) => a + b) / t.length;
  };
  const co = await dothu('mai@anhduong.vn');
  const khong = await dothu(`khongtontai${rnd()}@vidu.vn`);
  const lech = Math.abs(co - khong);
  const tyle = lech / Math.max(co, khong);
  return { pass: tyle < 0.35, actual: `email có thật ${co.toFixed(0)}ms · email không có ${khong.toFixed(0)}ms · lệch ${lech.toFixed(0)}ms (${(tyle * 100).toFixed(0)}%)` };
});

await tc('XT-05', 'Email sai định dạng bị chặn ở tầng kiểm dữ liệu', async () => {
  xoaBoDem();
  const r = await req('/auth/login', { method: 'POST', body: { email: 'khong-phai-email', password: 'Matkhau@123' } });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('XT-06', 'Email được chuẩn hoá: CHỮ HOA kèm khoảng trắng vẫn đăng nhập được', async () => {
  xoaBoDem();
  const r = await req('/auth/login', { method: 'POST', body: { email: '  MAI@ANHDUONG.VN  ', password: 'Matkhau@123' } });
  return { pass: r.status === 200, actual: `HTTP ${r.status}, vào đúng tổ chức "${r.json?.tenant?.name}"` };
});

const dangKy = (extra) => ({
  email: `a${rnd()}@vidu.vn`, password: 'Matkhau@123', confirmPassword: 'Matkhau@123',
  fullName: 'Nguyen Van A', companyName: 'Cong ty Kiem Thu', phone: '0912345678', jobTitle: 'Data Analyst', ...extra,
});

await tc('XT-07', 'Đăng ký: mật khẩu thiếu chữ hoa bị từ chối', async () => {
  const r = await req('/auth/register', { method: 'POST', body: dangKy({ password: 'matkhau123', confirmPassword: 'matkhau123' }) });
  const nhac = JSON.stringify(r.json).includes('chữ hoa');
  return { pass: r.status === 400 && nhac, actual: `HTTP ${r.status}, thông báo có nhắc "chữ hoa": ${nhac}` };
});

await tc('XT-08', 'Đăng ký: mật khẩu dưới 8 ký tự bị từ chối', async () => {
  const r = await req('/auth/register', { method: 'POST', body: dangKy({ password: 'Ab1', confirmPassword: 'Ab1' }) });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('XT-09', 'Đăng ký: mật khẩu nhập lại không khớp bị từ chối', async () => {
  const r = await req('/auth/register', { method: 'POST', body: dangKy({ confirmPassword: 'Matkhau@456' }) });
  const nhac = JSON.stringify(r.json).includes('nhập lại');
  return { pass: r.status === 400, actual: `HTTP ${r.status}, thông báo nhắc "nhập lại": ${nhac}` };
});

await tc('XT-10', 'Đăng ký: email đã tồn tại trả 409', async () => {
  const r = await req('/auth/register', { method: 'POST', body: dangKy({ email: 'mai@anhduong.vn' }) });
  return { pass: r.status === 409, actual: brief(r) };
});

await tc('XT-11', 'Đăng ký: số điện thoại sai định dạng bị từ chối', async () => {
  const r = await req('/auth/register', { method: 'POST', body: dangKy({ phone: '123' }) });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('XT-12', 'GET /auth/me khi chưa đăng nhập trả 401', async () => {
  const r = await req('/auth/me');
  return { pass: r.status === 401, actual: brief(r) };
});

await tc('XT-13', 'GET /auth/me với token hợp lệ trả đúng người đang đăng nhập', async () => {
  const r = await req('/auth/me', { token: tokens.admin });
  return { pass: r.status === 200 && r.json?.user?.email === 'mai@anhduong.vn', actual: `HTTP ${r.status}, user.email="${r.json?.user?.email}", role="${r.json?.role}"` };
});

await tc('XT-14', 'Token bị sửa chữ ký bị từ chối', async () => {
  const [h, p] = tokens.admin.split('.');
  const r = await req('/auth/me', { token: `${h}.${p}.chuKySaiHoanToan` });
  return { pass: r.status === 401, actual: brief(r) };
});

await tc('XT-15', 'Token bị sửa payload để tự nâng lên superadmin bị từ chối', async () => {
  const [h, p, s] = tokens.admin.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.platformRole = 'superadmin';
  const p2 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const r = await req('/auth/me', { token: `${h}.${p2}.${s}` });
  return { pass: r.status === 401, actual: brief(r) };
});

await tc('XT-16', 'Token khai thuật toán "none" bị từ chối (alg confusion)', async () => {
  const [, p] = tokens.admin.split('.');
  const h2 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const r = await req('/auth/me', { token: `${h2}.${p}.` });
  return { pass: r.status === 401, actual: brief(r) };
});

await tc('XT-17', 'Đổi mật khẩu khi nhập sai mật khẩu hiện tại bị từ chối', async () => {
  const r = await req('/auth/change-password', { method: 'POST', token: tokens.admin, body: { currentPassword: 'SaiBet@999', newPassword: 'MatkhauMoi@123', confirmPassword: 'MatkhauMoi@123' } });
  return { pass: r.status >= 400 && r.status < 500, actual: brief(r) };
});

await tc('XT-18', 'Chuyển sang tổ chức mình KHÔNG thuộc bị từ chối', async () => {
  const r = await req('/auth/switch-tenant', { method: 'POST', token: tokens.admin, body: { tenantId: 3 } });
  return { pass: r.status === 403 || r.status === 404, actual: brief(r) };
});

await tc('XT-19', 'Chuyển tổ chức hợp lệ: quyền đổi theo tổ chức đích', async () => {
  xoaBoDem();
  const me = await req('/auth/me', { token: tokens.multi });
  const ds = me.json?.memberships ?? [];
  const khac = ds.find((m) => m.id !== me.json?.tenant?.id);
  if (!khac) return { pass: false, actual: 'tài khoản chỉ có 1 tổ chức, không thử được' };
  const r = await req('/auth/switch-tenant', { method: 'POST', token: tokens.multi, body: { tenantId: khac.id } });
  const ok = r.status === 200 && r.json?.tenant?.id === khac.id;
  return { pass: ok, actual: `HTTP ${r.status}: "${me.json?.tenant?.name}" (${me.json?.role}) -> "${r.json?.tenant?.name}" (${r.json?.role})` };
});

await tc('XT-20', 'Đăng xuất trả 204 (JWT vô trạng thái, client tự bỏ token)', async () => {
  const res = await fetch('http://127.0.0.1:4000/api/auth/logout', { method: 'POST' });
  const sc = res.headers.get('set-cookie') ?? '';
  return { pass: res.status === 204, actual: `HTTP ${res.status}, Set-Cookie: ${sc.slice(0, 80) || '(không có — token nằm ở client)'}` };
});

await tc('XT-21', 'Chặn dò mật khẩu: sai liên tiếp quá ngưỡng thì trả 429', async () => {
  // Xoá bộ đếm trước để con số quan sát được là con số thật, không cộng dồn từ
  // các ca phía trên.
  execSync('docker exec bi-redis redis-cli -a redispassword --no-auth-warning DEL "ratelimit:login:::ffff:127.0.0.1"', { stdio: 'ignore' });
  const ma = [];
  for (let i = 1; i <= 13; i++) {
    const r = await req('/auth/login', { method: 'POST', body: { email: 'mai@anhduong.vn', password: 'SaiBet@999' } });
    ma.push(r.status);
  }
  const lanDau429 = ma.indexOf(429) + 1;
  const dem = execSync('docker exec bi-redis redis-cli -a redispassword --no-auth-warning GET "ratelimit:login:::ffff:127.0.0.1"').toString().trim();
  const ttl = execSync('docker exec bi-redis redis-cli -a redispassword --no-auth-warning TTL "ratelimit:login:::ffff:127.0.0.1"').toString().trim();
  return {
    pass: lanDau429 === 11,
    actual: `10 lần đầu HTTP 401, từ lần thứ ${lanDau429} trở đi HTTP 429; bộ đếm Redis = ${dem}, TTL còn ${ttl}s (~${Math.round(ttl / 60)} phút)`,
  };
});

writeFileSync(new URL('./kq-xacthuc.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n=== XT: ${results.filter((r) => r.pass).length}/${results.length} dat ===`);
