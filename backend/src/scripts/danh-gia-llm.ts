import { writeFileSync } from 'node:fs';

import { coCauHinhLlm } from '../services/chat/dienDat.js';
import { hieuY } from '../services/chat/hieuY.js';

/**
 * BẢNG ĐIỂM cho lớp mô hình — việc duy nhất nó làm: CHỌN một nhãn.
 *
 * ═══ Vì sao lớp này cần một con số riêng ═══════════════════════════════════
 *
 * `danhGia.test.ts` và `danhGiaVe.test.ts` đo lớp NGOẠI TUYẾN, và chúng cố ý
 * chạy không mạng. Nên mọi câu mà phép so từ khoá bó tay — "vùng nào bán chạy",
 * "revenue theo region", "cái này nặng bao nhiêu" — đều nằm NGOÀI hai bảng
 * điểm đó. Tức là lớp lo đúng mấy câu khó nhất là lớp chưa có điểm nào, và câu
 * "lớp mô hình xử lý được" tới giờ vẫn là một lời khẳng định chưa đo.
 *
 * ═══ Cách đo: ghi một lần, phát lại mãi ════════════════════════════════════
 *
 * Lệnh này gọi mô hình THẬT rồi ghi kết quả ra `backend/tests/llmDaGhi.json`.
 * `danhGiaLlm.test.ts` đọc tệp đó và in bảng điểm — không gọi mạng, không tốn
 * tiền, chạy được trong CI và trên máy không có khoá.
 *
 *     npm --workspace backend run llm:danh-gia     # ghi lại (cần khoá)
 *     npm --workspace backend test danhGiaLlm      # xem điểm (không cần gì)
 *
 * ⚠️ Con số đó nói "mô hình ĐÃ cấu hình, ở ngày ghi, chọn đúng bao nhiêu câu".
 * Nó KHÔNG nói hôm nay mô hình còn chọn đúng từng ấy. Đổi `LLM_MODEL` hay nhà
 * cung cấp thì phải ghi lại — và rãnh răng trong bài kiểm sẽ đỏ nếu bản ghi
 * mới kém hơn bản cũ, đúng lúc cần biết.
 *
 * ⚠️ Mọi nhãn dưới đây là nhãn DỰNG TAY. Không một chữ nào của khách rời khỏi
 * máy khi chạy lệnh này.
 */

interface Ca {
  cauHoi: string;
  nhan: string[];
  /** Chỉ số 0-based đáng ra phải chọn, hoặc `null` = không nhãn nào hợp. */
  dung: number | null;
  vi?: string;
}

/** Nhãn của một trang báo cáo thật: mấy phép tính trên biểu đồ + dữ kiện trang. */
const TRANG_BAO_CAO = [
  'Khu vực nào có Doanh thu cao nhất',
  'Khu vực nào có Doanh thu thấp nhất',
  'Xếp hạng Khu vực theo Doanh thu',
  'Có bao nhiêu Khu vực',
  'Tổng Doanh thu',
  'Doanh thu trung bình',
  'Doanh thu đang tăng hay giảm',
  'Nguồn số liệu của báo cáo Doanh thu 2026',
];

/** Nhãn của trang Kho dữ liệu. */
const TRANG_KHO = [
  'Số dòng của Đơn hàng Q4',
  'Số cột của Đơn hàng Q4',
  'Dung lượng của Đơn hàng Q4',
  'Tệp gốc của Đơn hàng Q4',
  'Trạng thái của Đơn hàng Q4',
  'Số bộ dữ liệu trong toàn bộ tổ chức',
];

/** Nhãn ở trình dựng: mấy cặp vẽ sẵn đứng trước, theo đúng thứ tự thật. */
const TRINH_DUNG = [
  'Vẽ biểu đồ: Doanh thu theo Khu vực',
  'Vẽ biểu đồ: Doanh thu theo Nhóm hàng',
  'Vẽ biểu đồ: Doanh thu theo Ngày đặt',
  'Vẽ biểu đồ: Số đơn theo Khu vực',
  'Số bảng trong mô hình Bán hàng',
];

