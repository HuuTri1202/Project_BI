import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * BẢNG ĐIỂM của lớp mô hình — phát lại một bản ghi, không gọi mạng.
 *
 * ═══ Vì sao bộ này tồn tại ═════════════════════════════════════════════════
 *
 * Hai bảng điểm bên frontend (`danhGia`, `danhGiaVe`) cố ý chạy NGOẠI TUYẾN.
 * Nên mọi câu mà phép so từ khoá bó tay — "vùng nào bán chạy", "revenue theo
 * region", "cái này nặng bao nhiêu" — đều nằm ngoài chúng. Lớp lo đúng mấy câu
 * khó nhất là lớp chưa từng có điểm, và "lớp mô hình xử lý được" tới giờ vẫn
 * là một lời khẳng định chưa đo.
 *
 * ═══ Con số này nói gì, và KHÔNG nói gì ════════════════════════════════════
 *
 * NÓI: mô hình đã cấu hình, vào ngày ghi, chọn đúng bao nhiêu trên 25 câu.
 * KHÔNG NÓI: hôm nay nó còn chọn đúng từng ấy. Một bản ghi là một bức ảnh, và
 * mọi bức ảnh đều cũ dần. Đổi `LLM_MODEL` hay đổi nhà cung cấp thì phải ghi
 * lại — và rãnh răng dưới cùng sẽ đỏ nếu bản ghi mới kém hơn bản cũ.
 *
 * Nói thẳng ra vì một con số không ghi rõ phạm vi là một con số dùng sai được.
 *
 * ═══ Ba kết cục, như mọi bảng điểm khác của dự án ══════════════════════════
 *
 *   ĐÚNG      chọn đúng nhãn, hoặc đúng là KHÔNG chọn gì khi không nhãn nào hợp.
 *   CHƯA HIỂU trả `null` trong khi có một nhãn hợp. Trượt, nhưng trung thực —
 *             khung nói "chưa hiểu" và người dùng hỏi lại cách khác.
 *   SAI       chọn một nhãn KHÁC. Kết cục nguy hiểm duy nhất: câu trả lời là
 *             một con số có thật của một câu hỏi khác.
 *
 * Nhóm ca ÂM (`dung: null`) là nhóm đo đúng chỗ này. Lời nhắc đã dặn "thà trả
 * về 0 còn hơn chọn một trường chỉ hơi liên quan"; đây là chỗ xem nó có nghe.
 *
 * ═══ Ghi lại ═══════════════════════════════════════════════════════════════
 *
 *     npm --workspace backend run llm:danh-gia
 */

interface BanGhi {
  ghiLuc: string;
  moHinh: string;
  /** Số lượt chạy mỗi câu. */
  soLuot: number;
  /** `chon` có MỘT phần tử cho mỗi lượt — xem `SO_LUOT` bên script ghi. */
  ca: {
    cauHoi: string;
    soNhan: number;
    dung: number | null;
    chon: (number | null)[];
    /** Số lượt GỌI HỎNG — chưa đo được, không phải mô hình bó tay. */
    hong: number;
  }[];
}

// `__dirname` chứ không phải `import.meta`: bộ test biên dịch ra CommonJS.
const DUONG = join(__dirname, 'llmDaGhi.json');

/*
 * Chưa ghi lần nào thì bộ này BỎ QUA, không đỏ.
 *
 * Máy chưa cắm khoá vẫn phải chạy được cả bộ test — cùng một luật đã áp cho
 * chính lớp mô hình: thiếu cấu hình là một trạng thái bình thường, không phải
 * một lỗi. Nhưng nó phải nói ra là đang bỏ qua, chứ không im lặng xanh.
 */
const coBanGhi = existsSync(DUONG);
const ban: BanGhi | null = coBanGhi ? (JSON.parse(readFileSync(DUONG, 'utf8')) as BanGhi) : null;

/**
 * Bốn kết cục, và thứ tự xét là một quyết định chứ không phải thẩm mỹ.
 *
 *   SAI       chọn một nhãn KHÁC ở BẤT KỲ lượt nào. Xét trước hết: một lượt
 *             sai trong ba là vẫn sai — người dùng chỉ hỏi một lần, và lần đó
 *             có thể rơi đúng vào lượt hỏng. "Đa số thắng" ở đây là tự giấu đi
 *             đúng kết cục nguy hiểm nhất.
 *   ĐÚNG      chọn đúng ở MỌI lượt. Chỉ cái này được tính vào rãnh răng.
 *   TRÔI      không sai, nhưng các lượt không giống nhau — lúc trả lời được,
 *             lúc chịu. Đây là con số mà cả việc chạy nhiều lượt sinh ra để
 *             nhìn thấy, và nó đo đúng thứ người dùng cảm nhận là "lúc được
 *             lúc không".
 *   CHƯA HIỂU không chọn gì ở mọi lượt, trong khi có một nhãn hợp.
 */
