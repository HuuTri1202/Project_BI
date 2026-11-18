import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MUC_HUONG_DAN, traLoiHuongDan } from '../src/features/chat/huongDan';
import { chuanHoa } from '../src/features/chat/traLoi';

/**
 * Lớp hướng dẫn của khung hỏi đáp.
 *
 * ═══ Ba bài đầu canh ba kiểu HỎNG TRONG IM LẶNG ════════════════════════════
 *
 * Lớp này không trả về con số nào, nên nó không sinh ra được kết cục SAI. Nhưng
 * nó có ba kiểu hỏng riêng, và cả ba đều xanh nếu chỉ test "hỏi thì có trả lời":
 *
 *   1. Từ khoá CHẾT. `chuanHoa` áp bảng đồng nghĩa, nên một từ khoá bị bảng đó
 *      viết lại sẽ không bao giờ khớp. Đo được khi viết file: `nang` thành
 *      `dung luong` và `database` thành `co so du lieu` — hai mục im lặng chết.
 *   2. Hướng dẫn MỤC RỮA: trỏ người dùng tới một trang không còn tồn tại.
 *   3. CHIẾM câu hỏi số liệu chỉ vì câu đó mở đầu bằng "làm sao".
 */
describe('Hướng dẫn — chống hỏng trong im lặng', () => {
  /**
   * ⚠️ BÀI QUAN TRỌNG NHẤT CỦA TỆP.
   *
   * Mọi phép so của `traLoiHuongDan` chạy trên câu hỏi ĐÃ qua `chuanHoa`, nên
   * một từ khoá mà `chuanHoa` viết lại là một từ khoá không bao giờ khớp — và
   * không có dấu hiệu nào: mục đó chỉ đơn giản không bao giờ được chọn.
   *
   * Bài này đỏ ngay lúc ai đó thêm một từ khoá có dấu, hoặc một từ nằm trong
   * bảng đồng nghĩa (`nang`, `database`, `file`, `report`, `dataset`…).
   */
  it('mọi từ khoá đều SỐNG SÓT qua chuanHoa', () => {
    const chet = MUC_HUONG_DAN.flatMap((m) =>
      [...m.hanhDong, ...m.doiTuong]
        .filter((t) => chuanHoa(t) !== t)
        .map((t) => `${t} -> ${chuanHoa(t)}`),
    );

    expect(chet).toEqual([]);
  });

  /**
   * Hướng dẫn trỏ tới một trang không còn tồn tại thì tệ hơn không có hướng dẫn:
   * người dùng đi theo nó.
   *
   * Đọc thẳng `App.tsx` chứ không nhập một hằng số: router là nguồn duy nhất
   * nói đường nào có thật, và một danh sách đường thứ hai để đối chiếu thì chính
   * nó cũng mục rữa.
   */
  it('mọi đường dẫn đều CÒN trong App.tsx', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const thieu = MUC_HUONG_DAN.filter((m) => !app.includes(`path="${m.duong}"`)).map(
      (m) => m.duong,
    );

    expect(thieu).toEqual([]);
  });

  /**
   * ⚠️ Từ khoá LỒNG NHAU trong cùng một vế là một điểm không có thật.
   *
   * `q.includes(' mo hinh ')` và `q.includes(' mo hinh du lieu ')` cùng đúng khi
   * người ta gõ "mô hình dữ liệu", nên mục khai cả hai tự cộng cho mình 2 điểm.
   *
   * ĐO ĐƯỢC khi viết tệp này: "làm sao tạo BÁO CÁO từ mô hình dữ liệu" nhận về
   * hướng dẫn tạo MÔ HÌNH, thắng 3–2 bằng đúng cái điểm ảo đó. Năm trong mười
   * một mục mắc lỗi này (`bo du lieu`/`du lieu`, `kho`/`kho phan tich`,
   * `goi`/`goi dich vu`…), nên nó là lỗi hệ thống chứ không phải một lần lỡ tay.
   */
  it('không từ khoá nào LỒNG trong một từ khoá khác cùng vế', () => {
    const long = MUC_HUONG_DAN.flatMap((m) =>
      (['hanhDong', 'doiTuong'] as const).flatMap((ve) =>
        m[ve].flatMap((a) =>
          m[ve]
            .filter((b) => a !== b && ` ${b} `.includes(` ${a} `))
            .map((b) => `${ve}: "${a}" lồng trong "${b}"`),
        ),
      ),
    );

    expect(long).toEqual([]);
  });

  it('không mục nào thiếu vế hành động hay vế đối tượng', () => {
    // Thiếu một vế là mục đó hoặc không bao giờ khớp, hoặc khớp quá rộng rồi
    // chiếm câu hỏi số liệu — xem chốt `hd === 0 || dt === 0` trong `huongDan.ts`.
    for (const m of MUC_HUONG_DAN) {
      expect(m.hanhDong.length, `hành động của: ${m.cau.slice(0, 40)}`).toBeGreaterThan(0);
      expect(m.doiTuong.length, `đối tượng của: ${m.cau.slice(0, 40)}`).toBeGreaterThan(0);
    }
  });
});

