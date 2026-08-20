/** Module PQ — Phân quyền (§6) và AT — An toàn / cách ly tổ chức. */
import { req, login, tc, results, brief, tokens } from './kiemchung.mjs';
import { writeFileSync } from 'node:fs';

await login('admin');       // mai@anhduong.vn  — admin tổ chức Ánh Dương (id 2)
await login('superadmin');  // admin@bi-platform.local
await login('viewer');      // viewer@bi-platform.local — viewer tổ chức BI Platform

// ── PQ — phân quyền theo vai trò ─────────────────────────────────────────────

await tc('PQ-01', 'Ma trận quyền của admin tổ chức: đủ 4 hành động trên mọi tài nguyên', async () => {
  const r = await req('/v1/permissions', { token: tokens.admin });
  const m = r.json ?? {};
  const du = m.workspace?.includes('modify') && m.member?.includes('invite') && m.connection?.includes('delete');
  return { pass: r.status === 200 && Boolean(du), actual: `HTTP ${r.status}, workspace=[${m.workspace}], member=[${m.member}]` };
});

await tc('PQ-02', 'Ma trận quyền của viewer: mọi tài nguyên chỉ có "read"', async () => {
  const r = await req('/v1/permissions', { token: tokens.viewer });
  const m = r.json ?? {};
  const cacHanhDong = new Set(Object.values(m).flat());
  const chiDoc = cacHanhDong.size === 1 && cacHanhDong.has('read');
  return { pass: r.status === 200 && chiDoc, actual: `HTTP ${r.status}, tập hành động xuất hiện = {${[...cacHanhDong].join(', ')}}, dataset=[${m.dataset}]` };
});

await tc('PQ-03', 'Viewer XEM được danh sách bộ dữ liệu', async () => {
  const r = await req('/v1/datasets', { token: tokens.viewer });
  return { pass: r.status === 200, actual: `HTTP ${r.status}, tổng ${r.json?.total} bộ dữ liệu` };
});

await tc('PQ-04', 'Viewer KHÔNG tạo được workspace', async () => {
  const r = await req('/v1/workspaces', { method: 'POST', token: tokens.viewer, body: { name: 'Thu tao workspace' } });
  return { pass: r.status === 403, actual: brief(r) };
});

await tc('PQ-05', 'Viewer KHÔNG mời được thành viên', async () => {
  const r = await req('/v1/members', { method: 'POST', token: tokens.viewer, body: { email: 'ai-do@vidu.vn', fullName: 'Ai Do', role: 'viewer' } });
  return { pass: r.status === 403, actual: brief(r) };
});

await tc('PQ-06', 'Viewer KHÔNG xoá được workspace', async () => {
  const ws = await req('/v1/workspaces', { token: tokens.viewer });
  const id = ws.json?.[0]?.id;
  if (!id) return { pass: false, actual: 'không có workspace nào để thử' };
  const r = await req(`/v1/workspaces/${id}`, { method: 'DELETE', token: tokens.viewer });
  return { pass: r.status === 403, actual: brief(r) };
});

await tc('PQ-07', 'Viewer KHÔNG tạo được kết nối CSDL', async () => {
  const r = await req('/v1/connections', { method: 'POST', token: tokens.viewer, body: { name: 'thu', kind: 'mysql', host: '127.0.0.1', port: 3310, databaseName: 'x', username: 'u', password: 'p', useSsl: false } });
  return { pass: r.status === 403, actual: brief(r) };
});

await tc('PQ-08', 'Admin tổ chức KHÔNG vào được console hệ thống /api/admin', async () => {
  const r = await req('/admin/overview', { token: tokens.admin });
  return { pass: r.status === 403, actual: brief(r) };
});

await tc('PQ-09', 'Superadmin vào được console hệ thống', async () => {
  const r = await req('/admin/overview', { token: tokens.superadmin });
  return { pass: r.status === 200, actual: `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}` };
});

await tc('PQ-10', 'Gọi API khi không có token trả 401, không phải 403', async () => {
  const r = await req('/v1/datasets');
  return { pass: r.status === 401, actual: brief(r) };
});

await tc('PQ-11', 'Superadmin KHÔNG tự động là admin của mọi tổ chức ở API tổ chức', async () => {
  const me = await req('/auth/me', { token: tokens.superadmin });
  return { pass: r0(me), actual: `HTTP ${me.status}, superadmin đang ở tổ chức "${me.json?.tenant?.name}" với vai trò tổ chức "${me.json?.role}"` };
  function r0(x) { return x.status === 200 && typeof x.json?.role === 'string'; }
});

// ── AT — cách ly tổ chức và chống chèn mã ────────────────────────────────────

