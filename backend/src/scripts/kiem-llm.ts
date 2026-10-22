/**
 * Kiểm tra khung hỏi đáp đã nối được tới mô hình ngôn ngữ hay chưa.
 *
 *   npm run llm:kiem
 *
 * ═══ Vì sao cần một lệnh riêng ═════════════════════════════════════════════
 *
 * Khung hỏi đáp CỐ Ý không bao giờ hỏng vì lớp mô hình: chưa có khoá, sai khoá,
 * hết lượt, mất mạng — tất cả đều ra cùng một kết quả, là câu mẫu. Thiết kế đó
 * đúng cho người dùng và tệ cho người cấu hình: điền sai một ký tự trong
 * `.env` thì màn hình trông y hệt lúc điền đúng.
 *
 * Lệnh này là chỗ duy nhất nói thẳng ra. Nó đi đúng con đường mà
 * `services/chat/hieuY.ts` và `services/chat/dienDat.ts` đi — cùng `env`, cùng
 * endpoint, cùng kiểu thân request — nên "ở đây chạy được" nghĩa là khung cũng
 * chạy được, không phải một phép thử gần giống.
 *
 * ⚠️ KHÔNG in `LLM_API_KEY` ra, dù chỉ một phần. Nhật ký terminal hay được dán
 * vào issue, vào chat, vào báo cáo. Chỉ in ĐỘ DÀI để người đọc nhận ra trường
 * hợp dán hụt hay dán kèm dấu nháy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { env } from '../config/env';
import { coCauHinhLlm, diaChiGoi } from '../services/chat/dienDat';
import { hieuY } from '../services/chat/hieuY';

const TICK = '✓';
const X = '✗';

/** Tên miền thôi, không in cả đường dẫn kèm tham số. */
function mienCua(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(không phải một URL hợp lệ)';
  }
}

/**
 * Co file `.env` nao KHAC dang giu bien ma `backend/.env` thieu khong?
 */
function timNhamFile(thieu: string[]): string[] {
  const noiKhac = ['../.env', '../frontend/.env', '../infrastructure/.env'];
  const thay: string[] = [];

  for (const duong of noiKhac) {
    let noiDung: string;
    try {
      noiDung = readFileSync(resolve(process.cwd(), duong), 'utf8');
    } catch {
      continue;
    }
    const ten = new Set(
      noiDung
        .split('\n')
        .map((d) => d.trim())
        .filter((d) => !d.startsWith('#'))
        .flatMap((d) => {
          const i = d.indexOf('=');
          return i < 1 ? [] : [d.slice(0, i).trim()];
        }),
    );
    const trung = thieu.filter((b) => ten.has(b));
    if (trung.length > 0) thay.push(`${duong.replace('../', '')} ~ ${trung.join(', ')}`);
  }
  return thay;
}

function inCauHinh(): void {
  const dong: [string, string][] = [
    ['LLM_BASE_URL', env.LLM_BASE_URL ?? '(chưa điền)'],
    ['LLM_MODEL', env.LLM_MODEL ?? '(chưa điền)'],
    [
      'LLM_API_KEY',
      env.LLM_API_KEY === undefined
        ? '(chưa điền)'
        : `(đã điền, dài ${String(env.LLM_API_KEY.length)} ký tự)`,
    ],
  ];
  for (const [ten, gia] of dong) console.log(`  ${ten.padEnd(14)} ${gia}`);
}

/**
 * Gọi thẳng endpoint, in mã lỗi HTTP ra.
 *
 * `hieuY` nuốt mọi lỗi theo đúng thiết kế của nó, nên nó không nói được "sai
 * khoá" khác "sai tên mô hình" ở chỗ nào. Lần gọi thô này tồn tại chỉ để lấy
 * mã lỗi và câu giải thích của nhà cung cấp — thứ đắt giá nhất khi đang sửa
 * cấu hình.
 */
