/**
 * Quét mọi endpoint ĐỌC: 5xx, phân quyền, và cách ly giữa các tổ chức.
 *
 * Mục này là mục đã bắt được lỗi thật: `GET /datasets/:id/load/errors` trả
 * `200 {items:[]}` cho bộ dữ liệu của tổ chức KHÁC, trong khi cả sáu endpoint
 * `/datasets/:id/*` còn lại trả 404 (25/11/2026). Không có bất biến số 4 ở
 * `lib.mjs` thì nó chỉ là một dòng 200 trong một bảng dài, không ai nhìn.
 */
import { doId, goi, soGhi } from './lib.mjs';

/** Endpoint không cần id — chạy cho MỌI vai. */
const CHUNG = [
  '/auth/me',
  '/v1/',
  '/v1/permissions',
  '/v1/home',
  '/v1/tenant',
  '/v1/workspaces',
  '/v1/members',
  '/v1/connections/prerequisites',
  '/v1/connections',
  '/v1/plans',
  '/v1/payment-methods',
  '/v1/billing/me',
  '/v1/billing/plan',
  '/v1/billing/subscriptions',
  '/v1/orders',
  '/v1/chat/trang-thai',
  '/v1/datamodels',
];

/** Endpoint `/admin/*` — bất biến số 2. */
const ADMIN = [
  '/admin/overview',
  '/admin/tenants',
  '/admin/users',
  '/admin/workspaces',
  '/admin/billing/plans',
  '/admin/billing/payment-methods',
  '/admin/billing/orders',
  '/admin/billing/attention',
];

/**
 * Endpoint cần id, dựng từ những gì DÒ ĐƯỢC.
 *
 * Mỗi đường mang một `cot`, và sự phân biệt này là kết quả của một lần bất biến
 * đặt sai:
 *
 *   • `cot: 'nen'` — id vừa lấy từ chính endpoint danh sách, nên chủ sở hữu
 *     PHẢI đọc được (2xx). Không 2xx ở đây là endpoint hỏng.
 *
 *   • `cot: 'tuyThuoc'` — có 2xx hay không phụ thuộc TRẠNG THÁI, không phụ
 *     thuộc quyền. Ví dụ `/payment-methods/:id/qr` chỉ có ảnh khi người vận
 *     hành đã tải lên, nếu chưa thì 404 kèm "Phương thức này không có mã QR
 *     tĩnh" — đó là câu trả lời ĐÚNG. Bản đầu của bộ quét chốt 2xx cho cả nhóm
 *     này và báo trượt một endpoint đang chạy hoàn toàn bình thường.
 *
 * Cả hai cột vẫn bị kiểm "không 5xx" và "người ngoài tổ chức không được 2xx";
 * khác nhau chỉ ở câu hỏi "chủ sở hữu có buộc phải thấy dữ liệu không".
 */
function theoId(id) {
  const ra = [];
  const them = (co, duong, cot = 'nen') => {
    if (co !== undefined) ra.push({ duong, cot });
  };

  for (const d of ['', '/schema', '/measures', '/relationships', '/fields', '/explorer-status']) {
    them(id.moHinh, `/v1/datamodels/${id.moHinh}${d}`);
  }

  for (const d of ['', '/preview', '/load', '/load/errors']) {
    them(id.boDl, `/v1/datasets/${id.boDl}${d}`);
  }
  // 409 cho tới khi bộ dữ liệu được nạp xong — xem `requireLoadedTable`.
  them(id.boDl, `/v1/datasets/${id.boDl}/load/preview`, 'tuyThuoc');
  them(id.boDl, `/v1/datasets/${id.boDl}/load/schema`, 'tuyThuoc');

  them(id.baoCao, `/v1/reports/${id.baoCao}`);
  them(id.baoCao, `/v1/reports/${id.baoCao}/shares`);
  // `/data` chỉ đúng với báo cáo một ô, `/canvas-data` chỉ đúng với khung nhiều
  // ô — mỗi báo cáo là một trong hai, nên cái còn lại 404 là đúng.
  them(id.baoCao, `/v1/reports/${id.baoCao}/data`, 'tuyThuoc');
  them(id.baoCao, `/v1/reports/${id.baoCao}/canvas-data`, 'tuyThuoc');

  them(id.ws, `/v1/datasets?workspaceId=${id.ws}&page=1&pageSize=5`);
  them(id.ws, `/v1/reports?workspaceId=${id.ws}`);
  them(id.ws, `/v1/report-folders?workspaceId=${id.ws}`);
  them(id.ws, `/v1/dataset-folders?workspaceId=${id.ws}`);
  them(id.thanhVien, `/v1/members/${id.thanhVien}/workspaces`);
  them(id.donHang, `/v1/orders/${id.donHang}`);
  them(id.donHang, `/v1/orders/${id.donHang}/status`);

  // Hai đường này MỞ KẾT NỐI TCP thật tới CSDL của khách hàng, nên chúng hỏng
  // khi máy chủ đó tắt — một sự thật về mạng, không phải về mã nguồn. Chúng
  // cũng bị `connectionProbeLimit` chặn nhịp.
  them(id.ketNoi, `/v1/connections/${id.ketNoi}/databases`, 'tuyThuoc');
  them(id.ketNoi, `/v1/connections/${id.ketNoi}/tables`, 'tuyThuoc');
  // Chỉ có ảnh khi người vận hành đã tải lên — xem khối trên.
  them(id.cachTra, `/v1/payment-methods/${id.cachTra}/qr`, 'tuyThuoc');

  return ra;
}