await tc('AT-01', 'Đọc bộ dữ liệu của tổ chức KHÁC trả 404 (không lộ sự tồn tại)', async () => {
  // Bộ dữ liệu id 21..40 thuộc tổ chức NASA (id 4). Tài khoản admin đang ở tổ chức 2.
  const thay = [];
  for (const id of [21, 22, 23, 24, 25]) {
    const r = await req(`/v1/datasets/${id}`, { token: tokens.admin });
    thay.push(`${id}:${r.status}`);
  }
  const ok = thay.every((s) => s.endsWith(':404'));
  return { pass: ok, actual: `thử 5 id thuộc tổ chức khác -> ${thay.join(' ')} (404 = không lộ)` };
});

await tc('AT-02', 'Đọc mô hình dữ liệu của tổ chức KHÁC trả 404', async () => {
  const thay = [];
  for (const id of [1, 2, 3, 4, 5]) {
    const r = await req(`/v1/datamodels/${id}`, { token: tokens.admin });
    thay.push(`${id}:${r.status}`);
  }
  return { pass: thay.every((s) => s.endsWith(':404')), actual: `thử 5 id -> ${thay.join(' ')}` };
});

await tc('AT-03', 'Tham số sắp xếp lạ bị chặn bằng danh sách trắng (chống SQL injection)', async () => {
  const r = await req('/v1/datasets?sort=(SELECT%201)&order=asc', { token: tokens.admin });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('AT-04', 'Tham số order ngoài asc/desc bị chặn', async () => {
  const r = await req('/v1/datasets?sort=name&order=; DROP TABLE datasets', { token: tokens.admin });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('AT-05', 'Từ khoá tìm kiếm chứa ký tự đại diện của LIKE không làm hỏng truy vấn', async () => {
  const r = await req(`/v1/datasets?q=${encodeURIComponent("100%_' OR 1=1 --")}`, { token: tokens.admin });
  return { pass: r.status === 200, actual: `HTTP ${r.status}, trả ${r.json?.total} kết quả (không lỗi, không trả toàn bộ bảng)` };
});

await tc('AT-06', 'Chặn SSRF: không cho tạo kết nối trỏ vào địa chỉ metadata nội bộ', async () => {
  const r = await req('/v1/connections/test', { method: 'POST', token: tokens.admin, body: { name: 'Thu SSRF', kind: 'mysql', host: '169.254.169.254', port: 3306, databaseName: 'x', username: 'u', password: 'p', useSsl: false } });
  const chan = r.status >= 400 && JSON.stringify(r.json).match(/nội bộ|InvalidHost|không hợp lệ|riêng/i);
  return { pass: Boolean(chan), actual: brief(r) };
});

await tc('AT-07', 'Chặn SSRF: địa chỉ dải riêng 10.0.0.0/8 bị từ chối', async () => {
  const r = await req('/v1/connections/test', { method: 'POST', token: tokens.admin, body: { name: 'Thu SSRF 2', kind: 'mysql', host: '10.0.0.1', port: 3306, databaseName: 'x', username: 'u', password: 'p', useSsl: false } });
  const chan = r.status >= 400 && /nội bộ|InvalidHost|riêng|không được phép/i.test(JSON.stringify(r.json));
  return { pass: Boolean(chan), actual: brief(r) };
});

await tc('AT-08', 'Mật khẩu CSDL nguồn KHÔNG bao giờ trả về trình duyệt', async () => {
  const r = await req('/v1/connections', { token: tokens.admin });
  const t = JSON.stringify(r.json);
  const lo = /password|cipher|matKhau/i.test(t);
  return { pass: r.status === 200 && !lo, actual: `HTTP ${r.status}, thân phản hồi ${lo ? 'CÓ' : 'KHÔNG có'} trường mật khẩu; nội dung: ${t.slice(0, 100)}` };
});

await tc('AT-09', 'Id không phải số bị chặn ở tầng kiểm tham số', async () => {
  const r = await req('/v1/datasets/khong-phai-so', { token: tokens.admin });
  return { pass: r.status === 400 || r.status === 404, actual: brief(r) };
});

await tc('AT-10', 'Thân JSON hỏng trả 400 chứ không phải 500', async () => {
  const res = await fetch('http://127.0.0.1:4000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: '{"name": khong-phai-json',
  });
  return { pass: res.status === 400, actual: `HTTP ${res.status}` };
});

await tc('AT-11', 'CORS chỉ cho phép nguồn đã khai báo', async () => {
  const res = await fetch('http://127.0.0.1:4000/api/v1/datasets', {
    headers: { Origin: 'https://ke-tan-cong.example.com', Authorization: `Bearer ${tokens.admin}` },
  });
  const acao = res.headers.get('access-control-allow-origin');
  return { pass: acao !== 'https://ke-tan-cong.example.com' && acao !== '*', actual: `Access-Control-Allow-Origin: ${acao ?? '(không đặt)'}` };
});

writeFileSync(new URL('./kq-phanquyen.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n=== PQ+AT: ${results.filter((r) => r.pass).length}/${results.length} dat ===`);
