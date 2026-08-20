/**
 * Module TD — thước đo của mô hình dữ liệu (§10.6).
 *
 * Kiểm đúng hai thứ vừa thêm, và kiểm chúng tới tận CON SỐ mà Cube trả về chứ
 * không dừng ở chỗ "API nhận 200": một phép gộp sai tên chỉ lộ ra lúc Cube biên
 * dịch schema, tức là sau khi mọi lời gọi phía backend đều đã thành công.
 *
 *   1. `countDistinct` trên cột CHỮ — "bao nhiêu khu vực khác nhau".
 *   2. `min`/`max` trên cột NGÀY — "đơn đầu tiên / gần nhất".
 *   3. Phép gộp không hợp kiểu bị chặn ở BACKEND, không chỉ ở giao diện.
 *
 * Chạy THẬT vào tổ chức "Công ty Ánh Dương" (id 2), tự dọn ở cuối.
 */
import { req, login, tc, results, brief, tokens } from './kiemchung.mjs';
import { execSync } from 'node:child_process';

await login('admin');

const ws = await req('/v1/workspaces', { token: tokens.admin });
const workspaceId = ws.json?.[0]?.id;

/**
 * Ba khu vực khác nhau trên năm dòng, và năm mốc ngày cách nhau rõ ràng.
 *
 * Cố ý để "Mien Bac" lặp hai lần: `countDistinct` phải ra 3 chứ không phải 5.
 * Nếu ai đó lỡ sinh ra `count` thay vì `count_distinct` thì con số sẽ là 5, và
 * đó là khác biệt duy nhất phát hiện được lỗi đó từ bên ngoài.
 */
const CSV = [
  'Ma don,Khu vuc,Ngay ban,Loi nhuan,Da tra hang',
  'DH-001,Mien Bac,2026-01-15,-288.765,true',
  'DH-002,Mien Nam,2026-02-20,1234.56,false',
  'DH-003,Mien Bac,2026-03-01,-1000,true',
  'DH-004,Mien Trung,2026-03-15,0.402,false',
  'DH-005,Mien Nam,2026-04-02,763.155,false',
].join('\n');

const SO_KHU_VUC = 3;
const NGAY_DAU = '2026-01-15';

let datasetId = null;
let datamodelId = null;

/** Mọi thứ bài này tạo ra, để dọn ở cuối kể cả khi một ca chết giữa chừng. */
const daTao = { datasets: [], datamodels: [] };

/** Gọi ClickHouse. Định danh bọc bằng dấu nháy KÉP — backtick bị shell nuốt mất. */
function chQuery(sql) {
  const cmd =
    'docker exec bi-clickhouse clickhouse-client --user bi_user --password clickhouse_password --query ' +
    JSON.stringify(sql);
  return execSync(cmd).toString().trim();
}

// ── Dựng bàn thử: tải file, chờ nạp xong, tạo mô hình ────────────────────────

const up = await req('/v1/datasets/uploads', {
  method: 'POST', token: tokens.admin,
  body: { workspaceId, filename: 'kiem-thu-thuoc-do.csv', fileSize: CSV.length },
});
datasetId = up.json.datasetId;
await fetch(up.json.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: CSV });
await req(`/v1/datasets/${datasetId}/analyze`, { method: 'POST', token: tokens.admin });
await req(`/v1/datasets/${datasetId}/commit`, {
  method: 'POST', token: tokens.admin,
  body: { name: 'Kiem thu thuoc do', sheets: ['Sheet1'] },
});

for (let i = 0; i < 40; i++) {
  const r = await req(`/v1/datasets/${datasetId}/load`, { token: tokens.admin });
  const tt = r.json?.status ?? null;
  if (tt === 'succeeded' || tt === 'failed') break;
  await new Promise((s) => setTimeout(s, 1000));
}

const mh = await req('/v1/datamodels', {
  method: 'POST', token: tokens.admin,
  body: { workspaceId, name: 'kiem-thu-thuoc-do', datasetIds: [datasetId] },
});
datamodelId = mh.json?.id;
console.log(`ban thu: dataset ${datasetId}, datamodel ${datamodelId}\n`);

/*
 * Ảnh chụp bộ chọn NGAY sau khi tạo mô hình.
 *
 * Bắt buộc phải chụp ở đây: các ca bên dưới tự đặt thêm phép gộp cho cột chữ và
 * cột ngày, nên đọc lại danh sách ở cuối bài sẽ thấy những thước đo do CHÍNH
 * bài test tạo ra rồi tưởng là máy gieo.
 */
const goc = await req(`/v1/datamodels/${datamodelId}/fields`, { token: tokens.admin });
const thuocDoGoc = (goc.json?.measures ?? []).map((m) => m.label);
const chieuGoc = (goc.json?.dimensions ?? []).map((m) => m.label);

/** Cột theo tên, đọc từ tab Schemas của mô hình. */
async function cot(ten) {
  const r = await req(`/v1/datamodels/${datamodelId}/schema`, { token: tokens.admin });
  const ds = r.json?.datasets ?? [];
  for (const d of ds) {
    const c = (d.columns ?? []).find((x) => x.columnName === ten);
    if (c) return c;
  }
  return null;
}

