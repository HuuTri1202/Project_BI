/**
 * Mở từng trang của giao diện và soi xem có gì vỡ.
 *
 * ═══ Bất biến, và VÌ SAO không chốt chặt hơn ═══════════════════════════════
 *
 * Chỉ ba điều, vì chỉ ba điều này đúng bất kể database có gì:
 *
 *   1. Không trang nào sinh exception chưa bắt.
 *   2. Không trang nào gọi ra một request 5xx.
 *   3. Mỗi trang phải vẽ ra CHỮ — trang trắng là vỡ.
 *
 * ⚠️ Request 404 KHÔNG tính là trượt, và đó là kết luận sau một lần nhầm:
 * `/reports/:id` của một báo cáo mà mô hình đã bị xoá sẽ 404 ở `canvas-data`,
 * nhưng giao diện hiện đúng câu "Không tìm thấy mô hình dữ liệu này" — tức là
 * nó XỬ LÝ ĐÚNG. Chốt "không được có 404" sẽ biến cách xử lý đúng thành lỗi.
 *
 * Ngưỡng 80 ký tự cho điều 3 cũng vậy: trang `/404` chỉ có ~90 ký tự và nó
 * đúng như thế. Ngưỡng này bắt trang TRẮNG, không bắt trang ngắn.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moChrome, moTab, timChrome } from './cdp.mjs';
import { doId, soGhi } from './lib.mjs';

const WEB = process.env.QUET_WEB ?? 'http://localhost:5173';
const CHU_TOI_THIEU = 80;

/** Bỏ qua tiếng ồn của bàn thử dev, không phải của ứng dụng. */
const ON_AO = /favicon|\/@vite|\/@react-refresh|\.map(\?|$)|installHook|sockjs|__vite_ping/i;

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hạn chờ một trang vẽ xong. Hào phóng vì nó chỉ dùng hết khi trang THẬT trống. */
const HAN_CHO = 12_000;

/**
 * Chờ tới khi trang có chữ, rồi trả số ký tự — KHÔNG chờ cố định.
 *
 * Bản đầu chờ cứng 3,6 giây rồi đo. Nó chập chờn: cùng trang `/profile` cho 817
 * ký tự ở lần chạy nhẹ và 21 ký tự ở lần máy đang tải nặng (cả mục chậm từ 125s
 * lên 157s). Một phép kiểm lúc đỏ lúc xanh còn tệ hơn không có phép kiểm — nó
 * dạy người đọc bỏ qua màu đỏ.
 *
 * Chờ theo ĐIỀU KIỆN vừa hết chập chờn vừa nhanh hơn: trang bình thường trả về
 * sau ~300ms thay vì luôn ăn đủ 3,6 giây, và chỉ trang thật sự trống mới phải
 * chờ hết hạn.
 */
async function choCoChu(tab, nguong = CHU_TOI_THIEU) {
  const het = Date.now() + HAN_CHO;
  let soChu = 0;
  for (;;) {
    soChu = (await tab.chay('document.body.innerText.trim().length').catch(() => 0)) ?? 0;
    if (soChu >= nguong || Date.now() >= het) return soChu;
    await nghi(200);
  }
}

/**
 * Chờ tới khi một biểu thức JS trong trang trả về giá trị thật.
 *
 * Cùng lý do với `choCoChu`: mọi chỗ chờ CỐ ĐỊNH trong tệp này đều từng chập
 * chờn khi máy tải nặng. Đã gặp cả ở đăng nhập — chờ 5 giây sau khi bấm là đủ
 * lúc máy rảnh, nhưng lúc ClickHouse đang ngốn CPU thì chưa kịp điều hướng và
 * phép kiểm báo "vẫn ở /login" cho một lần đăng nhập hoàn toàn bình thường.
 */
async function choDen(tab, bieuThuc, hanMs = HAN_CHO) {
  const het = Date.now() + hanMs;
  for (;;) {
    const v = await tab.chay(bieuThuc).catch(() => null);
    if (v !== null && v !== undefined && v !== false) return v;
    if (Date.now() >= het) return null;
    await nghi(200);
  }
}

