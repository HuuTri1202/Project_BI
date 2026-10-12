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
import { env } from '../config/env';
import { coCauHinhLlm } from '../services/chat/dienDat';
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
    const res = await fetch(`${String(env.LLM_BASE_URL)}/chat/completions`, {
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
      signal: AbortSignal.timeout(15_000),
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
    console.log(`\n${X} CHƯA NỐI. Thiếu biến ở trên, nên khung hỏi đáp chạy bằng câu mẫu.`);
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
  console.log('\n── Thử đúng việc khung hỏi đáp nhờ làm: chọn một trường ──────\n');
  const kq = await hieuY({
    cauHoi: 'cái này nặng bao nhiêu',
    nhan: ['Số dòng của Đơn hàng Q4', 'Số cột của Đơn hàng Q4', 'Dung lượng của Đơn hàng Q4'],
  });

  if (kq.chon === 2) {
    console.log(`${TICK} Chọn đúng trường "Dung lượng" cho câu hỏi "nặng bao nhiêu".`);
    console.log('\n✅ ĐÃ NỐI và dùng được. Khung hỏi đáp sẽ hiểu được câu hỏi hỏi khác chữ.\n');
    return;
  }

  if (kq.chon === null) {
    console.log(`${X} Gọi được nhưng mô hình KHÔNG trả về một chỉ số đọc được.`);
    console.log('   Khung sẽ vẫn chạy, nhưng chỉ bằng phép so từ khoá.');
    console.log('   Thử một mô hình bám chỉ dẫn tốt hơn (ví dụ llama-3.3-70b-versatile),');
    console.log('   hoặc một mô hình không phải loại "suy luận dài trước khi trả lời".\n');
    process.exitCode = 1;
    return;
  }

  console.log(`${X} Mô hình chọn trường số ${String(kq.chon + 1)}, đáng lẽ là 3.`);
  console.log('   Nó đọc được chỉ dẫn nhưng chọn kém — câu trả lời sẽ hay trỏ nhầm trường.');
  console.log('   Cân nhắc đổi sang mô hình lớn hơn.\n');
  process.exitCode = 1;
}

void main();
