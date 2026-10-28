import { appendFileSync } from 'node:fs';

import { isTest } from '../../config/env';

import { coCauHinhLlm, goiMoHinh } from './dienDat';

export interface HieuYInput {
  cauHoi: string;
  nhan: string[];
}

export type TrangThaiHoi = 'chua-cau-hinh' | 'da-doc' | 'goi-hong';

export interface HieuYKetQua {
  chon: number | null;
  trangThai: TrangThaiHoi;
}

export const TRAN_NHAN = 60;

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

const SO_TRUOT = 'chua-hieu.tsv';

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

  return {
    chon: noiDung === null ? null : chonHopLe(noiDung, nhan.length),
    trangThai: daGoi ? 'da-doc' : 'goi-hong',
  };
}
