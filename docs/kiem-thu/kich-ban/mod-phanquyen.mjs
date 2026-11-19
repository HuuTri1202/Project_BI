/** Module PQ — Phân quyền (§6) và AT — An toàn / cách ly tổ chức. */
import { req, login, tc, results, brief, tokens } from './kiemchung.mjs';
import { writeFileSync } from 'node:fs';

await login('admin');       // mai@anhduong.vn  — admin tổ chức Ánh Dương (id 2)
await login('superadmin');  // admin@bi-platform.local
await login('viewer');      // viewer@bi-platform.local — viewer tổ chức Open Insight

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

/*
 * Ca này đã bị LẬT, và việc lật nó là sửa kịch bản chứ không phải sửa sản phẩm.
 *
 * Bản cũ khẳng định "Viewer XEM được danh sách bộ dữ liệu -> 200", theo lý lẽ
 * "viewer là vai trò chỉ đọc nên cho đọc hết". Migration 26
 * (`viewer_reports_only`) CỐ Ý xoá `dataset:read` và `datamodel:read` của
 * viewer, với lý do ghi thẳng trong migration: "Người dựng báo cáo chọn chia sẻ
 * MỘT lát cắt; họ không chọn chia sẻ cả kho nằm dưới nó."
 *
 * Giữ nguyên bản cũ thì bộ kiểm thử báo một lỗi KHÔNG tồn tại, và tệ hơn: nó
 * gợi ý người đọc "sửa lại cho viewer xem được" — tức là hoàn tác một quyết
 * định bảo mật có chủ đích.
 */
await tc('PQ-03', 'Viewer KHÔNG xem được Kho dữ liệu — chỉ thấy báo cáo (migration 26)', async () => {
  const r = await req('/v1/datasets', { token: tokens.viewer });
  return { pass: r.status === 403, actual: brief(r) };
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

/*
 * ─── AT-06 và AT-07 phụ thuộc MÔI TRƯỜNG, và bản cũ không biết điều đó ──────
 *
 * `ALLOW_PRIVATE_DB_HOSTS` mặc định theo môi trường: dev CHO PHÉP địa chỉ dải
 * riêng, production CHẶN (xem `allowPrivateDbHosts` trong `config/env.ts`). Lý
 * do có thật: máy dev nối tới MySQL trong Docker qua chính địa chỉ dải riêng.
 *
 * Bản cũ đòi phải thấy câu từ chối của chốt SSRF, nên trên MỌI máy dev nó báo
 * "KHONG DAT" — và ai đọc hồ sơ sẽ tưởng hệ thống có lỗ hổng SSRF. Một ca test
 * không bao giờ đạt được ở môi trường nó đang chạy thì không đo gì cả, nó chỉ
 * dạy người ta bỏ qua màu đỏ.
 *
 * Bản này khẳng định điều ĐÚNG Ở MỌI MÔI TRƯỜNG: hệ thống KHÔNG ĐƯỢC báo nối
 * thành công tới một địa chỉ nội bộ. Rồi nó nói ra mình đang ở thế giới nào.
 *
 * ⚠️ `/v1/connections/test` trả HTTP **200** kèm `{ok: false, message}` khi thử
 * kết nối thất bại — nó là endpoint BÁO KẾT QUẢ THỬ, không phải endpoint tạo.
 * Chốt SSRF thì ném ra 4xx, vì `toConfig` nằm NGOÀI khối `try`. Nên bất biến
 * phải đọc `ok`, không phải đọc mã trạng thái; bản nháp của chính ca này đã
 * nhầm chỗ đó và dán nhãn "LỖ HỔNG" cho một lời gọi hoàn toàn bình thường.
 *
 * LUẬT chặn được chứng minh ở `backend/tests/guardHost.test.ts` — 33 ca, kiểm
 * thẳng `blockedReason` nên không phụ thuộc cờ môi trường. Việc của hai ca dưới
 * đây chỉ là nói sự thật về MÁY ĐANG CHẠY.
 */
async function thuSsrf(ten, host) {
  const r = await req('/v1/connections/test', {
    method: 'POST', token: tokens.admin,
    body: { name: ten, kind: 'mysql', host, port: 3306, databaseName: 'x', username: 'u', password: 'p', useSsl: false },
  });
  const noiDuoc = r.json?.ok === true;
  const chotChan = r.status >= 400 && /nội bộ|InvalidHost|riêng|không được phép|không hợp lệ/i.test(JSON.stringify(r.json));
  const nhan = noiDuoc
    ? 'NỐI ĐƯỢC tới địa chỉ nội bộ — ĐÂY LÀ LỖ HỔNG THẬT'
    : chotChan
      ? 'chốt SSRF chặn trước khi mở kết nối nào'
      : 'chốt SSRF đang TẮT (ALLOW_PRIVATE_DB_HOSTS — mặc định của dev, vì máy dev nối MySQL qua dải riêng); kết nối được mở rồi chết ở tầng mạng. Production bật chốt. Luật chặn: xem tests/guardHost.test.ts';
  return { pass: !noiDuoc, actual: `${brief(r)} -> ${nhan}` };
}

/*
 * Hai ID này mang đúng nghĩa trong `bo-test-case.html`, và bản cũ của script đã
 * gắn chúng vào một phép thử KHÁC HẲN:
 *
 *   AT-06  luật chặn ở chế độ production — hồ sơ ghi là "gọi thẳng
 *          resolveAndGuardHost với NODE_ENV=production", 4 địa chỉ nội bộ +
 *          1 công khai. Không chạy được qua HTTP trên máy dev. Giờ nó là test
 *          TỰ ĐỘNG: `backend/tests/guardHost.test.ts`, 33 ca thay cho 5.
 *   AT-07  cùng phép thử ở chế độ dev — CHO QUA, đúng chủ đích, để nối được
 *          127.0.0.1:3310 như tài liệu cài đặt hướng dẫn.
 *
 * Nên ở đây hai ca chỉ còn làm một việc: quan sát MÁY ĐANG CHẠY đang ở chế độ
 * nào, và khẳng định cái bất biến đúng ở cả hai chế độ.
 */
await tc('AT-06', 'Chặn SSRF — địa chỉ metadata nội bộ không nối được (luật: tests/guardHost.test.ts)', async () =>
  thuSsrf('Thu SSRF', '169.254.169.254'));

await tc('AT-07', 'Cùng phép thử ở chế độ phát triển — dải riêng 10.0.0.0/8', async () =>
  thuSsrf('Thu SSRF 2', '10.0.0.1'));

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
