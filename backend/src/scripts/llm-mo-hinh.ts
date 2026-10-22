import { env } from '../config/env.js';

/**
 * Liệt kê mô hình mà nhà cung cấp ĐANG phục vụ.
 *
 * ═══ Vì sao đáng một lệnh riêng ════════════════════════════════════════════
 *
 * Nhà cung cấp KHAI TỬ tên mô hình, và họ làm việc đó mà không báo ai. Khi
 * chuyện đó xảy ra, mọi lượt gọi trả 404 — và `hieuY` nuốt mọi lỗi theo đúng
 * thiết kế, nên khung lặng lẽ rơi về phép so từ khoá. Badge "có mô hình" vẫn
 * sáng, vì nó chỉ kiểm ba biến môi trường CÓ MẶT, không kiểm gọi được.
 *
 * Nó đã xảy ra thật với `llama-3.3-70b-versatile`, và dấu hiệu duy nhất là
 * khung bỗng trả lời kém đi — không một dòng lỗi nào trước mắt người dùng.
 * Lệnh này biến mười phút mò mẫm thành một dòng lệnh.
 *
 * ⚠️ In ra TÊN mô hình, và tuyệt đối không một phần nào của khoá — cùng luật
 * đã ghi ở `kiem-llm.ts` và ở endpoint `/chat/co-mo-hinh`.
 */
async function main(): Promise<void> {
  if (env.LLM_BASE_URL === undefined || env.LLM_API_KEY === undefined) {
    console.log('\n❌ Chưa có LLM_BASE_URL / LLM_API_KEY trong backend/.env.\n');
    process.exitCode = 1;
    return;
  }

  const res = await fetch(`${env.LLM_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${env.LLM_API_KEY}` },
  });

  if (!res.ok) {
    console.log(`\n❌ Nhà cung cấp trả về HTTP ${String(res.status)} khi hỏi danh sách mô hình.`);
    console.log('   Sai khoá, hoặc nhà cung cấp này không có điểm cuối /models.\n');
    process.exitCode = 1;
    return;
  }

  const than = (await res.json()) as { data?: { id?: unknown }[] };
  const ten = (than.data ?? [])
    .map((m) => (typeof m.id === 'string' ? m.id : null))
    .filter((x): x is string => x !== null)
    .sort();

  console.log(`\n── ${String(ten.length)} mô hình đang phục vụ ─────────────────────────\n`);
  for (const t of ten) {
    console.log(`  ${t}${t === env.LLM_MODEL ? '   ← LLM_MODEL đang dùng' : ''}`);
  }

  if (env.LLM_MODEL !== undefined && !ten.includes(env.LLM_MODEL)) {
    console.log(`\n⚠️  "${env.LLM_MODEL}" KHÔNG có trong danh sách — mọi lượt gọi sẽ 404,`);
    console.log('   và khung sẽ lặng lẽ chạy bằng phép so từ khoá. Đổi LLM_MODEL đi.');
  }
  console.log('');
}

void main();