/** Lưu một phép gộp cho một cột qua đúng đường mà tab Schemas đi. */
async function datPhepGop(column, agg) {
  return req(`/v1/datamodels/${datamodelId}/schema`, {
    method: 'PATCH', token: tokens.admin,
    body: {
      columns: [
        { columnId: column.id, alias: column.alias ?? null, role: column.role, measureAgg: agg },
      ],
    },
  });
}

/** Một thước đo trong bộ chọn của Explorer, theo nhãn. */
async function truong(tenThuocDo) {
  const f = await req(`/v1/datamodels/${datamodelId}/fields`, { token: tokens.admin });
  const ds = f.json?.measures ?? [];
  return ds.find((m) => m.label === tenThuocDo) ?? { thieu: ds.map((m) => m.label).join(', ') };
}

/**
 * Hỏi Cube một thước đo theo tên. `agg` có mặt = đổi phép gộp TẠI CHỖ.
 *
 * Trả cả nhãn cột kết quả, vì khi đã đổi phép thì nhãn phải nói ra phép nào —
 * hai cột cùng tên "Loi nhuan" tính bằng hai phép là bảng không đọc được.
 */
async function hoi(tenThuocDo, agg) {
  const td = await truong(tenThuocDo);
  if (td.thieu) return { loi: `khong thay thuoc do "${tenThuocDo}"; co: ${td.thieu}` };
  const q = await req(`/v1/datamodels/${datamodelId}/query`, {
    method: 'POST', token: tokens.admin,
    body: {
      measureIds: [td.id], dimensionIds: [], limit: 10,
      ...(agg ? { measureAggs: [{ id: td.id, agg }] } : {}),
    },
  });
  return {
    status: q.status,
    giaTri: q.json?.rows?.[0]?.[0],
    nhan: q.json?.columns?.[0]?.label,
    than: q.text.slice(0, 200),
  };
}

/**
 * Tải một CSV lên, chốt sheet, chờ nạp vào kho xong. Trả id bộ dữ liệu.
 *
 * Chờ hẳn tới khi nạp xong chứ không trả về ngay: mô hình dựng trên bảng trong
 * kho, và tạo mô hình khi bảng chưa tồn tại thì hỏng ở một chỗ khác hẳn chỗ
 * đang cần kiểm.
 */
async function taiLen(tenFile, noiDung, tenBo) {
  const up = await req('/v1/datasets/uploads', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, filename: tenFile, fileSize: noiDung.length },
  });
  if (up.status !== 201) return null;
  const id = up.json.datasetId;
  daTao.datasets.push(id);
  await fetch(up.json.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: noiDung });
  await req(`/v1/datasets/${id}/analyze`, { method: 'POST', token: tokens.admin });
  await req(`/v1/datasets/${id}/commit`, {
    method: 'POST', token: tokens.admin, body: { name: tenBo, sheets: ['Sheet1'] },
  });
  for (let i = 0; i < 40; i++) {
    const r = await req(`/v1/datasets/${id}/load`, { token: tokens.admin });
    const tt = r.json?.status ?? null;
    if (tt === 'succeeded') return id;
    if (tt === 'failed') return null;
    await new Promise((s) => setTimeout(s, 1000));
  }
  return null;
}

// ── TD — Thước đo ────────────────────────────────────────────────────────────

await tc('TD-01', 'Cột CHỮ nhận được phép đếm giá trị khác nhau', async () => {
  const c = await cot('Khu vuc');
  if (!c) return { pass: false, actual: 'khong tim thay cot "Khu vuc" trong mo hinh' };
  const r = await datPhepGop(c, 'countDistinct');
  return {
    pass: r.status === 200,
    actual: `cột "Khu vuc" kiểu ${c.chType} -> HTTP ${r.status} khi đặt countDistinct`,
  };
});

await tc('TD-02', 'Cube trả đúng SỐ GIÁ TRỊ KHÁC NHAU, không phải số dòng', async () => {
  const r = await hoi('Khu vuc');
  if (r.loi) return { pass: false, actual: r.loi };
  return {
    pass: r.status === 200 && Number(r.giaTri) === SO_KHU_VUC,
    actual: `HTTP ${r.status}, Cube trả ${r.giaTri} — mong đợi ${SO_KHU_VUC} khu vực khác nhau trên 5 dòng`,
  };
});

await tc('TD-03', 'Cột NGÀY nhận min/max — "đơn đầu tiên" và "đơn gần nhất"', async () => {
  const c = await cot('Ngay ban');
  if (!c) return { pass: false, actual: 'khong tim thay cot "Ngay ban"' };
  const r = await datPhepGop(c, 'min');
  const q = await hoi('Ngay ban');
  const ngay = String(q.giaTri ?? '').slice(0, 10);
  return {
    pass: r.status === 200 && ngay === NGAY_DAU,
    actual: `cột "Ngay ban" kiểu ${c.chType} -> HTTP ${r.status}; Cube trả ${q.giaTri} — mong đợi ${NGAY_DAU}`,
  };
});

