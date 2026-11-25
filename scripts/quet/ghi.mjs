/**
 * Bơm payload RÁC vào mọi endpoint ghi — bất biến: không bao giờ 5xx.
 *
 * ═══ Vì sao chỉ kiểm "không 5xx" mà không kiểm "phải đúng 400" ═════════════
 *
 * Cùng một payload rác có thể hợp lý mà ra 400 (sai kiểu), 403 (vai không đủ),
 * 404 (id không có), 409 (hạn mức gói), hay 422 — và chọn cái nào là quyết định
 * của từng endpoint, không phải một luật chung. Chốt cứng "phải 400" sẽ đỏ lên
 * mỗi lần ai đó sửa cho đúng hơn.
 *
 * Còn 5xx thì không bao giờ là câu trả lời đúng cho dữ liệu vào xấu: nó nghĩa là
 * một `throw` lọt qua tầng kiểm, và nó lộ stack trace ra ngoài. Đó mới là thứ
 * đáng chốt, và nó đúng với cả 43 endpoint mà không cần bảo trì.
 *
 * ⚠️ Payload ở đây cố ý SAI KIỂU nên không tạo được gì. Mục `luong.mjs` mới là
 * mục ghi dữ liệu thật, và nó tự dọn.
 */
import { doId, goi, soGhi } from './lib.mjs';

/** Mỗi payload nhắm một kiểu lỗi khác nhau ở tầng kiểm. */
const RAC = [
  {},
  { name: null },
  { name: '' },
  { name: 'x'.repeat(5000) },
  { id: 'khong-phai-so' },
  { workspaceId: -1 },
  [],
  'chuoi-tran',
  { __proto__: { bad: 1 } },
  undefined, // không có body
];

function duongGhi(id) {
  const m = id.moHinh ?? 1;
  const d = id.boDl ?? 1;
  const r = id.baoCao ?? 1;
  const w = id.ws ?? 1;
  return [
    ['POST', '/v1/workspaces'],
    ['POST', '/v1/members'],
    ['POST', '/v1/connections'],
    ['POST', '/v1/connections/test'],
    ['POST', '/v1/connections/databases'],
    ['POST', '/v1/datamodels'],
    ['POST', '/v1/reports'],
    ['POST', '/v1/reports/canvas'],
    ['POST', '/v1/reports/from-datamodel'],
    ['POST', `/v1/report-folders?workspaceId=${w}`],
    ['POST', `/v1/dataset-folders?workspaceId=${w}`],
    ['POST', '/v1/datasets/uploads'],
    ['POST', '/v1/orders'],
    ['POST', '/v1/chat/dien-dat'],
    ['POST', '/v1/chat/hieu-y'],
    ['POST', '/v1/chat/chon-cot'],
    ['PATCH', '/v1/tenant'],
    ['PATCH', `/v1/workspaces/${w}`],
    ['PATCH', `/v1/datasets/${d}`],
    ['PATCH', '/v1/datasets/folder'],
    ['PATCH', `/v1/datamodels/${m}`],
    ['PATCH', `/v1/datamodels/${m}/schema`],
    ['PATCH', `/v1/datamodels/${m}/layout`],
    ['PATCH', `/v1/reports/${r}`],
    ['PATCH', `/v1/reports/${r}/canvas`],
    ['PATCH', `/v1/reports/${r}/folder`],
    ['POST', `/v1/datamodels/${m}/measures`],
    ['POST', `/v1/datamodels/${m}/measures/formula`],
    ['POST', `/v1/datamodels/${m}/measures/row-expr`],
    ['POST', `/v1/datamodels/${m}/relationships`],
    ['POST', `/v1/datamodels/${m}/datasets`],
    ['POST', `/v1/datamodels/${m}/query`],
    ['POST', `/v1/datamodels/${m}/query/sql`],
    ['POST', `/v1/datamodels/${m}/report-preview`],
    ['POST', `/v1/datamodels/${m}/chat/cau-hoi`],
    ['POST', `/v1/datasets/${d}/analyze`],
    ['POST', `/v1/datasets/${d}/commit`],
    ['POST', `/v1/datasets/${d}/load`],
    ['POST', `/v1/datasets/${d}/uploads`],
    ['POST', `/v1/reports/${r}/shares`],
  ];
}

const GHI_ADMIN = [
  ['POST', '/admin/billing/plans'],
  ['PATCH', '/admin/billing/plans/1'],
  ['PATCH', '/admin/tenants/1/status'],
  ['PATCH', '/admin/users/1/status'],
  ['PATCH', '/admin/workspaces/1/status'],
  ['POST', '/admin/billing/simulate-transfer'],
  ['POST', '/admin/billing/subscriptions/override'],
  ['POST', '/admin/authz/reload'],
];

export async function quetGhi(phien) {
  const s = soGhi('Ghi — payload rác không được sinh 5xx');
  const bo = [];

  if (phien.chu?.token !== undefined) {
    bo.push(['tổ chức', duongGhi(await doId(phien.chu.token)), phien.chu.token]);
  } else {
    s.bo('endpoint ghi của tổ chức', `vai "chu" không đăng nhập được: ${phien.chu?.loi}`);
  }
  if (phien.sieu?.token !== undefined) {
    bo.push(['admin', GHI_ADMIN, phien.sieu.token]);
  } else {
    s.bo('endpoint ghi của /admin', `vai "sieu" không đăng nhập được: ${phien.sieu?.loi}`);
  }

  for (const [nhan, duongs, token] of bo) {
    const xau = [];
    let luot = 0;
    for (const [method, duong] of duongs) {
      for (const body of RAC) {
        const r = await goi(method, duong, { body, token });
        luot += 1;
        if (r.ma >= 500 || r.ma === 0) {
          xau.push(
            `${r.ma} ${method} ${duong}  body=${JSON.stringify(body)?.slice(0, 40) ?? '(không)'}\n` +
              `        ${r.chu.slice(0, 120)}`,
          );
        }
      }
    }
    s.can(
      xau.length === 0,
      `${nhan}: ${luot} lượt trên ${duongs.length} endpoint, không có 5xx`,
      xau.join('\n      '),
    );
  }

  // ─── mặt KHÔNG cần đăng nhập — phải fail closed ───────────────────────────
  const ngoai = [
    ['GET', '/public/reports/khong-ton-tai-abc', undefined, 'share không tồn tại'],
    ['GET', `/public/reports/${'../'.repeat(5)}etc/passwd`, undefined, 'path traversal'],
    ['POST', '/webhooks/khong-biet', {}, 'webhook cổng lạ'],
    [
      'POST',
      '/webhooks/sepay',
      { transferAmount: 'x', content: "'; DROP TABLE orders; --" },
      'webhook + SQL injection',
    ],
  ];
  const xauNgoai = [];
  for (const [m, d, body, nhan] of ngoai) {
    const r = await goi(m, d, { body });
    // Không token thì 2xx là RÒ, 5xx là hỏng. Chỉ 4xx mới đúng.
    if (!(r.ma >= 400 && r.ma < 500)) xauNgoai.push(`${nhan}: ${m} ${d} → ${r.ma}`);
  }
  s.can(
    xauNgoai.length === 0,
    `${ngoai.length} mặt không cần đăng nhập đều trả 4xx`,
    xauNgoai.join('\n      '),
  );

  return s;
}
