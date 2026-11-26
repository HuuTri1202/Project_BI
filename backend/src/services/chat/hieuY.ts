import { TRAN_NHAN } from '@bi/shared';
import { appendFileSync, mkdirSync } from 'node:fs';

import { isTest } from '../../config/env';

import { docDem, ghiDem, khoaDem } from './dem';
import { coCauHinhLlm, goiMoHinh } from './dienDat';

export interface HieuYInput {
  cauHoi: string;
  nhan: string[];
  /**
   * Phạm vi đệm — `"<tenantId>"`. Vắng mặt thì KHÔNG đệm.
   *
   * Danh sách nhãn nằm trong phần biến thiên của khoá, nên một chỉ số đọc ra từ
   * đệm luôn trỏ vào đúng danh sách đã sinh ra nó — kể cả khi người dùng đã
   * chuyển sang trang khác.
   */
  pham?: string | undefined;
}

export type TrangThaiHoi = 'chua-cau-hinh' | 'da-doc' | 'goi-hong';

export interface HieuYKetQua {
  chon: number | null;
  trangThai: TrangThaiHoi;
}

export function chonHopLe(raw: string, soNhan: number): number | null {
  const m = /^\s*(\d{1,3})\s*[.)]?\s*$/.exec(raw);
  if (m === null) return null;
  const n = Number(m[1]);
  // 0 là "không nhãn nào khớp" — chính mô hình được dặn trả về nó.
  if (n < 1 || n > soNhan) return null;
  return n - 1;
}

const NHAC = [
  'Bạn là bộ chọn trường dữ liệu. Người dùng hỏi một câu tiếng Việt về màn hình họ đang xem.',
  'Bạn nhận một danh sách đánh số các trường dữ liệu mà màn hình đó đang có.',
  'Nhiệm vụ: chọn ĐÚNG MỘT trường trả lời được câu hỏi, và chỉ trả về số thứ tự của trường đó.',
  'Nếu không trường nào trả lời được, trả về 0.',
  'Chỉ trả về một con số, không viết thêm chữ nào, không giải thích.',
  'Không đoán bừa: thà trả về 0 còn hơn chọn một trường chỉ hơi liên quan.',
].join(' ');

/**
 * Sổ câu trượt nằm trong MỘT THƯ MỤC, không đứng trần ở `cwd`.
 *
 * Thư mục đó được gắn ra ngoài máy chủ (xem `docker-compose.prod.yml`), nên sổ
 * sống qua mọi lần `up -d`. Trước đó nó nằm trong container và chết theo
 * container — một cái sổ mất sạch mỗi lần triển khai thì không dùng được để
 * làm việc mà nó sinh ra: nuôi thêm ca cho bộ đánh giá.
 *
 * Đường dẫn TƯƠNG ĐỐI, cố ý: máy lập trình ghi vào `backend/so-chat/` (đã nằm
 * trong `.gitignore`), container ghi vào chỗ được gắn. Một hằng số, không
 * thêm biến môi trường nào để lệch.
 */
const SO_THU_MUC = 'so-chat';
const SO_TRUOT = `${SO_THU_MUC}/chua-hieu.tsv`;