await tc('TD-04', 'Phép gộp KHÔNG hợp kiểu bị backend chặn, không chỉ giao diện', async () => {
  const c = await cot('Khu vuc');
  const r = await datPhepGop(c, 'sum');
  const noiKieu = String(r.json?.message ?? '').includes('String');
  return {
    pass: r.status === 400 && noiKieu,
    actual: `đặt "Tổng" lên cột chữ -> ${brief(r)}`,
  };
});

await tc('TD-05', 'Cột số vẫn nhận đủ phép gộp cũ', async () => {
  const c = await cot('Loi nhuan');
  const r = await datPhepGop(c, 'sum');
  const q = await hoi('Loi nhuan');
  const lech = Math.abs(Number(q.giaTri) - 709.352);
  return {
    pass: r.status === 200 && lech < 0.001,
    actual: `HTTP ${r.status}; tổng Lợi nhuận = ${q.giaTri} (lệch ${lech.toFixed(4)} so với 709.352)`,
  };
});

await tc('TD-06', 'Cột boolean KHÔNG còn tự thành thước đo cộng', async () => {
  // `Da tra hang` mang true/false, §7 suy ra `boolean` và §9 nạp thành `UInt8`.
  // Trước bản này nó khớp luật "số -> thước đo" và được gieo `sum`, nằm ngay
  // cạnh `Loi nhuan` trong bộ chọn — một phép cộng cờ đúng/sai.
  const c = await cot('Da tra hang');
  return {
    pass:
      c?.chType?.includes('UInt8') === true &&
      c.role === 'dimension' &&
      !thuocDoGoc.includes('Da tra hang') &&
      chieuGoc.includes('Da tra hang'),
    actual:
      `cột "Da tra hang" kiểu ${c?.chType}, vai trò "${c?.role}"; ` +
      `thước đo tự gieo: [${thuocDoGoc.join(', ')}]; nằm trong chiều: ${chieuGoc.includes('Da tra hang')}`,
  };
});

await tc('TD-07', 'Bộ chọn Explorer nói rõ đổi được sang những phép nào', async () => {
  const td = await truong('Loi nhuan');
  const co = td.availableAggs ?? [];
  return {
    pass: td.agg === 'sum' && co.includes('avg') && co.includes('min') && co.includes('countDistinct'),
    actual: `thước đo "Loi nhuan": phép đang khai = "${td.agg}", đổi được sang [${co.join(', ')}]`,
  };
});

await tc('TD-08', 'Đổi phép NGAY TRONG truy vấn cho ra con số của phép mới', async () => {
  // 709.352 / 5 = 141.8704. Nếu backend lặng lẽ lùi về `sum` thì số vẫn là
  // 709.352 và HTTP vẫn 200 — đó là lý do ca này so SỐ chứ không so mã trạng thái.
  const q = await hoi('Loi nhuan', 'avg');
  const lech = Math.abs(Number(q.giaTri) - 141.8704);
  return {
    pass: q.status === 200 && lech < 0.001,
    actual: `HTTP ${q.status}, Cube trả ${q.giaTri} (tổng/5 = 141.8704, lệch ${lech.toFixed(4)}); nhãn cột = "${q.nhan}"`,
  };
});

await tc('TD-09', 'Mô hình KHÔNG bị đổi theo — lựa chọn chỉ áp cho truy vấn đó', async () => {
  // Sau TD-08 mà phép trong mô hình thành `avg` thì một cú bấm ở Explorer đã
  // sửa cấu hình chung, và người thứ hai mở mô hình không có cách nào biết.
  const td = await truong('Loi nhuan');
  const q = await hoi('Loi nhuan');
  const lech = Math.abs(Number(q.giaTri) - 709.352);
  return {
    pass: td.agg === 'sum' && lech < 0.001,
    actual: `phép trong mô hình vẫn "${td.agg}"; hỏi lại không kèm gì -> ${q.giaTri}`,
  };
});

await tc('TD-10', 'Phép không hợp kiểu bị từ chối ngay cả khi gửi thẳng vào truy vấn', async () => {
  const td = await truong('Khu vuc');
  const q = await req(`/v1/datamodels/${datamodelId}/query`, {
    method: 'POST', token: tokens.admin,
    body: { measureIds: [td.id], dimensionIds: [], measureAggs: [{ id: td.id, agg: 'sum' }] },
  });
  return { pass: q.status === 400, actual: `xin "Tổng" cho thước đo trên cột chữ -> ${brief(q)}` };
});

await tc('TD-11', 'Trung vị và phân vị 90 có mặt trong danh sách phép đổi được', async () => {
  const td = await truong('Loi nhuan');
  const co = td.availableAggs ?? [];
  return {
    pass: co.includes('median') && co.includes('p90'),
    actual: `"Loi nhuan" đổi được sang [${co.join(', ')}]`,
  };
});