const CA: Ca[] = [
  // ─── Cùng ý, khác chữ: đúng việc lớp này sinh ra để làm ───────────────────
  { cauHoi: 'cái này nặng bao nhiêu', nhan: TRANG_KHO, dung: 2, vi: 'nặng → Dung lượng' },
  { cauHoi: 'file này to không', nhan: TRANG_KHO, dung: 2 },
  { cauHoi: 'dữ liệu này có mấy bản ghi', nhan: TRANG_KHO, dung: 0, vi: 'bản ghi → Số dòng' },
  { cauHoi: 'bao nhiêu trường', nhan: TRANG_KHO, dung: 1, vi: 'trường → Số cột' },
  { cauHoi: 'lấy từ đâu ra đó', nhan: TRANG_KHO, dung: 3 },
  { cauHoi: 'nhập từ excel nào vậy', nhan: TRANG_KHO, dung: 3 },
  { cauHoi: 'nạp xong chưa', nhan: TRANG_KHO, dung: 4, vi: 'nạp xong → Trạng thái' },

  // ─── Từ vựng của KHÁCH mà ta cố ý không đoán hộ ───────────────────────────
  { cauHoi: 'vùng nào bán chạy nhất', nhan: TRANG_BAO_CAO, dung: 0, vi: 'vùng → Khu vực' },
  { cauHoi: 'miền nào doanh thu kém nhất', nhan: TRANG_BAO_CAO, dung: 1 },
  { cauHoi: 'revenue theo region', nhan: TRANG_BAO_CAO, dung: 2, vi: 'tiếng Anh lẫn vào' },
  { cauHoi: 'tỉnh nào đứng đầu', nhan: TRANG_BAO_CAO, dung: 0 },
  { cauHoi: 'doanh số dạo này lên hay xuống', nhan: TRANG_BAO_CAO, dung: 6 },
  { cauHoi: 'cộng hết lại là bao nhiêu', nhan: TRANG_BAO_CAO, dung: 4 },
  { cauHoi: 'mỗi vùng trung bình được mấy', nhan: TRANG_BAO_CAO, dung: 5 },
  { cauHoi: 'có mấy vùng tất cả', nhan: TRANG_BAO_CAO, dung: 3 },
  { cauHoi: 'báo cáo này lấy số ở đâu', nhan: TRANG_BAO_CAO, dung: 7 },

  // ─── Trình dựng: chọn đúng CẶP để vẽ ──────────────────────────────────────
  { cauHoi: 'tui muốn xem doanh thu theo vùng', nhan: TRINH_DUNG, dung: 0 },
  { cauHoi: 'vẽ doanh thu theo thời gian', nhan: TRINH_DUNG, dung: 2, vi: 'thời gian → Ngày đặt' },
  { cauHoi: 'biểu đồ số lượng đơn từng miền', nhan: TRINH_DUNG, dung: 3 },
  { cauHoi: 'xem tiền theo loại hàng', nhan: TRINH_DUNG, dung: 1 },

  /*
   * ─── Ca ÂM: không nhãn nào hợp ────────────────────────────────────────────
   *
   * Nhóm nguy hiểm nhất, và là nhóm mà mô hình nào cũng dễ trượt. Chọn đại một
   * nhãn "hơi liên quan" cho ra một con số CÓ THẬT trả lời một câu hỏi khác —
   * đúng kết cục SAI mà cả khung dựng lên để chặn. Lời nhắc đã dặn thẳng "thà
   * trả về 0", và đây là chỗ đo xem nó có nghe không.
   */
  { cauHoi: 'hôm nay trời thế nào', nhan: TRANG_BAO_CAO, dung: null },
  { cauHoi: 'ai tạo cái báo cáo này', nhan: TRANG_BAO_CAO, dung: null },
  {
    cauHoi: 'lợi nhuận ròng bao nhiêu',
    nhan: TRANG_BAO_CAO,
    dung: null,
    vi: 'không có thước đo đó',
  },
  { cauHoi: 'xoá bộ dữ liệu này đi', nhan: TRANG_KHO, dung: null },
  { cauHoi: 'mật khẩu của tôi là gì', nhan: TRANG_KHO, dung: null },
];