export function ghiTruot(cauHoi: string, nhanChon: string | null): void {
  // Gộp mọi khoảng trắng: câu dán từ chỗ khác có thể xuống dòng, mà một dòng
  // trong sổ phải là một câu hỏi — nếu không thì `grep` và `wc -l` đều nói sai.
  const dong = [
    new Date().toISOString(),
    nhanChon ?? 'CHƯA HIỂU',
    cauHoi.replace(/\s+/g, ' ').trim(),
  ].join('\t');

  console.info('[chat] trượt lớp ngoại tuyến:', dong);

  // Test ghi ra tệp là để lại rác trong repo sau mỗi lần chạy. Dòng `console`
  // ở trên vẫn còn, nên nhánh kiểm chứng vẫn soi được đúng thứ cần soi.
  //
  // ⚠️ Dòng này CỐ Ý không có test canh — khác mọi chốt khác trong tệp. Canh
  // nó thì phải kiểm "tệp không được sinh ra", mà tệp đó có thể đã nằm sẵn từ
  // một lần chạy thật trước đó, nên bài kiểm sẽ đỏ vì lý do chẳng liên quan.
  // Giá của việc nó hỏng cũng chỉ là một tệp đã nằm trong `.gitignore`.
  if (isTest) return;

  try {
    // `recursive` nên không tốn gì khi thư mục đã có; nằm trong `try` sẵn
    // có nên lỗi quyền ghi vẫn không làm hỏng câu trả lời.
    mkdirSync(SO_THU_MUC, { recursive: true });
    appendFileSync(SO_TRUOT, `${dong}\n`, 'utf8');
  } catch {
    // Sổ hỏng (chỉ đọc, hết đĩa) KHÔNG được làm hỏng câu trả lời. Cả lớp này
    // sinh ra với lời hứa "mọi trục trặc đều vô hại"; một cái log mà phá được
    // lời hứa đó thì tệ hơn hẳn việc mất vài dòng sổ.
  }
}

export async function hieuY(input: HieuYInput): Promise<HieuYKetQua> {
  const nhan = input.nhan.slice(0, TRAN_NHAN);
  if (!coCauHinhLlm() || nhan.length === 0) return { chon: null, trangThai: 'chua-cau-hinh' };

  /*
   * Đọc đệm TRƯỚC khi gọi mô hình — xem `dem.ts` cho luật chung.
   *
   * `trangThai: 'da-doc'` là đúng: mô hình ĐÃ đọc câu này thật, chỉ là nó đọc ở
   * một lượt trước. Giao diện dùng cờ đó để phân biệt "đã đọc hết mà không
   * thấy" với "chưa gọi được mô hình".
   *
   * Giữ nguyên văn chuỗi mô hình trả về rồi đọc lại bằng `chonHopLe` ở mỗi lượt
   * đọc đệm, không đệm chỉ số đã đọc: cùng lập luận với `datCauHoi`, luật đọc
   * phải chạy lại chứ không được bỏ qua vì "đã từng hợp lệ".
   */
  const khoa =
    input.pham === undefined ? null : khoaDem('hieu-y', input.pham, [input.cauHoi, nhan]);
  if (khoa !== null) {
    const daCo = await docDem(khoa);
    if (daCo !== null) return { chon: chonHopLe(daCo, nhan.length), trangThai: 'da-doc' };
  }

  const danhSach = nhan.map((n, i) => `${String(i + 1)}. ${n}`).join('\n');

  const { noiDung, daGoi } = await goiMoHinh(
    [
      { role: 'system', content: NHAC },
      { role: 'user', content: `Câu hỏi: ${input.cauHoi}\n\nCác trường:\n${danhSach}` },
    ],
    /*
     * Câu trả lời đúng dài nhất là hai chữ số, nhưng hạn mức KHÔNG đặt sát: mô
     * hình nào vẫn suy nghĩ dù đã được bảo đừng thì nó tiêu token vào đây, và
     * hết hạn mức giữa chừng nghĩa là `content` rỗng. Luật đọc chỉ số vẫn
     * nghiêm như cũ nên nới hạn mức không nới chỗ cho một câu dài lọt qua.
     */
    400,
  );

  // CHỈ ghi khi lượt gọi thành công — đệm một lượt hỏng là khoá chặt câu hỏi
  // này ở trạng thái bế tắc suốt một tiếng.
  if (khoa !== null && daGoi && noiDung !== null) await ghiDem(khoa, noiDung.trim());

  return {
    chon: noiDung === null ? null : chonHopLe(noiDung, nhan.length),
    trangThai: daGoi ? 'da-doc' : 'goi-hong',
  };
}