await tc('TD-12', 'Trung vị trên mô hình MỘT bảng khớp ClickHouse', async () => {
  // Năm giá trị: -1000, -288.765, 0.402, 763.155, 1234.56 -> trung vị là 0.402.
  // So với `quantileExact` chạy thẳng trên kho, không so với số tính tay: nếu
  // hai bên lệch thì phải biết lệch ở tầng Cube hay ở chính phép của ClickHouse.
  const d = await req(`/v1/datasets/${datasetId}`, { token: tokens.admin });
  const bang = d.json?.chTable ?? `raw_t2_d${datasetId}`;
  const kho = Number(chQuery(`SELECT quantileExact(0.5)("Loi nhuan") FROM bi_analytics."${bang}"`));

  const q = await hoi('Loi nhuan', 'median');
  const lech = Math.abs(Number(q.giaTri) - kho);
  return {
    pass: q.status === 200 && lech < 0.001,
    actual: `Cube trả ${q.giaTri}; ClickHouse quantileExact(0.5) = ${kho}; lệch ${lech.toFixed(4)}`,
  };
});

await tc('TD-13', 'Trung vị KHÔNG bị nhân dòng khi mô hình có quan hệ one_to_many', async () => {
  /*
   * Ca đáng ngờ nhất của cả bản này, và lý do nó tồn tại nằm trong
   * `buildCubeSchema.ts`: Cube khử nhân bản dòng bằng cách bọc một truy vấn con
   * theo `primary_key`, nhưng cơ chế đó áp cho các KIỂU DỰNG SẴN. Trung vị phát
   * ra dưới dạng biểu thức `quantileExact(...)` tự viết, nên không có gì bảo
   * đảm nó cũng được bọc.
   *
   * ─── Bàn thử phải LỆCH có chủ đích ────────────────────────────────────────
   *
   *   khach: 3 dòng, Diem = 10, 20, 30
   *   don:   7 dòng — K1 có 5 đơn, K2 và K3 mỗi người 1 đơn
   *          cột `Kenh` để HẰNG 'Online' ở cả 7 dòng
   *
   * Gộp theo `Kenh` là mấu chốt. Nó chỉ có MỘT giá trị nên cả 7 dòng đã nối rơi
   * vào cùng một nhóm, và K1 xuất hiện 5 lần trong đó. Bản đầu của ca này gộp
   * theo `Ma don` — 7 nhóm, mỗi nhóm đúng một dòng khách — nên nhân dòng không
   * có cách nào lộ ra, và ca đó xanh mà chẳng kiểm được gì.
   *
   *   đúng (khử trùng lặp)  tổng = 60   trung vị của [10, 20, 30]              = 20
   *   sai  (bị nhân dòng)   tổng = 100  trung vị của [10,10,10,10,10,20,30]    = 10
   *
   * Kiểm CẢ `sum` lẫn `median` trong cùng một bàn thử: `sum` là kiểu dựng sẵn
   * nên nó nói cho biết Cube có khử trùng lặp ở tình huống này hay không, còn
   * `median` nói biểu thức tự viết có được hưởng cùng cơ chế đó không. Hai câu
   * trả lời khác nhau mới chỉ đúng được thủ phạm.
   */
  const csvKhach = ['Ma khach,Diem', 'K1,10', 'K2,20', 'K3,30'].join('\n');
  const csvDon = [
    'Ma don,Ma khach,Kenh',
    'D1,K1,Online', 'D2,K1,Online', 'D3,K1,Online', 'D4,K1,Online', 'D5,K1,Online',
    'D6,K2,Online', 'D7,K3,Online',
  ].join('\n');

  const dsKhach = await taiLen('kiem-thu-khach.csv', csvKhach, 'Khach');
  const dsDon = await taiLen('kiem-thu-don.csv', csvDon, 'Don');
  if (dsKhach === null || dsDon === null) return { pass: false, actual: 'khong dung duoc ban thu' };

  const mh2 = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'kiem-thu-nhan-dong', datasetIds: [dsKhach, dsDon] },
  });
  const mid = mh2.json?.id;
  if (!mid) return { pass: false, actual: `khong tao duoc mo hinh: ${brief(mh2)}` };
  daTao.datamodels.push(mid);

  const sc = await req(`/v1/datamodels/${mid}/schema`, { token: tokens.admin });
  const bang = sc.json?.datasets ?? [];
  const bKhach = bang.find((b) => (b.columns ?? []).some((c) => c.columnName === 'Diem'));
  const bDon = bang.find((b) => b.id !== bKhach?.id);
  const cotKhachMa = bKhach.columns.find((c) => c.columnName === 'Ma khach');
  const cotDonMa = bDon.columns.find((c) => c.columnName === 'Ma khach');

  // Khoá chính của phía "một" — chính là thứ Cube cần để khử trùng lặp.
  await req(`/v1/datamodels/${mid}/datasets/${bKhach.id}`, {
    method: 'PATCH', token: tokens.admin, body: { primaryColumnId: cotKhachMa.id },
  });

  const qh = await req(`/v1/datamodels/${mid}/relationships`, {
    method: 'POST', token: tokens.admin,
    body: {
      leftId: bKhach.id, leftColumnId: cotKhachMa.id,
      rightId: bDon.id, rightColumnId: cotDonMa.id,
      kind: 'one_to_many',
    },
  });
  if (qh.status !== 201) return { pass: false, actual: `khong tao duoc quan he: ${brief(qh)}` };

  const f = await req(`/v1/datamodels/${mid}/fields`, { token: tokens.admin });
  const tdDiem = (f.json?.measures ?? []).find((m) => m.label === 'Diem');
  const chieuKenh = (f.json?.dimensions ?? []).find((x) => x.label === 'Kenh');
  if (!tdDiem || !chieuKenh) {
    return {
      pass: false,
      actual: `thieu truong; thuoc do: [${(f.json?.measures ?? []).map((m) => m.label).join(', ')}], ` +
        `chieu: [${(f.json?.dimensions ?? []).map((m) => m.label).join(', ')}]`,
    };
  }

  async function hoiQuaJoin(agg) {
    const r = await req(`/v1/datamodels/${mid}/query`, {
      method: 'POST', token: tokens.admin,
      body: {
        measureIds: [tdDiem.id], dimensionIds: [chieuKenh.id], limit: 50,
        ...(agg ? { measureAggs: [{ id: tdDiem.id, agg }] } : {}),
      },
    });
    return Number(r.json?.rows?.[0]?.[1]);
  }

  const tong = await hoiQuaJoin();            // sum — kiểu dựng sẵn
  const trungVi = await hoiQuaJoin('median'); // biểu thức tự viết

  return {
    pass: Math.abs(tong - 60) < 0.001 && Math.abs(trungVi - 20) < 0.001,
    actual:
      `gộp theo Kenh (1 nhóm, 7 dòng đã nối): tổng = ${tong} (đúng 60 · nhân dòng 100), ` +
      `trung vị = ${trungVi} (đúng 20 · nhân dòng 10)`,
  };
});

