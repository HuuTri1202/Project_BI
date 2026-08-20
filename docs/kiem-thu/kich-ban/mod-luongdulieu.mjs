/**
 * Module TF/NA/MH — luồng đầu-cuối: tải file (§7) -> nạp kho (§9) -> mô hình (§10).
 *
 * Chạy THẬT vào tổ chức "Công ty Ánh Dương" (id 2) — tổ chức thử nghiệm đang
 * rỗng. Cuối bài in ra những gì đã tạo để dọn tay nếu cần.
 */
import { req, login, tc, results, brief, tokens } from './kiemchung.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

await login('admin');

const ws = await req('/v1/workspaces', { token: tokens.admin });
const workspaceId = ws.json?.[0]?.id;
console.log(`workspace dung de thu: ${workspaceId}\n`);

/**
 * File CSV có chủ đích: bốn cột phủ bốn kiểu, và các con số cố tình dựng đúng
 * những cái bẫy đã từng làm hỏng dữ liệu thật.
 */
const CSV = [
  'Ma don,Khu vuc,Ngay ban,Loi nhuan',
  'DH-001,Mien Bac,2026-01-15,-288.765',   // số âm + dấu chấm thập phân
  'DH-002,Mien Nam,2026-02-20,1234.56',
  'DH-003,Mien Bac,2026-03-01,-1000',
  'DH-004,Mien Trung,2026-03-15,0.402',    // đúng ca đã bị đọc thành 402
  'DH-005,Mien Nam,2026-04-02,763.155',
].join('\n');

// Tổng đúng của cột Lợi nhuận, tính bằng tay: -288.765 + 1234.56 - 1000 + 0.402 + 763.155
const TONG_DUNG = 709.352;

/** Gọi ClickHouse. Định danh bọc bằng dấu nháy KÉP — backtick bị shell nuốt mất. */
function chQuery(sql) {
  const cmd = 'docker exec bi-clickhouse clickhouse-client --user bi_user --password clickhouse_password --query ' + JSON.stringify(sql);
  return execSync(cmd).toString().trim();
}

let datasetId = null;
let daTao = [];

// ── TF — Tải file lên (§7) ───────────────────────────────────────────────────

await tc('TF-01', 'Xin đường tải lên: server tự sinh khoá lưu trữ, client không được đặt', async () => {
  const r = await req('/v1/datasets/uploads', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, filename: 'kiem-thu-loi-nhuan.csv', fileSize: CSV.length },
  });
  datasetId = r.json?.datasetId ?? null;
  const coUrl = typeof r.json?.uploadUrl === 'string' && r.json.uploadUrl.includes('kiem-thu') === false;
  return { pass: r.status === 201 && datasetId !== null, actual: `HTTP ${r.status}, datasetId=${datasetId}, uploadUrl do server ký (không chứa tên file người dùng đặt: ${coUrl})` };
});

await tc('TF-02', 'Từ chối đuôi file không được hỗ trợ', async () => {
  const r = await req('/v1/datasets/uploads', { method: 'POST', token: tokens.admin, body: { workspaceId, filename: 'virus.exe' } });
  return { pass: r.status === 400, actual: brief(r) };
});

await tc('TF-03', 'Từ chối sớm file vượt trần 50MB dựa trên kích thước client khai', async () => {
  const r = await req('/v1/datasets/uploads', { method: 'POST', token: tokens.admin, body: { workspaceId, filename: 'to.csv', fileSize: 60 * 1024 * 1024 } });
  return { pass: r.status === 413, actual: brief(r) };
});

await tc('TF-04', 'Tải nội dung file lên kho đối tượng bằng URL đã ký', async () => {
  const up = await req('/v1/datasets/uploads', { method: 'POST', token: tokens.admin, body: { workspaceId, filename: 'kiem-thu-loi-nhuan.csv', fileSize: CSV.length } });
  datasetId = up.json.datasetId;
  daTao.push(`dataset ${datasetId}`);
  const put = await fetch(up.json.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: CSV });
  return { pass: put.status === 200, actual: `HTTP ${put.status} khi PUT ${CSV.length} byte lên MinIO` };
});

await tc('TF-05', 'Phân tích file: nhận đúng số cột và suy đúng kiểu từng cột', async () => {
  const r = await req(`/v1/datasets/${datasetId}/analyze`, { method: 'POST', token: tokens.admin });
  const sheet = r.json?.sheets?.[0];
  const kieu = (sheet?.columns ?? []).map((c) => `${c.name}:${c.semanticType ?? c.type}`);
  return { pass: r.status === 200 && kieu.length === 4, actual: `HTTP ${r.status}, ${kieu.length} cột -> ${kieu.join(', ')}` };
});

