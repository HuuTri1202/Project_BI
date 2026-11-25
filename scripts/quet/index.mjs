#!/usr/bin/env node
/**
 * Bộ quét hồi quy — `npm run quet`.
 *
 * ═══ Nó thay cho cái gì ════════════════════════════════════════════════════
 *
 * Commit `93023e7` gỡ toàn bộ tầng test (46.217 dòng, 151 tệp) và từ đó không
 * còn gì khoá lại thứ đã sửa. Hệ quả không phải "ít test hơn" mà là: mỗi lần
 * kiểm tra bằng tay là một lần lấy mẫu một PHẦN KHÁC của cùng một không gian,
 * nên lần nào cũng ra lỗi mới — không vì có lỗi mới sinh, mà vì lần trước chưa
 * soi tới đó. Và một chỗ đã sửa hỏng lại thì không ai biết.
 *
 * Bộ này không dựng lại tầng test đó. Nó chốt lấy những câu LUÔN PHẢI ĐÚNG mà
 * một vòng quét tay hay bỏ sót, rồi kiểm lại toàn bộ trong vài phút. Xem khối
 * đầu `lib.mjs` cho danh sách bất biến và lý do chọn chúng.
 *
 * ═══ Chạy ══════════════════════════════════════════════════════════════════
 *
 *   npm run quet                 — chạy hết
 *   npm run quet -- doc ghi      — chỉ hai mục đó
 *   npm run quet -- --help
 *
 * Cần `npm run dev` đang chạy (và `npm run infra:up:bi` cho mục luồng).
 * Thoát 0 khi tất cả đạt, 1 khi có mục trượt, 2 khi không chạy nổi.
 */
import { canhCong, dangNhapTatCa, GOC, VAI } from './lib.mjs';
import { quetDoc } from './doc.mjs';
import { quetGhi } from './ghi.mjs';
import { quetLuong } from './luong.mjs';
import { quetTrang } from './trang.mjs';

const MUC = {
  doc: { ten: 'đọc', chay: quetDoc },
  ghi: { ten: 'ghi', chay: quetGhi },
  luong: { ten: 'luồng', chay: quetLuong },
  trang: { ten: 'trang', chay: quetTrang },
};

function giupDo() {
  console.log(`
Bộ quét hồi quy Open Insight

  npm run quet                  chạy cả ${Object.keys(MUC).length} mục
  npm run quet -- doc ghi       chỉ những mục kể tên
  npm run quet -- --help        bản này

Mục:
${Object.entries(MUC)
  .map(([k, v]) => `  ${k.padEnd(7)} ${v.ten}`)
  .join('\n')}

Biến môi trường:
  QUET_API     địa chỉ backend (mặc định http://localhost:4000/api)
  QUET_WEB     địa chỉ frontend (mặc định http://localhost:5173)
  QUET_CHROME  đường dẫn Chrome, nếu mục "trang" không tự tìm ra
  QUET_*_EMAIL / QUET_*_MK   đổi tài khoản quét (SUPER, CHU, XEM, KHAC)
`);
}

const DAU_TRANG = { dat: '✔', truot: '✘', bo: '·' };

async function main() {
  const dv = process.argv.slice(2);
  if (dv.includes('--help') || dv.includes('-h')) {
    giupDo();
    return 0;
  }
  canhCong();

  const chon = dv.filter((a) => !a.startsWith('-'));
  const la = chon.length > 0 ? chon : Object.keys(MUC);
  const sai = la.filter((k) => MUC[k] === undefined);
  if (sai.length > 0) {
    console.error(`✘ không có mục: ${sai.join(', ')}\n  (có: ${Object.keys(MUC).join(', ')})`);
    return 2;
  }

  // Backend chưa chạy là tình huống thường gặp nhất, và nó phải nói ra việc cần
  // làm thay vì để 200 phép kiểm cùng trượt vì một lý do.
  const song = await fetch(`${GOC.replace(/\/api$/, '')}/health`).catch(() => null);
  if (song === null || !song.ok) {
    console.error(
      `\n✘ Không gọi được ${GOC.replace(/\/api$/, '')}/health\n` +
        '  Bật backend trước:  npm run dev\n',
    );
    return 2;
  }

  console.log(`\nQuét ${GOC}\n`);
  const phien = await dangNhapTatCa();
  for (const [ten, v] of Object.entries(phien)) {
    const tt = v.token !== undefined ? 'OK' : `KHÔNG VÀO ĐƯỢC — ${v.loi}`;
    console.log(
      `  ${v.token !== undefined ? '✔' : '·'} ${ten.padEnd(5)} ${VAI[ten].email.padEnd(28)} ${tt}`,
    );
  }
  if (Object.values(phien).every((v) => v.token === undefined)) {
    console.error(
      '\n✘ Không tài khoản nào đăng nhập được. Gieo dữ liệu mẫu (npm run db:seed) ' +
        'hoặc đổi tài khoản bằng QUET_*_EMAIL / QUET_*_MK.\n',
    );
    return 2;
  }

  const so = [];
  for (const k of la) {
    const t0 = Date.now();
    process.stdout.write(`\n── ${MUC[k].ten} `.padEnd(60, '─') + '\n');
    const s = await MUC[k].chay(phien);
    s.giay = ((Date.now() - t0) / 1000).toFixed(1);
    so.push(s);
    for (const c of s.ca) {
      console.log(`  ${DAU_TRANG[c.trang]} ${c.nhan}`);
      if (c.chiTiet !== '' && c.trang !== 'dat') console.log(`      ${c.chiTiet}`);
    }
  }

  // ─── tổng kết ─────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  let truot = 0;
  let bo = 0;
  let dat = 0;
  for (const s of so) {
    const d = s.ca.filter((c) => c.trang === 'dat').length;
    const t = s.ca.filter((c) => c.trang === 'truot').length;
    const b = s.ca.filter((c) => c.trang === 'bo').length;
    dat += d;
    truot += t;
    bo += b;
    const dauMuc = t > 0 ? '✘' : b > 0 ? '·' : '✔';
    console.log(
      `${dauMuc} ${s.ten.padEnd(52)} ${d} đạt` +
        `${t > 0 ? `, ${t} TRƯỢT` : ''}${b > 0 ? `, ${b} bỏ qua` : ''}  (${s.giay}s)`,
    );
  }
  console.log('═'.repeat(60));
  console.log(`${dat} đạt · ${truot} trượt · ${bo} bỏ qua`);
  if (bo > 0) {
    console.log(
      '\n"bỏ qua" KHÔNG phải đạt — nó là phép kiểm chưa chạy vì thiếu dữ liệu hoặc công cụ.',
    );
  }
  if (truot > 0) {
    console.log('\nChi tiết từng mục trượt ở trên, ngay dưới dòng ✘ của nó.');
    return 1;
  }
  return 0;
}

process.exitCode = await main();