await tc('TD-14', 'Nhãn cột nói tên người dùng đọc được, không phải tên thống kê', async () => {
  // "Phân vị 90" là tên đúng trong thống kê và là tên vô dụng với người đọc báo
  // cáo bán hàng. Ca này ghim cái tên đi hết đường từ `shared` qua `explorer.ts`
  // ra tới nhãn cột trong phản hồi API — ba chỗ, một tên.
  const q = await hoi('Loi nhuan', 'p90');
  return {
    pass: q.nhan === 'Loi nhuan (Ngưỡng top 10%)',
    actual: `nhãn cột = "${q.nhan}"`,
  };
});

await tc('TD-15', 'Hai truy vấn mà khối cảnh báo so lệch đủ xa để phải nói ra', async () => {
  /*
   * Explorer chạy một truy vấn ĐỐI CHỨNG bằng trung vị rồi so với trung bình,
   * và chỉ cảnh báo khi lệch quá 50%. Ca này kiểm đúng cặp số đó qua API thật —
   * phần so sánh nằm ở trình duyệt nên không tới được từ đây, nhưng nếu hai con
   * số này sai thì mọi thứ dựng trên chúng đều sai theo.
   *
   * Năm giá trị: -1000, -288.765, 0.402, 763.155, 1234.56.
   * Trung bình 141.8704 — bị hai đầu cực kéo đi; trung vị 0.402.
   */
  const tb = await hoi('Loi nhuan', 'avg');
  const tv = await hoi('Loi nhuan', 'median');
  const lech = Math.abs(Number(tb.giaTri) - Number(tv.giaTri)) / Math.abs(Number(tv.giaTri));

  return {
    pass:
      Math.abs(Number(tb.giaTri) - 141.8704) < 0.001 &&
      Math.abs(Number(tv.giaTri) - 0.402) < 0.001 &&
      lech > 0.5,
    actual:
      `trung bình = ${tb.giaTri}, trung vị = ${tv.giaTri}, ` +
      `lệch ${lech.toFixed(1)} lần (ngưỡng cảnh báo 0.5)`,
  };
});

