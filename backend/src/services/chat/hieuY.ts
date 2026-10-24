import { appendFileSync } from 'node:fs';

import { isTest } from '../../config/env';

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

/**
 * Lượt gọi mô hình đã đi tới đâu — BA trạng thái, không phải hai.
 *
 * ═══ Vì sao một boolean là không đủ ════════════════════════════════════════
 *
 * `daHoi: boolean` gộp ba chuyện khác hẳn nhau thành hai ô, và cả hai cách gộp
 * đều sinh ra một câu nói sai trên màn hình:
 *
 *   - Máy chưa cắm khoá và mạng vừa rớt cùng ra `false` — khung nói chung
 *     chung "chưa hiểu", trong khi nguyên nhân thứ hai sẽ tự hết sau một phút.
 *   - Tệ hơn: lỗi 500/429 của nhà cung cấp từng ra `true`, nên khung khẳng
 *     định "Tôi đã đọc hết số liệu và không có mục nào trả lời được" — nói
 *     chắc nịch về một việc chưa hề xảy ra.
 *
 * Ba trạng thái thì mỗi cái một câu, và không câu nào hứa quá thứ đã làm.
 */
export type TrangThaiHoi =
  /** Máy này chưa cấu hình mô hình — chưa ai đọc gì cả. */
  | 'chua-cau-hinh'
  /** Mô hình đã đọc hết danh sách và trả lời. */
  | 'da-doc'
  /** Có gọi, nhưng hỏng: mạng, hết giờ, hoặc nhà cung cấp trả lỗi. */
  | 'goi-hong';

export interface HieuYKetQua {
  /** Chỉ số (0-based) trong `nhan`, hoặc `null` khi không nhãn nào khớp. */
  chon: number | null;
  trangThai: TrangThaiHoi;
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
 * Sổ ghi những câu LỚP NGOẠI TUYẾN KHÔNG trả lời được.
 *
 * ═══ Vì sao sổ này phải tồn tại ════════════════════════════════════════════
 *
 * Hai bộ đánh giá (`danhGia`, `danhGiaVe`) đo khung hỏi đáp trên hơn 150 câu
 * — và cả 150 câu đó đều do người viết code nghĩ ra. Người ra đề cũng là người
 * làm bài, nên điểm cao chỉ chứng minh được một chuyện: khung trả lời được
 * đúng những cách nói mà người viết nó NGHĨ RA ĐƯỢC. Điểm mù thì vẫn nguyên,
 * và theo định nghĩa thì không ai tự nhìn thấy điểm mù của mình.
 *
 * Thứ duy nhất phá được vòng đó là câu của người dùng thật. Sổ này đi thu.
 *
 * ═══ Vì sao gọi từ ROUTE, không gọi từ trong `hieuY` ═══════════════════════
 *
 * Bản đầu đặt lời gọi ngay trong `hieuY`, với lý do "đó là chỗ hẹp nhất mà mọi
 * câu trượt đều đi qua". Hẹp thì đúng, nhưng hẹp không phải thứ cần: thứ cần
 * là ranh giới "một NGƯỜI THẬT vừa gõ câu này".
 *
 * Giá của chỗ sai đó hiện ra ngay lần đầu chạy `llm:danh-gia`: 25 câu dựng tay
 * của bộ đánh giá đổ thẳng vào sổ và chôn mất hai dòng người dùng thật. Một
 * cái sổ trộn câu thật với câu máy tự sinh thì không dùng được vào việc nó
 * sinh ra để làm.
 *
 * Route `/chat/hieu-y` mới là ranh giới ấy — và nó vẫn hẹp y như cũ: frontend
 * chỉ gọi endpoint này TRONG nhánh `kq === null`, tức sau khi phép so từ khoá,
 * lớp hỏi lại nguồn, bộ nhớ một lượt và đường dựng biểu đồ đều đã trượt (xem
 * `HoiDapPanel.tsx`, chỗ gọi `nhoMoHinhChon`).
 *
 * ⚠️ Biết là CÒN SÓT một nhánh: khi trang không có lấy một nhãn nào để chọn,
 * frontend đi thẳng tới `hetDuong` và không gọi tới đây. Nhánh đó cần trang
 * rỗng dữ kiện nên gần như không xảy ra — chưa đáng một endpoint riêng.
 *
 * ═══ Thứ được ghi, và thứ KHÔNG ═══════════════════════════════════════════
 *
 * Ghi: câu người dùng gõ, và nhãn mà mô hình cứu được (hoặc `CHƯA HIỂU`). Cột
 * thứ hai đó mới là phần đáng tiền — nó nói thẳng lớp ngoại tuyến LẼ RA phải
 * khớp vào đâu, nên một dòng trong sổ dịch gần như nguyên văn thành một ca
 * trong bộ đánh giá.
 *
 * KHÔNG ghi: giá trị số liệu nào (hàm này cố ý không bao giờ nhìn thấy chúng),
 * cả danh sách 60 nhãn, và không id người dùng — cần thêm thì thêm sau, còn
 * thu sẵn thứ chưa dùng tới thì chỉ là dữ liệu cá nhân nằm chờ rò.
 *
 * ═══ Vì sao là một tệp TSV, không phải một bảng ════════════════════════════
 *
 * Việc duy nhất phải làm với sổ này là mở ra đọc rồi chép câu vào bộ đánh giá.
 * Một bảng thì tốn một migration, một repository và một endpoint để lôi ra —
 * tất cả chỉ để phục vụ đúng một thao tác mà `grep` đã làm xong. Lên bảng khi
 * nào có nhiều người dùng tới mức cần lọc theo tổ chức và theo thời gian.
 *
 * `appendFileSync` ghi đồng bộ, và đó là chủ ý: sổ này chỉ chạy trên đường đã
 * trượt — một đường vốn đang chờ một lượt gọi mạng tính bằng giây — nên vài
 * mili-giây đĩa không ai thấy, đổi lại không phải lo tranh ghi giữa hai dòng.
 */
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

/**
 * Hỏi mô hình xem câu hỏi ứng với nhãn nào. Mọi trục trặc đều ra `chon: null`.
 *
 * Cùng khuôn chịu lỗi với `dienDat`: chưa cấu hình, mất mạng, hết lượt, JSON
 * rác — tất cả cho cùng một kết quả, và khung hỏi đáp quay về đúng hành vi nó
 * vẫn có khi không có mô hình nào.
 */
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