describe('Hướng dẫn — chọn đúng việc', () => {
  it.each([
    ['làm sao để xoá một bộ dữ liệu', 'xoá'],
    ['làm thế nào để tải dữ liệu lên', 'tải lên'],
    ['cách tạo báo cáo', 'Báo cáo'],
    ['làm sao thêm thành viên mới', 'Thành viên'],
    ['làm sao đổi mật khẩu', 'mật khẩu'],
    ['làm sao nối quan hệ giữa hai bảng', 'quan hệ'],
  ])('"%s" → hướng dẫn nhắc "%s"', (hoi, mong) => {
    const kq = traLoiHuongDan(chuanHoa(hoi));

    expect(kq).not.toBeNull();
    expect(kq?.cau).toContain(mong);
    // KHÔNG con số nào — lớp này không tính gì, nên không có gì để đối chiếu.
    expect(kq?.so).toEqual([]);
  });
});

describe('Hướng dẫn — biết khi nào IM', () => {
  /**
   * ⚠️ Đây là chốt giữ cho lớp hướng dẫn không ăn vào lớp số liệu.
   *
   * "Làm sao biết bộ nào nhiều dòng nhất" có dấu hiệu "làm sao" và có từ đối
   * tượng "bộ dữ liệu", nhưng nó là một câu hỏi SỐ LIỆU — câu trả lời đúng của
   * nó là một con số, và khung đã trả lời được từ lâu. Trả về hướng dẫn tải tệp
   * ở đây là thay một câu trả lời đúng bằng một câu lạc đề.
   */
  it.each([
    'làm sao biết bộ nào nhiều dòng nhất',
    // Ba câu dưới có ĐỦ ba điều kiện của lớp hướng dẫn, và vẫn phải im: từ hỏi
    // của chúng ("ai", "bao nhiêu", "mấy") nói rằng đây là câu hỏi SỐ LIỆU.
    // Xem `TU_HOI_SO_LIEU`. Không có chốt đó, câu đầu nhận hướng dẫn TẠO báo cáo.
    'làm sao biết ai tạo báo cáo này',
    'làm sao biết có bao nhiêu bộ dữ liệu',
    'cách xem mấy mô hình đang dùng',
    'làm sao biết báo cáo nào mới nhất',
    'bộ dữ liệu nào nhiều dòng nhất',
    'có bao nhiêu bộ dữ liệu',
    'doanh thu cao nhất là bao nhiêu',
    'hôm nay trời thế nào',
  ])('"%s" → KHÔNG trả hướng dẫn', (hoi) => {
    expect(traLoiHuongDan(chuanHoa(hoi))).toBeNull();
  });

  /**
   * ⚠️ Bài này là thứ giữ cho luật "phải hơn hẳn ứng viên nhì" còn sống.
   *
   * Không có nó, bỏ luật đó đi thì KHÔNG bài nào đỏ — đã thử bằng đột biến. Và
   * một luật không bài nào bẻ được là một luật không ai biết còn sống hay đã
   * chết, nên nó sẽ bị gỡ trong một lần dọn dẹp nào đó.
   *
   * "Thêm bộ dữ liệu vào mô hình" hoà điểm giữa hướng dẫn TẢI DỮ LIỆU LÊN và
   * hướng dẫn TẠO MÔ HÌNH — câu hỏi này thật sự chưa phân biệt được hai việc,
   * nên im là câu trả lời đúng. Bỏ luật thì nó trả về mục đứng trước trong mảng,
   * tức một hướng dẫn được chọn bằng THỨ TỰ KHAI BÁO.
   */
  it('hoà điểm giữa hai mục → im, không chọn mục khai trước', () => {
    expect(traLoiHuongDan(chuanHoa('cách thêm bộ dữ liệu vào mô hình'))).toBeNull();
  });

  it('câu hỏi cách làm KHÔNG khớp mục nào → im, chứ không đoán mục gần nhất', () => {
    // Trả về một hướng dẫn gần đúng cho việc người ta không hỏi còn tệ hơn nói
    // chưa hiểu: họ sẽ đi làm theo.
    expect(traLoiHuongDan(chuanHoa('làm sao để xuất báo cáo ra file PowerPoint'))).toBeNull();
    expect(traLoiHuongDan(chuanHoa('làm sao đổi múi giờ của hệ thống'))).toBeNull();
  });
});