await tc('TD-16', 'Đếm ô có dữ liệu KHÁC đếm dòng — và đó là lý do phép này tồn tại', async () => {
  /*
   * Bản trước cấm hẳn `count` trên cột vì tin rằng nó chỉ đẻ ra bản sao của
   * thước đo "Số dòng". Ca này là bằng chứng ngược lại, đo trên ClickHouse thật.
   *
   * `Diem` để trống ở hai trong năm dòng. `normalizeCell` lưu ô trống thành
   * `null` (không phải chuỗi rỗng, không phải 0), và `count(cột)` của ClickHouse
   * bỏ qua NULL:
   *
   *     Số dòng          5
   *     Đếm ô có dữ liệu 3
   *     Tổng            90
   *
   * Nếu `count` lỡ sinh ra `count(<khoá chính>)` thì con số giữa sẽ là 5, bằng
   * đúng con số trên — và đó chính là hình dạng lỗi mà lệnh cấm cũ lo sợ.
   */
  const csv = ['Ma don,Diem', 'D1,10', 'D2,', 'D3,30', 'D4,', 'D5,50'].join('\n');
  const ds = await taiLen('kiem-thu-o-trong.csv', csv, 'O trong');
  if (ds === null) return { pass: false, actual: 'khong dung duoc ban thu' };

  const mh = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'kiem-thu-o-trong', datasetIds: [ds] },
  });
  const mid = mh.json?.id;
  if (!mid) return { pass: false, actual: `khong tao duoc mo hinh: ${brief(mh)}` };
  daTao.datamodels.push(mid);

  const f = await req(`/v1/datamodels/${mid}/fields`, { token: tokens.admin });
  const ds_ = f.json?.measures ?? [];
  const tdDiem = ds_.find((m) => m.label === 'Diem');
  const tdDong = ds_.find((m) => m.label === 'Số dòng');
  if (!tdDiem || !tdDong) {
    return { pass: false, actual: `thieu thuoc do; co: [${ds_.map((m) => m.label).join(', ')}]` };
  }

  async function hoiMid(id, agg) {
    const r = await req(`/v1/datamodels/${mid}/query`, {
      method: 'POST', token: tokens.admin,
      body: {
        measureIds: [id], dimensionIds: [], limit: 10,
        ...(agg ? { measureAggs: [{ id, agg }] } : {}),
      },
    });
    return Number(r.json?.rows?.[0]?.[0]);
  }

  const soDong = await hoiMid(tdDong.id);
  const soO = await hoiMid(tdDiem.id, 'count');
  const tong = await hoiMid(tdDiem.id, 'sum');

  return {
    pass: soDong === 5 && soO === 3 && Math.abs(tong - 90) < 0.001,
    actual:
      `Số dòng = ${soDong} (đúng 5) · đếm ô có dữ liệu = ${soO} (đúng 3, hai ô trống) · ` +
      `tổng = ${tong} (đúng 90)`,
  };
});

await tc('TD-17', 'Gộp trên biểu thức dòng: nhân TRƯỚC rồi cộng, khớp ClickHouse', async () => {
  /*
   * Đây là chỗ khác giữa hai CON SỐ, không phải hai lối viết cho cùng một số.
   *
   *   sum(sl × don gia)      = 2*100 + 1*250 + 5*40 + 3*70 = 860   đúng
   *   sum(sl) × avg(don gia) = 11 × 115                    = 1265  sai
   *
   * Đo trên dữ liệu thật thì khoảng cách hẹp hơn nhiều (0,047% trên 22.463
   * dòng của tổ chức 4) — chính vì thế bàn thử ở đây cố ý để lệch rõ, còn ca
   * đối chiếu với ClickHouse ở dưới mới là thứ canh con số.
   */
  const csv = ['Ma hang,So luong,Don gia', 'H1,2,100', 'H2,1,250', 'H3,5,40', 'H4,3,70'].join(String.fromCharCode(10));
  const ds = await taiLen('kiem-thu-thanh-tien.csv', csv, 'Thanh tien');
  if (ds === null) return { pass: false, actual: 'khong dung duoc ban thu' };

  const mh = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'kiem-thu-thanh-tien', datasetIds: [ds] },
  });
  const mid = mh.json?.id;
  if (!mid) return { pass: false, actual: `khong tao duoc mo hinh: ${brief(mh)}` };
  daTao.datamodels.push(mid);

  const sc = await req(`/v1/datamodels/${mid}/schema`, { token: tokens.admin });
  const cols = sc.json?.datasets?.[0]?.columns ?? [];
  const cSl = cols.find((c) => c.columnName === 'So luong');
  const cDg = cols.find((c) => c.columnName === 'Don gia');
  if (!cSl || !cDg) {
    return { pass: false, actual: `thieu cot; co: [${cols.map((c) => c.columnName).join(', ')}]` };
  }

  const tao = await req(`/v1/datamodels/${mid}/measures/row-expr`, {
    method: 'POST', token: tokens.admin,
    body: {
      name: 'Doanh thu', agg: 'sum',
      leftColumnId: cSl.id, op: 'mul', rightColumnId: cDg.id,
      format: 'number',
    },
  });
  if (tao.status !== 201) return { pass: false, actual: `tao thuoc do that bai: ${brief(tao)}` };

  const q = await req(`/v1/datamodels/${mid}/query`, {
    method: 'POST', token: tokens.admin,
    body: { measureIds: [tao.json.id], dimensionIds: [], limit: 10 },
  });
  const cube = Number(q.json?.rows?.[0]?.[0]);
  // Định danh bọc bằng nháy KÉP, không phải dấu huyền — xem ghi chú ở `chQuery`.
  const ch = Number(
    chQuery(`SELECT sum("So luong" * "Don gia") FROM bi_analytics."raw_t2_d${ds}"`),
  );

  return {
    pass: Math.abs(cube - 860) < 0.001 && Math.abs(cube - ch) < 0.001,
    actual:
      `Cube tra ${cube} · ClickHouse sum(sl x don gia) = ${ch} · dung 860 ` +
      `(gop truoc roi nhan se ra 1265)`,
  };
});