export async function quetDoc(phien) {
  const s = soGhi('Đọc — 5xx, phân quyền, cách ly tổ chức');

  // ─── 1. không endpoint nào được 5xx, với mọi vai ──────────────────────────
  let soGoi = 0;
  for (const [ten, v] of Object.entries(phien)) {
    if (v.token === undefined) {
      s.bo(`vai "${ten}" (${v.mo})`, `không đăng nhập được: ${v.loi}`);
      continue;
    }
    const duongs = [...CHUNG, ...theoId(await doId(v.token)).map((x) => x.duong)];
    const xau = [];
    for (const d of duongs) {
      const r = await goi('GET', d, { token: v.token });
      soGoi += 1;
      if (r.ma >= 500 || r.ma === 0) xau.push(`${r.ma} ${d} — ${r.chu.slice(0, 80)}`);
    }
    s.can(
      xau.length === 0,
      `vai "${ten}": ${duongs.length} endpoint, không có 5xx`,
      xau.join('\n      '),
    );
  }

  // ─── 2. /admin: chỉ superadmin ────────────────────────────────────────────
  for (const [ten, v] of Object.entries(phien)) {
    if (v.token === undefined) continue;
    const mongDoi2xx = ten === 'sieu';
    const lech = [];
    for (const d of ADMIN) {
      const r = await goi('GET', d, { token: v.token });
      soGoi += 1;
      const ok = mongDoi2xx ? r.ma >= 200 && r.ma < 300 : r.ma === 403;
      if (!ok) lech.push(`${d} → ${r.ma} (mong ${mongDoi2xx ? '2xx' : '403'})`);
    }
    s.can(
      lech.length === 0,
      mongDoi2xx ? 'superadmin vào được mọi /admin' : `vai "${ten}" bị 403 ở mọi /admin`,
      lech.join('\n      '),
    );
  }

  // ─── 3. không token / token rác → 401 ─────────────────────────────────────
  for (const [nhan, tok] of [
    ['không token', undefined],
    ['token rác', 'abc.def.ghi'],
    ['token rỗng', ''],
  ]) {
    const r = await goi('GET', '/v1/datamodels', { token: tok });
    soGoi += 1;
    s.can(r.ma === 401, `${nhan} → 401`, `nhận ${r.ma}`);
  }

  // ─── 4 + 5. cách ly tổ chức, và chủ sở hữu vẫn vào được ───────────────────
  const chu = phien.chu;
  const khac = phien.khac;
  if (chu?.token === undefined || khac?.token === undefined) {
    s.bo('cách ly giữa hai tổ chức', 'cần cả vai "chu" và vai "khac" đăng nhập được');
  } else {
    const idChu = await doId(chu.token);
    const idKhac = await doId(khac.token);
    if (idChu.toChuc !== undefined && idChu.toChuc === idKhac.toChuc) {
      s.bo(
        'cách ly giữa hai tổ chức',
        `hai tài khoản đang ở CÙNG tổ chức #${idChu.toChuc} — phép kiểm này vô nghĩa, ` +
          'đổi QUET_KHAC_EMAIL sang một tài khoản ở tổ chức khác',
      );
    } else {
      const duongs = theoId(idChu);
      if (duongs.length === 0) {
        s.bo('cách ly giữa hai tổ chức', 'vai "chu" chưa có dữ liệu nào để làm mốc');
      } else {
        const ro = [];
        for (const { duong } of duongs) {
          const r = await goi('GET', duong, { token: khac.token });
          soGoi += 1;
          if (r.ma >= 200 && r.ma < 300) ro.push(`${duong} → ${r.ma}`);
        }
        s.can(
          ro.length === 0,
          `tổ chức khác KHÔNG đọc được ${duongs.length} đường của tổ chức này`,
          ro.length > 0
            ? `RÒ: những đường sau trả 2xx cho người ngoài tổ chức:\n      ${ro.join('\n      ')}`
            : '',
        );

        /*
         * Bất biến 5, tách làm hai vì một câu duy nhất thì hoặc quá chặt hoặc
         * quá lỏng:
         *
         *   5a — với MỌI đường: chủ sở hữu không bao giờ bị 401/403/5xx trên
         *        tài nguyên của chính mình. Câu này đúng không điều kiện.
         *   5b — với nhóm 'nen': phải 2xx. Thiếu câu này thì một endpoint hỏng
         *        trả 404 cho tất cả vẫn làm phép kiểm cách ly ở trên xanh.
         */
        const biChan = [];
        const nenMaKhong = [];
        for (const { duong, cot } of duongs) {
          const r = await goi('GET', duong, { token: chu.token });
          soGoi += 1;
          if ([401, 403].includes(r.ma) || r.ma >= 500 || r.ma === 0) {
            biChan.push(`${duong} → ${r.ma} ${r.chu.slice(0, 70)}`);
          } else if (cot === 'nen' && !(r.ma >= 200 && r.ma < 300)) {
            nenMaKhong.push(`${duong} → ${r.ma} ${r.chu.slice(0, 70)}`);
          }
        }
        s.can(
          biChan.length === 0,
          `chủ sở hữu không bị chặn ở ${duongs.length} đường của mình`,
          biChan.join('\n      '),
        );
        const soNen = duongs.filter((x) => x.cot === 'nen').length;
        s.can(
          nenMaKhong.length === 0,
          `${soNen} đường cốt của chủ sở hữu đều trả 2xx`,
          nenMaKhong.join('\n      '),
        );
      }
    }
  }

  s.dat(`tổng cộng ${soGoi} lời gọi`);
  return s;
}
