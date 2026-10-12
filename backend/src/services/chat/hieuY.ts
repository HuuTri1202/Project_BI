import { coCauHinhLlm, goiMoHinh } from './dienDat';

/**
 * Hiểu câu hỏi bằng mô hình ngôn ngữ — nhưng chỉ cho nó CHỌN, không cho nó viết.
 *
 * ═══ Vấn đề mà lớp này giải ════════════════════════════════════════════════
 *
 * `traLoi` bên frontend so câu hỏi với nhãn dữ kiện bằng cách đếm từ trùng. Nó
 * chính xác và miễn phí, nhưng nó mù trước cách nói khác: "cái này nặng bao
 * nhiêu" không trùng từ nào với "Dung lượng của Đơn hàng Q4", dù hai câu nói về
 * đúng một thứ. Người dùng gõ như họ nghĩ, không gõ theo nhãn trên màn hình.
 *
 * ═══ Vì sao mô hình KHÔNG BỊA ĐƯỢC ở đây ═══════════════════════════════════
 *
 * Nó không được trả lời câu hỏi. Nó nhận một DANH SÁCH ĐÁNH SỐ các nhãn dữ
 * kiện mà trang đang giữ, và việc duy nhất của nó là trả về MỘT con số: nhãn
 * nào khớp, hoặc 0 nếu không nhãn nào khớp.
 *
 * Từ đó mọi đường bịa đều bị bịt bằng cấu trúc, không bằng lời dặn:
 *
 *   - Nó không thấy GIÁ TRỊ nào, nên không có con số nào để sửa hay để bịa.
 *   - Chỉ số nằm ngoài 1..n bị bỏ ngay ở đây — kể cả khi nó trả về một chỉ số
 *     trông hợp lý. Xem `chonHopLe`.
 *   - Câu trả lời cuối vẫn do frontend dựng từ chính `DuKien` đó, bằng đúng
 *     hàm mà nhánh so từ khoá đang dùng. Mô hình chỉ đổi được việc CHỌN NHÃN
 *     NÀO, không đổi được một ký tự nào của câu hay của con số.
 *
 * Nói cách khác: thứ tệ nhất mô hình làm được là chọn nhầm nhãn — và khi đó
 * câu trả lời hiện ra kèm nguyên văn cái nhãn nó chọn, nên người đọc thấy ngay
 * là nó đang trả lời chuyện khác.
 *
 * ═══ Vì sao gửi NHÃN mà không gửi giá trị ══════════════════════════════════
 *
 * Cùng một luật với `dienDat`: thứ rời khỏi hệ thống phải là ít nhất có thể để
 * việc này chạy được. Nhãn là tên trường trên màn hình ("Số dòng của X"); giá
 * trị mới là số liệu của khách. Việc chọn nhãn không cần biết giá trị.
 */

export interface HieuYInput {
  cauHoi: string;
  /** Nhãn các dữ kiện trang đang giữ, đã đánh thứ tự bởi người gọi. */
  nhan: string[];
}

export interface HieuYKetQua {
  /** Chỉ số (0-based) trong `nhan`, hoặc `null` khi không nhãn nào khớp. */
  chon: number | null;
  /**
   * Mô hình có THẬT SỰ được hỏi không.
   *
   * Phân biệt "đã đọc hết số liệu của trang và không có mục nào trả lời được"
   * với "máy này chưa cấu hình mô hình nên chưa ai đọc gì cả". Hai câu đó nói
   * hai chuyện khác hẳn cho người dùng, và frontend cần biết để nói đúng câu.
   */
  daHoi: boolean;
}

/**
 * Trần số nhãn gửi lên.
 *
 * Trang chi tiết một mô hình nhiều bảng có thể sinh ra hàng trăm dữ kiện (mỗi
 * cột một dòng). Gửi hết vừa tốn tiền vừa làm mô hình chọn kém đi, và phần đuôi
 * gần như không bao giờ là thứ người dùng hỏi — người gọi đã xếp dữ kiện của
 * nguồn đang xem lên đầu.
 */
export const TRAN_NHAN = 60;

/**
 * Đọc câu mô hình trả về thành một chỉ số hợp lệ. `null` = không chọn gì.
 *
 * ⚠️ Nghiêm ngặt CÓ CHỦ Ý: chỉ nhận một chuỗi toàn chữ số (cho qua một dấu
 * chấm hoặc ngoặc đóng ở cuối, vì mô hình hay viết "3." hay "3)"). Một câu dài
 * có chữ số nằm lẫn bên trong thì bị bỏ.
 *
 * Lý do: rút "con số đầu tiên tìm thấy" sẽ biến câu "Không nhãn nào khớp, gần
 * nhất là nhãn 5" thành một lựa chọn chắc nịch. Mà bỏ sót ở đây chỉ có giá là
 * khung nói "chưa hiểu" — đúng thứ nó vẫn làm khi chưa có lớp này. Chọn nhầm
 * thì đắt hơn hẳn.
 */
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
 * Hỏi mô hình xem câu hỏi ứng với nhãn nào. Mọi trục trặc đều ra `chon: null`.
 *
 * Cùng khuôn chịu lỗi với `dienDat`: chưa cấu hình, mất mạng, hết lượt, JSON
 * rác — tất cả cho cùng một kết quả, và khung hỏi đáp quay về đúng hành vi nó
 * vẫn có khi không có mô hình nào.
 */
export async function hieuY(input: HieuYInput): Promise<HieuYKetQua> {
  const nhan = input.nhan.slice(0, TRAN_NHAN);
  if (!coCauHinhLlm() || nhan.length === 0) return { chon: null, daHoi: false };

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

  return { chon: noiDung === null ? null : chonHopLe(noiDung, nhan.length), daHoi: daGoi };
}