await tc('TD-18', 'Biểu thức dòng KHÔNG bị nhân bản khi mô hình có quan hệ one_to_many', async () => {
  /*
   * `sum` là kiểu DỰNG SẴN nên về lý thuyết nó được hưởng cơ chế khử nhân bản
   * dòng của Cube. Nhưng ở đây `sql` là một BIỂU THỨC tự viết, và TD-13 tồn tại
   * vì đúng câu hỏi đó chưa từng có lời hứa nào trong tài liệu.
   *
   * Bàn thử: 2 mặt hàng, mặt hàng H1 xuất hiện trong 4 đơn.
   *
   *   đúng (khử trùng lặp)  sum(sl × don gia) trên 2 dòng hàng = 2*100 + 3*70 = 410
   *   sai  (bị nhân dòng)   H1 đếm 4 lần                       = 8*100 + 3*70 = 1010
   */
  const csvHang = ['Ma hang,So luong,Don gia', 'H1,2,100', 'H2,3,70'].join(String.fromCharCode(10));
  const csvDon = [
    'Ma don,Ma hang,Kenh',
    'D1,H1,Online', 'D2,H1,Online', 'D3,H1,Online', 'D4,H1,Online', 'D5,H2,Online',
  ].join(String.fromCharCode(10));

  const dsHang = await taiLen('kiem-thu-hang.csv', csvHang, 'Hang');
  const dsDon = await taiLen('kiem-thu-don-hang.csv', csvDon, 'DonHang');
  if (dsHang === null || dsDon === null) return { pass: false, actual: 'khong dung duoc ban thu' };

  const mh = await req('/v1/datamodels', {
    method: 'POST', token: tokens.admin,
    body: { workspaceId, name: 'kiem-thu-nhan-dong-bieuthuc', datasetIds: [dsHang, dsDon] },
  });
  const mid = mh.json?.id;
  if (!mid) return { pass: false, actual: `khong tao duoc mo hinh: ${brief(mh)}` };
  daTao.datamodels.push(mid);

  const sc = await req(`/v1/datamodels/${mid}/schema`, { token: tokens.admin });
  const bang = sc.json?.datasets ?? [];
  const bHang = bang.find((b) => (b.columns ?? []).some((c) => c.columnName === 'Don gia'));
  const bDon = bang.find((b) => b.id !== bHang?.id);
  const cHangMa = bHang.columns.find((c) => c.columnName === 'Ma hang');
  const cDonMa = bDon.columns.find((c) => c.columnName === 'Ma hang');
  const cSl = bHang.columns.find((c) => c.columnName === 'So luong');
  const cDg = bHang.columns.find((c) => c.columnName === 'Don gia');

  await req(`/v1/datamodels/${mid}/datasets/${bHang.id}`, {
    method: 'PATCH', token: tokens.admin, body: { primaryColumnId: cHangMa.id },
  });
  const qh = await req(`/v1/datamodels/${mid}/relationships`, {
    method: 'POST', token: tokens.admin,
    body: {
      leftId: bHang.id, leftColumnId: cHangMa.id,
      rightId: bDon.id, rightColumnId: cDonMa.id,
      kind: 'one_to_many',
    },
  });
  if (qh.status !== 201) return { pass: false, actual: `khong tao duoc quan he: ${brief(qh)}` };

  const tao = await req(`/v1/datamodels/${mid}/measures/row-expr`, {
    method: 'POST', token: tokens.admin,
    body: {
      name: 'Doanh thu', agg: 'sum',
      leftColumnId: cSl.id, op: 'mul', rightColumnId: cDg.id,
      format: 'number',
    },
  });
  if (tao.status !== 201) return { pass: false, actual: `tao thuoc do that bai: ${brief(tao)}` };

  const f = await req(`/v1/datamodels/${mid}/fields`, { token: tokens.admin });
  const chieuKenh = (f.json?.dimensions ?? []).find((x) => x.label === 'Kenh');
  if (!chieuKenh) {
    return { pass: false, actual: `thieu chieu Kenh; co: [${(f.json?.dimensions ?? []).map((x) => x.label).join(', ')}]` };
  }

  const q = await req(`/v1/datamodels/${mid}/query`, {
    method: 'POST', token: tokens.admin,
    body: { measureIds: [tao.json.id], dimensionIds: [chieuKenh.id], limit: 50 },
  });
  const cube = Number(q.json?.rows?.[0]?.[1]);

  return {
    pass: Math.abs(cube - 410) < 0.001,
    actual: `gop theo Kenh (1 nhom, 5 dong da noi): ${cube} (dung 410 · nhan dong 1010)`,
  };
});