async function goiTho(): Promise<{ ma: number; than: string } | { loi: string }> {
  try {
    const res = await fetch(diaChiGoi(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(env.LLM_API_KEY)}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Trả lời đúng một chữ: OK' }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    return { ma: res.status, than: (await res.text()).slice(0, 400) };
  } catch (e) {
    return { loi: e instanceof Error ? e.message : String(e) };
  }
}

function doanNguyenNhan(ma: number): string {
  if (ma === 401 || ma === 403) return 'khoá API sai, hết hạn, hoặc không có quyền với mô hình này';
  if (ma === 404) return 'sai LLM_BASE_URL (thiếu/thừa phần /v1?) hoặc sai tên mô hình';
  if (ma === 429) return 'hết lượt gọi của bậc đang dùng — đợi rồi thử lại';
  if (ma >= 500) return 'lỗi phía nhà cung cấp, không phải cấu hình của bạn';
  if (ma === 400) return 'thân request bị từ chối — hay gặp nhất là LLM_MODEL không tồn tại';
  return 'xem phần thân trả về ở trên';
}

async function main(): Promise<void> {
  console.log('\n── Cấu hình đọc được từ backend/.env ─────────────────────────\n');
  inCauHinh();

  if (!coCauHinhLlm()) {
    const thieu = (
      [
        ['LLM_BASE_URL', env.LLM_BASE_URL],
        ['LLM_API_KEY', env.LLM_API_KEY],
        ['LLM_MODEL', env.LLM_MODEL],
      ] as const
    )
      .filter(([, gia]) => gia === undefined)
      .map(([ten]) => ten);
    const nham = timNhamFile(thieu);

    console.log(`\n${X} CHƯA NỐI. Thiếu biến ở trên, nên khung hỏi đáp chạy bằng câu mẫu.`);
    if (nham.length > 0) {
      console.log('\n   Nhung bien do CO trong mot file .env khac:\n');
      for (const d of nham) console.log(`        ${d}`);
      console.log('\n   Backend chi nap backend/.env. Chuyen may dong do sang dung file.');
    }
    console.log('   Điền đủ cả ba biến trong backend/.env rồi KHỞI ĐỘNG LẠI backend.');
    console.log('   `tsx watch` chỉ theo dõi file .ts — sửa .env xong nó KHÔNG tự nạp lại.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n── Gọi thử ${mienCua(String(env.LLM_BASE_URL))} ────────────────────────\n`);
  const batDau = Date.now();
  const tho = await goiTho();
  const giay = ((Date.now() - batDau) / 1000).toFixed(1);

  if ('loi' in tho) {
    console.log(`${X} Không gọi tới được sau ${giay}s: ${tho.loi}`);
    console.log('   Thường là sai tên miền trong LLM_BASE_URL, hoặc mạng/proxy chặn.\n');
    process.exitCode = 1;
    return;
  }

  if (tho.ma !== 200) {
    console.log(`${X} Nhà cung cấp trả về HTTP ${String(tho.ma)} sau ${giay}s.`);
    console.log(`   Nhiều khả năng: ${doanNguyenNhan(tho.ma)}.`);
    console.log(`   Thân trả về: ${tho.than}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`${TICK} Gọi được, HTTP 200 sau ${giay}s.`);

  /*
   * Rồi mới thử ĐÚNG việc khung hỏi đáp nhờ mô hình làm: chọn một nhãn.
   *
   * Gọi được không có nghĩa là dùng được. Một mô hình quá nhỏ, hoặc một mô hình
   * "reasoning" chỉ trả lời bằng cả đoạn văn, sẽ qua được bước trên rồi trượt
   * luật đọc chỉ số của `chonHopLe` — và khi đó khung im lặng rơi về câu mẫu,
   * đúng cái im lặng mà lệnh này sinh ra để phá.
   */
  /*
   * ⚠️ Ca thử phải là một phép diễn đạt lại RÕ RÀNG, không phải một ca khó.
   *
   * Bản trước hỏi "cái này nặng bao nhiêu" (→ Dung lượng). Nó là ca kinh điển
   * của lớp này, nhưng `danhGiaLlm` đo được rằng nhiều mô hình trả về 0 cho
   * đúng câu đó — chúng coi "nặng" là quá xa "dung lượng". Lấy một ca khó làm
   * phép thử sống-chết nghĩa là báo HỎNG cho một đường dây hoàn toàn tốt.
   *
   * "bản ghi" → "Số dòng" vẫn là diễn đạt lại thật (không trùng một chữ nào),
   * nhưng nó không nhập nhằng. Câu hỏi lệnh này trả lời là "ĐÃ NỐI CHƯA";
   * "CHỌN TỐT TỚI ĐÂU" là câu hỏi của `llm:danh-gia`, và nó có cả bảng điểm.
   */
  console.log('\n── Thử đúng việc khung hỏi đáp nhờ làm: chọn một trường ──────\n');
  const kq = await hieuY({
    cauHoi: 'dữ liệu này có mấy bản ghi',
    nhan: ['Số dòng của Đơn hàng Q4', 'Số cột của Đơn hàng Q4', 'Dung lượng của Đơn hàng Q4'],
  });

  if (kq.chon === 0) {
    console.log(`${TICK} Chọn đúng trường "Số dòng" cho câu hỏi "mấy bản ghi".`);
    console.log('\n✅ ĐÃ NỐI và dùng được. Khung hỏi đáp sẽ hiểu được câu hỏi hỏi khác chữ.');
    console.log('   Đo chất lượng chọn nhãn: npm --workspace backend run llm:danh-gia\n');
    return;
  }

  if (kq.chon === null) {
    /*
     * ⚠️ Hai chuyện KHÁC HẲN nhau cùng rơi vào đây, và lời nhắn phải nói cả
     * hai: `hieuY` trả `null` cho cả "mô hình viết linh tinh, không đọc được
     * chỉ số" lẫn "mô hình đọc hiểu đàng hoàng rồi trả về 0 = không nhãn nào
     * hợp". Bản trước chỉ nói vế đầu, nên một mô hình cẩn thận bị báo là hỏng.
     *
     * Và nó từng khuyên đích danh một tên mô hình — tên đó về sau bị nhà cung
     * cấp khai tử, nên lời khuyên hoá ra dẫn thẳng vào lỗi 404. Giờ chỉ đường
     * tới danh sách còn sống thay vì chép cứng một cái tên.
     */
    console.log(`${X} Gọi được, nhưng mô hình không chọn trường nào.`);
    console.log('   Hoặc nó trả lời bằng câu chữ thay vì một con số, hoặc nó trả về 0');
    console.log('   (= "không trường nào hợp") cho một câu đáng lẽ chọn được.');
    console.log('   Khung vẫn chạy, nhưng chỉ bằng phép so từ khoá.');
    console.log('   Xem mô hình nào còn sống : npm --workspace backend run llm:mo-hinh');
    console.log('   Đo chất lượng chọn nhãn  : npm --workspace backend run llm:danh-gia');
    process.exitCode = 1;
    return;
  }

  console.log(`${X} Mô hình chọn trường số ${String(kq.chon + 1)}, đáng lẽ là 3.`);
  console.log('   Nó đọc được chỉ dẫn nhưng chọn kém — câu trả lời sẽ hay trỏ nhầm trường.');
  console.log('   Cân nhắc đổi sang mô hình lớn hơn.\n');
  process.exitCode = 1;
}

void main();