function ketCuc(c: BanGhi['ca'][number]): 'dung' | 'troi' | 'chuaHieu' | 'sai' | 'chuaDo' {
  // Không còn lượt nào gọi được thì câu này CHƯA ĐO ĐƯỢC. Chấm nó là "mô hình
  // bó tay" là đọc hạn mức của nhà cung cấp thành chất lượng của mô hình.
  if (c.chon.length === 0) return 'chuaDo';
  if (c.chon.some((x) => x !== null && x !== c.dung)) return 'sai';
  if (c.chon.every((x) => x === c.dung)) return 'dung';
  return c.chon.every((x) => x === null) ? 'chuaHieu' : 'troi';
}

/*
 * ⚠️ RÃNH RĂNG đặt ở ĐÚNG số câu ổn định của bản ghi hiện tại, không phải số
 * cao nhất từng thấy. Lớp này trôi — chốt theo đỉnh là hẹn ngày bài kiểm đỏ vì
 * nhiễu chứ không vì ai làm hỏng gì, và một bài kiểm đỏ oan là bài kiểm người
 * ta bắt đầu bỏ qua.
 */
const NGUONG_DUNG = 23;

describe.skipIf(ban === null)('Bảng điểm lớp mô hình (phát lại bản ghi)', () => {
  const ca = ban?.ca ?? [];
  const dem = (k: 'dung' | 'troi' | 'chuaHieu' | 'sai' | 'chuaDo'): number =>
    ca.filter((c) => ketCuc(c) === k).length;

  it('in ra bảng điểm', () => {
    const pt = (n: number): string => `${((n / ca.length) * 100).toFixed(1)}%`;
    const ten = { sai: 'SAI ', troi: 'TRÔI', chuaHieu: 'CHƯA', chuaDo: '  ? ', dung: '    ' };
    const doc = (v: number | null): string => (v === null ? 'không chọn' : `nhãn ${String(v + 1)}`);
    const truot = ca
      .filter((c) => ketCuc(c) !== 'dung')
      .map(
        (c) =>
          `  [${ten[ketCuc(c)]}] "${c.cauHoi}"\n` +
          `         đáng lẽ: ${c.dung === null ? 'KHÔNG chọn gì' : `nhãn ${String(c.dung + 1)}`}` +
          ` · ${String(ban?.soLuot ?? 1)} lượt: ${c.chon.map(doc).join(', ')}`,
      );

    console.log(
      [
        '',
        `── Lớp mô hình trên ${String(ca.length)} câu ─────────────────────────`,
        `   mô hình: ${ban?.moHinh ?? '?'} · ${String(ban?.soLuot ?? 1)} lượt/câu · ghi lúc ${ban?.ghiLuc ?? '?'}`,
        '',
        `  ĐÚNG       ${String(dem('dung'))}/${String(ca.length)}  ${pt(dem('dung'))}   (đúng ở MỌI lượt)`,
        `  TRÔI       ${String(dem('troi'))}/${String(ca.length)}  ${pt(dem('troi'))}   (lúc được lúc không)`,
        `  CHƯA HIỂU  ${String(dem('chuaHieu'))}/${String(ca.length)}  ${pt(dem('chuaHieu'))}`,
        `  SAI        ${String(dem('sai'))}/${String(ca.length)}  ${pt(dem('sai'))}`,
        `  chưa đo     ${String(dem('chuaDo'))}/${String(ca.length)}          (mọi lượt đều gọi hỏng)`,
        '',
        ...(truot.length === 0 ? ['  (không có ca nào trượt)'] : ['── Ca trượt ──', '', ...truot]),
        '',
      ].join('\n'),
    );

    expect(ca.length).toBeGreaterThan(20);
  });

  /*
   * ⚠️ RÃNH RĂNG — chỉ được sửa LÊN, như hai bảng điểm bên frontend.
   *
   * Ngưỡng đặt ĐÚNG BẰNG điểm của bản ghi hiện tại. Nới ra cho "thoáng" là tự
   * bịt mắt mình trước đúng thứ bộ này sinh ra để thấy: đổi mô hình sang một
   * con rẻ hơn mà chọn kém hơn.
   */
  it('số câu ĐÚNG không được tụt', () => {
    expect(dem('dung')).toBeGreaterThanOrEqual(NGUONG_DUNG);
  });

  /*
   * Một bản ghi mà quá nửa số câu không gọi được thì nó không đo gì cả — và
   * một con số không đo gì mà vẫn in ra bảng điểm là con số nguy hiểm nhất ở
   * đây. Thà đỏ và bắt ghi lại.
   */
  it('bản ghi phải đo được phần lớn số câu', () => {
    expect(dem('chuaDo')).toBeLessThan(ca.length / 2);
  });

  /*
   * SAI là kết cục nguy hiểm duy nhất ở đây: mô hình chọn một nhãn CÓ THẬT mà
   * sai, nên khung trả về một con số có thật cho một câu hỏi khác. Người đọc
   * không có dấu hiệu nào để nhận ra.
   */
  it('số câu SAI không được tăng', () => {
    expect(dem('sai')).toBeLessThanOrEqual(0);
  });
});

it.skipIf(coBanGhi)('chưa có bản ghi nào — chạy `npm --workspace backend run llm:danh-gia`', () => {
  expect(coBanGhi).toBe(false);
});