await tc('TD-19', 'Bộ chọn nói ra phép tính, không bắt người dùng đoán từ cái tên', async () => {
  /*
   * Thước đo gieo sẵn mang ĐÚNG tên cột nó gộp, nên trên màn hình
   * "Loi nhuan" (cột, lãi của MỘT đơn) và "Loi nhuan" (thước đo, lãi gộp
   * của cả nhóm) là hai dòng chữ y hệt nhau. Ca này ghim câu giải thích đi
   * hết đường: `nguon` ở bộ chọn, `mota` ở tiêu đề cột kết quả.
   *
   * Và `mota` phải theo phép THẬT SỰ chạy: đổi sang trung vị mà tiêu đề
   * vẫn nói "Tổng" là nói sai đúng lúc người dùng cần đọc nhất.
   */
  const td = await truong('Loi nhuan');
  if (td.thieu) return { pass: false, actual: `khong thay thuoc do Loi nhuan; co: ${td.thieu}` };

  const soDong = await truong('Số dòng');

  const q = await req(`/v1/datamodels/${datamodelId}/query`, {
    method: 'POST', token: tokens.admin,
    body: { measureIds: [td.id], dimensionIds: [], limit: 10, measureAggs: [{ id: td.id, agg: 'median' }] },
  });

  const nguon = td.nguon ?? {};
  const mota = q.json?.columns?.[0]?.mota;
  const motaDong = soDong.thieu ? null : (soDong.nguon ?? {}).kind;

  return {
    pass:
      nguon.kind === 'column' &&
      nguon.expr === 'Loi nhuan' &&
      mota === 'Trung vị của Loi nhuan' &&
      motaDong === 'rows',
    actual:
      `nguon = ${JSON.stringify(nguon)} · mota cột kết quả = "${mota}" ` +
      `· "Số dòng" có kind = ${motaDong}`,
  };
});
await tc('TD-20', 'Tên của thước đo đã xoá được dùng lại — và tên đang sống thì không', async () => {
  /*
   * Lỗi thật, người dùng gặp: tạo "doanh thu", xoá đi, tạo lại -> HTTP 500.
   *
   * Khoá UNIQUE cũ `(datamodel_id, name)` KHÔNG có `deleted_at`, còn mọi câu
   * kiểm trùng tên trong mã đều lọc `deleted_at IS NULL`. Database và mã hiểu
   * khác nhau về cùng một luật: mã bảo tên trống, MySQL bảo đã có. Người dùng
   * mất hẳn cái tên đó, xoá lần nữa cũng không lấy lại được.
   *
   * Ca này đi cả HAI chiều, vì bản vá sai rất dễ chữa chiều này mà mở toang
   * chiều kia — thêm `deleted_at` vào khoá UNIQUE là đúng một bản vá như vậy:
   * NULL trong MySQL không bằng NULL, nên hai thước đo trùng tên CÒN SỐNG sẽ
   * lọt qua.
   */
  const sc = await req(`/v1/datamodels/${datamodelId}/schema`, { token: tokens.admin });
  const cols = sc.json?.datasets?.[0]?.columns ?? [];
  const c = cols.find((x) => x.columnName === 'Loi nhuan');
  if (!c) return { pass: false, actual: `thieu cot Loi nhuan; co: [${cols.map((x) => x.columnName).join(', ')}]` };

  // Hai vế trùng nhau được phép — `sum(x × x)` là bình phương, một câu hỏi thật.
  const than = {
    name: 'TD20 trung ten', agg: 'sum',
    leftColumnId: c.id, op: 'mul', rightColumnId: c.id, format: 'number',
  };
  const tao = () => req(`/v1/datamodels/${datamodelId}/measures/row-expr`, {
    method: 'POST', token: tokens.admin, body: than,
  });

  const lan1 = await tao();
  if (lan1.status !== 201) return { pass: false, actual: `lan tao dau that bai: ${brief(lan1)}` };

  const xoa = await req(`/v1/datamodels/${datamodelId}/measures/${lan1.json.id}`, {
    method: 'DELETE', token: tokens.admin,
  });

  const lan2 = await tao();          // phai duoc — ten da tra lai
  const lan3 = await tao();          // phai bi chan 409, khong phai 500

  if (lan2.status === 201) {
    await req(`/v1/datamodels/${datamodelId}/measures/${lan2.json.id}`, {
      method: 'DELETE', token: tokens.admin,
    });
  }

  return {
    pass: xoa.status === 204 && lan2.status === 201 && lan3.status === 409,
    actual:
      `tao lan 1 = ${lan1.status} · xoa = ${xoa.status} · ` +
      `tao lai cung ten = ${lan2.status} (truoc ban va: 500) · ` +
      `tao trung ten DANG SONG = ${lan3.status} (phai 409)`,
  };
});
// ── Dọn ──────────────────────────────────────────────────────────────────────

// Mô hình TRƯỚC bộ dữ liệu: xoá bộ dữ liệu còn mô hình dùng nó thì bị từ chối.
for (const id of [...new Set([datamodelId, ...daTao.datamodels])]) {
  if (id) await req(`/v1/datamodels/${id}`, { method: 'DELETE', token: tokens.admin });
}
for (const id of [...new Set([datasetId, ...daTao.datasets])]) {
  if (id) await req(`/v1/datasets/${id}`, { method: 'DELETE', token: tokens.admin });
}
console.log('da don sach ban thu');

const dat = results.filter((r) => r.pass).length;
console.log(`\n=== TD: ${dat}/${results.length} dat ===`);