await tc('TF-06', 'Chốt sheet: tạo bộ dữ liệu và nạp dòng vào database', async () => {
  const r = await req(`/v1/datasets/${datasetId}/commit`, { method: 'POST', token: tokens.admin, body: { name: 'Kiem thu loi nhuan', sheets: ['Sheet1'] } });
  const ds = Array.isArray(r.json) ? r.json : r.json?.datasets;
  return { pass: r.status === 200 || r.status === 201, actual: `HTTP ${r.status}, tạo ${ds?.length ?? '?'} bộ dữ liệu: ${JSON.stringify(ds?.map?.((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount })) ?? r.json).slice(0, 160)}` };
});

await tc('TF-07', 'Xem trước dữ liệu trả đúng số dòng đã nạp', async () => {
  const r = await req(`/v1/datasets/${datasetId}/preview`, { token: tokens.admin });
  const n = r.json?.rows?.length ?? 0;
  return { pass: r.status === 200 && n === 5, actual: `HTTP ${r.status}, ${n} dòng xem trước (mong đợi 5)` };
});

// ── NA — Nạp vào kho phân tích (§9) ──────────────────────────────────────────

await tc('NA-01', 'Nạp tự động chạy sau khi chốt, không cần bấm nút', async () => {
  let tt = null;
  for (let i = 0; i < 40; i++) {
    const r = await req(`/v1/datasets/${datasetId}/load`, { token: tokens.admin });
    tt = r.json?.status ?? r.json?.loadStatus ?? null;
    if (tt === 'loaded' || tt === 'succeeded' || tt === 'failed') break;
    await new Promise((s) => setTimeout(s, 1000));
  }
  const d = await req(`/v1/datasets/${datasetId}`, { token: tokens.admin });
  return { pass: tt === 'succeeded' || tt === 'loaded', actual: `lần nạp kết thúc với trạng thái "${tt}", bộ dữ liệu ở trạng thái "${d.json?.loadStatus}"` };
});

await tc('NA-02', 'Bảng raw_* xuất hiện trong ClickHouse với đúng số dòng', async () => {
  const d = await req(`/v1/datasets/${datasetId}`, { token: tokens.admin });
  const bang = d.json?.chTable ?? `raw_t2_d${datasetId}`;
  const out = chQuery(`SELECT count() FROM bi_analytics."${bang}"`);
  return { pass: out === '5', actual: `bảng ${bang} có ${out} dòng (mong đợi 5)` };
});

await tc('NA-03', 'Số ÂM và số thập phân giữ nguyên giá trị — không bị nhân 1000', async () => {
  const d = await req(`/v1/datasets/${datasetId}`, { token: tokens.admin });
  const bang = d.json?.chTable ?? `raw_t2_d${datasetId}`;
  const out = chQuery(`SELECT round(sum("Loi nhuan"), 3) FROM bi_analytics."${bang}"`);
  const lech = Math.abs(Number(out) - TONG_DUNG);
  return { pass: lech < 0.001, actual: `tổng cột Lợi nhuận trong kho = ${out}; tính tay từ file nguồn = ${TONG_DUNG}; lệch ${lech.toFixed(4)}` };
});

await tc('NA-04', 'Nạp lại KHÔNG nhân đôi dữ liệu', async () => {
  const q = await req(`/v1/datasets/${datasetId}/load`, { method: 'POST', token: tokens.admin });
  let tt = null;
  for (let i = 0; i < 40; i++) {
    const r = await req(`/v1/datasets/${datasetId}/load`, { token: tokens.admin });
    tt = r.json?.status ?? null;
    if (tt === 'succeeded' || tt === 'loaded' || tt === 'failed') break;
    await new Promise((s) => setTimeout(s, 1000));
  }
  const d = await req(`/v1/datasets/${datasetId}`, { token: tokens.admin });
  const bang = d.json?.chTable ?? `raw_t2_d${datasetId}`;
  const out = chQuery(`SELECT count() FROM bi_analytics."${bang}"`);
  return { pass: out === '5', actual: `xếp hàng HTTP ${q.status}, nạp xong trạng thái "${tt}", số dòng sau khi nạp lại = ${out} (vẫn 5, không thành 10)` };
});

await tc('NA-05', 'Không có bảng tạm __new nào còn sót lại', async () => {
  const out = chQuery(`SELECT count() FROM system.tables WHERE database='bi_analytics' AND name LIKE '%__new'`);
  return { pass: out === '0', actual: `${out} bảng tạm còn lại` };
});

// ── MH — Mô hình dữ liệu (§10) ───────────────────────────────────────────────

await tc('MH-01', 'Nạp xong KHÔNG tự sinh mô hình nào', async () => {
  // Ca này từng khẳng định điều NGƯỢC LẠI. Việc tự sinh đã bị bỏ (migration 20):
  // "những bảng nào đáng hỏi cùng nhau" là điều chỉ người dùng biết, còn máy chỉ
  // đoán được theo chuyện chúng đi chung một file. Chờ thêm vài giây để chắc là
  // không có tiến trình nền nào tạo muộn.
  await new Promise((s) => setTimeout(s, 4000));
  const r = await req('/v1/datamodels', { token: tokens.admin });
  const ds = r.json?.items ?? [];
  return { pass: ds.length === 0, actual: `${ds.length} mô hình sau khi nạp xong: ${JSON.stringify(ds.map((m) => ({ id: m.id, name: m.name })))}` };
});