/** Đăng nhập qua giao diện thật, sau khi dọn phiên cũ. */
async function dangNhapTrang(tab, email, mk) {
  await tab.di(`${WEB}/login`, 600);
  await tab.chay('try { localStorage.clear(); sessionStorage.clear(); } catch {} 1');
  await tab.di(`${WEB}/login`, 400);

  // Chờ form hiện ra thay vì đoán nó mất bao lâu.
  const coForm = await choDen(
    tab,
    `(() => { const o=[...document.querySelectorAll('input')];
      return o.some((i)=>i.type==='password') && o.some((i)=>i.type==='email'||/email/i.test(i.name+i.id+i.placeholder)); })()`,
  );
  if (coForm === null) return `form đăng nhập không hiện sau ${HAN_CHO / 1000}s`;

  const dien = await tab.chay(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const o = [...document.querySelectorAll('input')];
    const e = o.find((i) => i.type === 'email' || /email/i.test(i.name + i.id + i.placeholder));
    const p = o.find((i) => i.type === 'password');
    if (!e || !p) return 'KHONG THAY O NHAP';
    e.focus(); set.call(e, ${JSON.stringify(email)}); e.dispatchEvent(new Event('input', { bubbles: true }));
    p.focus(); set.call(p, ${JSON.stringify(mk)}); p.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  if (dien !== 'ok') return dien;
  await nghi(400);
  await tab.chay(
    `([...document.querySelectorAll('button')].find((b) => /đăng nhập|dang nhap|sign in/i.test(b.innerText)))?.click(), 1`,
  );
  // Chờ ĐIỀU HƯỚNG, hạn dài hơn vì `/auth/login` phải băm mật khẩu bằng bcrypt
  // (đo được ~1,6 giây lúc máy rảnh) rồi trang đích mới nạp.
  const roiLogin = await choDen(tab, `location.pathname !== '/login'`, 25_000);
  if (roiLogin === null) {
    const loi = await tab.chay(
      `(document.querySelector('[role=alert]')?.innerText ?? '').trim().slice(0, 120)`,
    );
    return `vẫn ở /login sau 25s${loi === '' ? '' : ` — trang báo: ${loi}`}`;
  }
  return 'ok';
}

function trangCuaToChuc(id) {
  const ds = [
    '/home',
    '/datasets',
    '/datamodels',
    '/reports',
    '/reports/new',
    '/connections',
    '/connections/new',
    '/members',
    '/organization',
    '/profile',
    '/workspaces',
    '/billing',
    '/change-password',
    '/system-health',
    '/403',
    '/duong-khong-ton-tai-de-kiem-trang-404',
  ];
  if (id.boDl !== undefined) ds.push(`/datasets/${id.boDl}`);
  if (id.moHinh !== undefined) {
    ds.push(
      `/datamodels/${id.moHinh}`,
      `/datamodels/${id.moHinh}/explorer`,
      `/datamodels/${id.moHinh}/relationship`,
    );
  }
  if (id.baoCao !== undefined) ds.push(`/reports/${id.baoCao}`, `/reports/${id.baoCao}/edit`);
  return ds;
}

const TRANG_ADMIN = [
  '/admin',
  '/admin/tenants',
  '/admin/users',
  '/admin/workspaces',
  '/admin/billing/plans',
  '/admin/billing/methods',
  '/admin/billing/orders',
];

export async function quetTrang(phien) {
  const s = soGhi('Giao diện — exception, request 5xx, trang trắng');

  if (timChrome() === null) {
    s.bo(
      'cả mục',
      'không tìm thấy Chrome/Chromium/Edge. Đặt QUET_CHROME=<đường dẫn> nếu đã cài ở chỗ khác.',
    );
    return s;
  }
  const web = await fetch(WEB, { redirect: 'manual' }).catch(() => null);
  if (web === null) {
    s.bo('cả mục', `không gọi được ${WEB} — frontend chưa chạy? (npm run dev)`);
    return s;
  }

  let proc;
  let tab;
  try {
    const mo = await moChrome({ userDir: mkdtempSync(join(tmpdir(), 'quet-chrome-')) });
    proc = mo.proc;
    tab = await moTab(mo.port);
    for (const mien of ['Log', 'Runtime', 'Network', 'Page']) await tab.goi(`${mien}.enable`);
    await tab.khungNhin(1440, 900);

    let gom = [];
    tab.onSuKien((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const t = m.params.exceptionDetails?.exception?.description ?? '(không rõ)';
        if (!ON_AO.test(t)) gom.push({ loai: 'exception', chu: t.slice(0, 200) });
      }
      if (m.method === 'Network.responseReceived') {
        const { status, url } = m.params.response;
        if (status >= 500 && !ON_AO.test(url)) {
          gom.push({ loai: `HTTP ${status}`, chu: url.replace(/^https?:\/\/[^/]+/, '') });
        }
      }
    });

    for (const [vai, lay] of [
      ['chu', trangCuaToChuc],
      ['sieu', () => TRANG_ADMIN],
    ]) {
      const v = phien[vai];
      if (v?.token === undefined) {
        s.bo(`trang của vai "${vai}"`, `không đăng nhập được: ${v?.loi}`);
        continue;
      }
      const dn = await dangNhapTrang(tab, v.email, v.mk);
      if (dn !== 'ok') {
        s.truot(`đăng nhập trên giao diện bằng "${vai}"`, dn);
        continue;
      }
      s.dat(`đăng nhập trên giao diện bằng "${vai}"`);

      const duongs = lay(await doId(v.token));
      const vo = [];
      const trang = [];
      for (const p of duongs) {
        gom = [];
        await tab.di(`${WEB}${p}`, 300);
        const soChu = await choCoChu(tab);
        /*
         * Lắng thêm sau khi đã có chữ, và khoảng này KHÔNG dư.
         *
         * `choCoChu` về ngay khi trang vẽ xong, nhưng request có thể còn bay —
         * một lời gọi API chậm trả 5xx sau đó sẽ không ai gom nếu đo rồi đi
         * luôn. Nên chờ-theo-điều-kiện lo phép kiểm "trang trắng", còn khoảng
         * lắng này lo phép kiểm "không 5xx".
         */
        await nghi(1500);
        if (soChu < CHU_TOI_THIEU) trang.push(`${p} (${soChu} ký tự sau ${HAN_CHO / 1000}s)`);
        const rieng = [...new Map(gom.map((g) => [g.loai + g.chu, g])).values()];
        for (const g of rieng) vo.push(`${p} → ${g.loai}  ${g.chu}`);
      }
      s.can(
        vo.length === 0,
        `vai "${vai}": ${duongs.length} trang, không exception và không 5xx`,
        vo.join('\n      '),
      );
      s.can(trang.length === 0, `vai "${vai}": không trang nào trắng`, trang.join('\n      '));
    }
  } catch (err) {
    s.truot('mục dừng giữa đường', String(err?.message ?? err));
  } finally {
    try {
      tab?.dong();
    } catch {
      /* đóng được thì tốt, không thì thôi */
    }
    proc?.kill();
  }

  return s;
}