/**
 * So LUOT chay moi cau.
 *
 * Mot luot do duoc "mo hinh chon dung khong". Nhieu luot do them mot thu khac
 * han va quan trong hon cho nguoi dung: no co chon GIONG NHAU khong.
 *
 * `temperature: 0` khong du de lap lai duoc — do that, hai lan chay cung bo 25
 * cau lech nhau mot cau. Chot ranh rang tren mot luot duy nhat nghia la chot
 * tren nhieu: mot ngay nao do bai kiem do vi hang xao lo, khong vi ai lam hong
 * gi — va mot bai kiem do oan la bai kiem nguoi ta bat dau bo qua.
 */
const SO_LUOT = Number(process.argv[2] ?? '3');

/**
 * Nghỉ giữa hai lượt gọi, tính bằng mili-giây.
 *
 * Nhà cung cấp miễn phí nào cũng chặn theo PHÚT, và bộ này bắn 25×N lượt liền
 * nhau. Bắn hết tốc lực thì nửa sau ăn 429, và khi đó bản ghi đo tốc độ chặn
 * chứ không đo chất lượng chọn nhãn — đã xảy ra thật ở lần chạy ba lượt đầu.
 */
const NGHI_MS = Number(process.argv[3] ?? '1500');

async function main(): Promise<void> {
  if (!coCauHinhLlm()) {
    console.log('\n❌ Chưa cấu hình mô hình. Điền LLM_BASE_URL/LLM_API_KEY/LLM_MODEL vào');
    console.log('   backend/.env rồi chạy lại. Xem `npm --workspace backend run llm:kiem`.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n── Hỏi mô hình ${String(CA.length)} câu × ${String(SO_LUOT)} lượt ──────────\n`);
  const ghi: {
    cauHoi: string;
    soNhan: number;
    dung: number | null;
    chon: (number | null)[];
    /** Lượt nào GỌI HỎNG — không phải mô hình chọn sai, mà là chưa đo được. */
    hong: number;
  }[] = [];

  for (const [i, ca] of CA.entries()) {
    const chon: (number | null)[] = [];
    let hong = 0;
    for (let lan = 0; lan < SO_LUOT; lan += 1) {
      // Tuần tự chứ không song song: nhà cung cấp miễn phí nào cũng có trần
      // theo phút, và một loạt câu bắn cùng lúc sẽ ăn 429 giữa chừng — bản ghi
      // khi đó đo tốc độ chặn chứ không đo chất lượng chọn nhãn.
      const kq = await hieuY({ cauHoi: ca.cauHoi, nhan: ca.nhan });
      /*
       * ⚠️ Gọi hỏng KHÔNG được chấm là "mô hình không chọn".
       *
       * Lần chạy ba lượt đầu tiên rơi đúng vào bẫy này: hạn mức theo phút của
       * nhà cung cấp chặn gần nửa số lượt, và bảng điểm đọc chúng thành mô
       * hình bó tay — 23/25 tụt xuống 13/25 trong khi mô hình không đổi một
       * chữ. Một bộ đánh giá đo nhầm thứ nó đang đo thì tệ hơn là không có.
       */
      if (kq.trangThai === 'goi-hong') hong += 1;
      else chon.push(kq.chon);

      // Nhường hạn mức theo phút. Bộ này chạy tay, vài chục giây không ai mất.
      await new Promise((r) => setTimeout(r, NGHI_MS));
    }
    ghi.push({ cauHoi: ca.cauHoi, soNhan: ca.nhan.length, dung: ca.dung, chon, hong });

    const deu = chon.every((c) => c === chon[0]);
    const dung = chon.length > 0 && chon.every((c) => c === ca.dung);
    const dau = chon.length === 0 ? '?' : dung ? '✓' : deu ? '✗' : '~';
    const ghiChu = chon.length === 0 ? '   ← KHÔNG ĐO ĐƯỢC' : deu ? '' : '   ← TRÔI';
    console.log(`  ${dau} ${String(i + 1).padStart(2)}. ${ca.cauHoi}${ghiChu}`);
  }

  const duong = 'backend/tests/llmDaGhi.json';
  writeFileSync(
    'tests/llmDaGhi.json',
    `${JSON.stringify({ ghiLuc: new Date().toISOString(), moHinh: process.env['LLM_MODEL'] ?? '?', soLuot: SO_LUOT, ca: ghi }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n✅ Đã ghi ${String(ghi.length)} ca × ${String(SO_LUOT)} lượt ra ${duong}.`);
  console.log('   Xem bảng điểm: npm --workspace backend test danhGiaLlm\n');
}

void main();