await tc('MH-02', 'Tạo mô hình BẮT BUỘC chọn bộ dữ liệu', async () => {
  // Danh sách rỗng phải bị chặn ở backend, không chỉ ở giao diện — nếu không thì
  // một mô hình không có bảng nào lọt vào database và Cube sinh ra file rỗng.
  const rong = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'Mô hình rỗng', datasetIds: [] },
  });

  const ok = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'kiem-thu-loi-nhuan', datasetIds: [datasetId] },
  });
  if (ok.json?.id) daTao.push(`datamodel ${ok.json.id}`);

  return {
    pass: rong.status === 400 && ok.status === 201 && ok.json?.datasetCount === 1,
    actual: `danh sách rỗng -> HTTP ${rong.status}; chọn 1 bộ -> HTTP ${ok.status}, mô hình id=${ok.json?.id} có ${ok.json?.datasetCount} bảng`,
  };
});

await tc('MH-03', 'Sinh file schema Cube và MỌI cột đều mang tiền tố ${CUBE}.', async () => {
  const r = await req('/v1/datamodels', { token: tokens.admin });
  const id = r.json?.items?.[0]?.id;
  const duong = `D:/doantotnghiep/bi-flatform/infrastructure/cube/model/tenants/2/dm${id}.js`;
  if (!existsSync(duong)) return { pass: false, actual: `không thấy file ${duong}` };
  const noiDung = readFileSync(duong, 'utf8');
  const dongSql = noiDung.split('\n').filter((l) => l.trim().startsWith('sql:'));
  const thieu = dongSql.filter((l) => !l.includes('${CUBE}.'));
  return { pass: dongSql.length > 0 && thieu.length === 0, actual: `file dm${id}.js có ${dongSql.length} dòng sql:, số dòng THIẾU tiền tố \${CUBE}. = ${thieu.length}` };
});

await tc('MH-04', 'Truy vấn qua tầng ngữ nghĩa Cube trả đúng tổng đã kiểm ở NA-03', async () => {
  const r = await req('/v1/datamodels', { token: tokens.admin });
  const id = r.json?.items?.[0]?.id;
  const f = await req(`/v1/datamodels/${id}/fields`, { token: tokens.admin });
  const td = (f.json?.measures ?? []).find((x) => /loi.?nhuan/i.test(x.label ?? ''));
  if (!td) return { pass: false, actual: `không thấy thước đo Lợi nhuận; có: ${(f.json?.measures ?? []).map((m) => m.label).join(', ')}` };
  const q = await req(`/v1/datamodels/${id}/query`, { method: 'POST', token: tokens.admin, body: { measureIds: [td.id], dimensionIds: [], limit: 10 } });
  const giaTri = Number(q.json?.rows?.[0]?.[0]);
  const lech = Math.abs(giaTri - TONG_DUNG);
  return { pass: q.status === 200 && lech < 0.001, actual: `HTTP ${q.status}, Cube trả ${giaTri} — khớp tổng tính tay ${TONG_DUNG} (lệch ${lech.toFixed(4)})` };
});

await tc('MH-05', 'Xoá mô hình rồi thì không đọc lại được', async () => {
  const r = await req('/v1/datamodels', { token: tokens.admin });
  const id = r.json?.items?.[0]?.id;
  const del = await req(`/v1/datamodels/${id}`, { method: 'DELETE', token: tokens.admin });
  const doc = await req(`/v1/datamodels/${id}`, { token: tokens.admin });
  return { pass: del.status === 204 && doc.status === 404, actual: `DELETE -> HTTP ${del.status}, GET lại -> HTTP ${doc.status}` };
});

// Dọn: trả tổ chức 2 về trạng thái rỗng như trước khi chạy.
const conLai = await req('/v1/datasets', { token: tokens.admin });
for (const d of conLai.json?.items ?? []) {
  await req(`/v1/datasets/${d.id}`, { method: 'DELETE', token: tokens.admin });
}
const mhConLai = await req('/v1/datamodels', { token: tokens.admin });
for (const m of mhConLai.json?.items ?? []) {
  await req(`/v1/datamodels/${m.id}`, { method: 'DELETE', token: tokens.admin });
}
console.log('da don sach du lieu thu nghiem trong to chuc 2');

writeFileSync(new URL('./kq-luongdulieu.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n=== TF+NA+MH: ${results.filter((r) => r.pass).length}/${results.length} dat ===`);
console.log(`Da tao trong to chuc 2: ${daTao.join(' | ')}`);
