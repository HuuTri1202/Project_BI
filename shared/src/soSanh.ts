/**
 * Chiều của một cụm so sánh tiếng Việt — CAO NHẤT hay THẤP NHẤT.
 *
 * ═══ Vì sao luật này nằm ở `@bi/shared` ════════════════════════════════════
 *
 * Nó có HAI chỗ đọc, và hai chỗ đó phải nói cùng một câu:
 *
 *   `frontend/.../chat/traLoi.ts`            chọn ý định cho lớp ngoại tuyến
 *   `backend/.../chat/hoiTrenMoHinh.ts`      chọn hướng sắp của truy vấn mới
 *
 * Trước bản này mỗi bên giữ một bản sao của cùng một biểu thức chính quy. Hai
 * bản sao của một luật ngôn ngữ thì lệch nhau ở lần sửa đầu tiên — và khi đó
 * "khu vực nào bán kém nhất" trả về đúng ở lớp này rồi trả về NGƯỢC ở lớp kia,
 * tuỳ câu hỏi rơi vào lớp nào. Cùng lý do `LATE_PAYMENT_WINDOW_HOURS` nằm ở đây.
 *
 * ═══ ⚠️ ĐỌC TRÊN CHỮ CÒN DẤU — chốt quan trọng nhất của tệp ════════════════
 *
 * Mọi phép so chuỗi khác của khung hỏi đáp đều bỏ dấu trước, và đúng cho việc
 * của chúng: người dùng gõ thiếu dấu thì vẫn phải tìm ra "Doanh thu". Nhưng
 * phép đọc CHIỀU thì ngược lại — bỏ dấu ở đây là tự tạo ra từ giả, và mỗi từ
 * giả là một đáp án lộn ngược:
 *
 *   "ít báo CÁO nhất"    `cáo`  → `cao`   đọc thành CAO NHẤT   (ĐO ĐƯỢC, 3 ca)
 *   "thực TẾ cao nhất"   `tế`   → `te`    đọc thành THẤP NHẤT
 *   "YÊU cầu cao nhất"   `yêu`  → `yeu`   đọc thành THẤP NHẤT
 *   "cập NHẬT sớm nhất"  `nhật` → `nhat`  một cụm so sánh thứ hai từ không khí
 *
 * Giữ dấu thì cả bốn tự biến mất: `cáo ≠ cao`, `tế ≠ tệ`, `yêu ≠ yếu`,
 * `nhật ≠ nhất` — không cần một luật riêng nào cho chúng. Nên hàm này nhận câu
 * THÔ và tự chuẩn hoá nhẹ, chứ KHÔNG nhận chuỗi đã qua `chuanHoa`.
 *
 * ═══ Vì sao đọc NGƯỢC từ chữ "nhất" ra, thay vì quét cả câu ════════════════
 *
 * Bản cũ hỏi "trong câu có chữ nào chỉ chiều ngược không" — quét cả câu, với
 * một danh sách sáu chữ: `ít thấp nhỏ rẻ cũ sớm`. Nó BỎ SÓT: "miền nào bán KÉM
 * nhất" trượt sạch danh sách rồi rơi xuống nhánh `cao nhất`, trả về miền bán
 * TỐT nhất. Đo được trên fixture của bộ đánh giá — "Miền Trung 310" cho một câu
 * hỏi mà đáp án là "Miền Bắc 255", lộn ngược hoàn toàn, không một dấu hiệu nào.
 * "tệ nhất" và "yếu nhất" cùng y như vậy.
 *
 * Tiếng Việt đặt từ chỉ chiều TRƯỚC chữ "nhất", và từ GẦN "nhất" nhất là từ
 * quyết định: "ít dòng nhất" là ngược, còn "thực tế CAO nhất" là thuận. Quét cả
 * câu không phân biệt được hai thứ đó; đọc ngược từ "nhất" ra thì phân biệt
 * được, và nhờ vậy danh sách mở rộng được mà không mở thêm cửa nhận nhầm nào.
 *
 * ⚠️ Xét MỌI chữ "nhất" trong câu, từ trái sang phải, và lấy cụm ĐẦU TIÊN đọc
 * ra được chiều. Lớp bộ nhớ của khung nối "câu mới + câu cũ" rồi hỏi lại, nên
 * câu nối "thấp nhất thì sao miền nào có số lượng CAO NHẤT" có hai cụm so sánh
 * thật — và cụm của câu MỚI đứng trước, đúng luật ưu tiên đã ghi ở `traLoiKhung`.
 * Lấy cụm cuối là để lượt cũ bẻ lái lượt mới, và nó làm hai ca đang đúng thành SAI.
 */

/** Chuẩn hoá NHẸ: về chữ thường, dấu câu thành khoảng trắng — GIỮ dấu tiếng Việt. */
function tachTu(raw: string): string[] {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim()
    .split(' ');
}

/** NFC cho chính mấy chữ trong tệp này, để không phụ thuộc cách tệp được lưu. */
function bo(tu: string[]): Set<string> {
  return new Set(tu.map((t) => t.normalize('NFC')));
}

const NHAT = 'nhất'.normalize('NFC');

/** Từ chỉ chiều NGƯỢC. CÒN DẤU — xem khối chú thích đầu tệp về lý do. */
const NGUOC = bo(['ít', 'thấp', 'nhỏ', 'rẻ', 'cũ', 'sớm', 'kém', 'tệ', 'yếu', 'xấu']);

/**
 * Từ chỉ chiều THUẬN.
 *
 * Danh sách này KHÔNG dùng để nhận ra "cao nhất" — chữ "nhất" trần đã lo việc
 * đó ở nơi gọi. Nó chỉ để CHẶN: gặp một từ thuận trước khi gặp từ ngược thì cụm
 * này là cụm thuận, và mọi từ ngược nằm xa hơn không được tính nữa.
 *
 * `gần` có mặt vì một DỮ KIỆN cũng mang chiều trong tên nó: "Bộ dữ liệu cập
 * nhật gần đây nhất" là một đáp án đã tính xong, và `traCuu` cần đọc được chiều
 * của nó để không đem nó trả lời câu "sớm nhất".
 */
const THUAN = bo(['cao', 'lớn', 'nhiều', 'đắt', 'mới', 'muộn', 'trễ', 'dài', 'top', 'gần']);

export type ChieuSoSanh = 'cao' | 'thap';

/**
 * Chiều của cụm so sánh, hoặc `null` khi câu không có cụm so sánh nào đọc được.
 *
 * @param raw câu hỏi hoặc nhãn dữ kiện, THÔ — còn dấu, chưa qua `chuanHoa`.
 */
export function chieuSoSanh(raw: string): ChieuSoSanh | null {
  const tu = tachTu(raw);

  for (const [i, chu] of tu.entries()) {
    if (chu !== NHAT) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      const t = tu[j];
      if (t === undefined) continue;
      if (NGUOC.has(t)) return 'thap';
      if (THUAN.has(t)) return 'cao';
    }
  }
  return null;
}
