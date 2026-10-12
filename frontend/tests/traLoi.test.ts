import type { ReportDataDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { formatValue } from '../src/features/reports/nhanO';
import type { Nguon } from '../src/features/chat/nguCanh';
import { chuanHoa, docYDinh, traLoi } from '../src/features/chat/traLoi';

/**
 * Lõi trả lời của khung hỏi đáp.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Một con số SAI ở đây không trông như lỗi. Nó là một con số có thật, định dạng
 * đẹp, trả lời cho một câu hỏi khác — nên không có cách nào thấy bằng mắt, và
 * người đọc sẽ tin nó hơn là tin biểu đồ. Bốn chỗ hỏng được canh riêng:
 *
 *   1. Tính sai (argmax thành argmin, tổng thiếu một dòng).
 *   2. Bỏ điều kiện của con số — "tổng" trên một biểu đồ đã cắt bớt nhóm đọc
 *      ra thành tổng toàn bộ.
 *   3. Nhầm nhóm — trả lời về "Miền Bắc" khi được hỏi "Miền Bắc Trung Bộ".
 *   4. Đoán khi chưa hiểu, thay vì nói là chưa hiểu.
 */

function bang(part: Partial<ReportDataDto> = {}): ReportDataDto {
  return {
    rows: [
      { label: 'Miền Bắc', value: 300 },
      { label: 'Miền Nam', value: 500 },
      { label: 'Miền Trung', value: 200 },
    ],
    dimensionLabel: 'Khu vực',
    measureLabel: 'Doanh thu',
    grouped: false,
    ...part,
  };
}

function nguonBieuDo(part: Partial<ReportDataDto> = {}): Nguon {
  return { ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang(part) };
}

describe('Bỏ dấu tiếng Việt', () => {
  it('đ và Đ phải thành d — NFD không tách được hai ký tự đó', () => {
    /*
     * Ca này tồn tại vì `đ` là ký tự Latin riêng (U+0111), không phải "d + dấu".
     * Bỏ sót nó là mọi câu chứa "đ" khớp sai: "đếm", "đâu", "bao nhiêu đồng".
     */
    expect(chuanHoa('Đếm')).toBe('dem');
    expect(chuanHoa('đồng')).toBe('dong');
    expect(chuanHoa('  Cao   NHẤT ')).toBe('cao nhat');
  });
});

describe('Đọc ý định', () => {
  it('nhận ra từng dạng câu hỏi', () => {
    expect(docYDinh('vùng nào cao nhất')).toBe('cao_nhat');
    expect(docYDinh('thấp nhất là gì')).toBe('thap_nhat');
    expect(docYDinh('tổng doanh thu')).toBe('tong');
    expect(docYDinh('trung bình bao nhiêu')).toBe('trung_binh');
    expect(docYDinh('có mấy khu vực')).toBe('dem');
    expect(docYDinh('top 3 khu vực')).toBe('top_n');
    expect(docYDinh('đang tăng hay giảm')).toBe('xu_huong');
  });

  it('câu cụ thể hơn thắng câu chung hơn', () => {
    // "Miền Bắc chiếm bao nhiêu % so với cao nhất" chứa cả ba từ khoá. Trả về
    // `cao_nhat` là trả lời một câu hỏi khác hẳn.
    expect(docYDinh('Miền Bắc chiếm bao nhiêu % so với cao nhất')).toBe('ti_trong');
    expect(docYDinh('Miền Bắc so với Miền Nam')).toBe('so_sanh');
  });

  it('câu không liên quan -> null, không đoán', () => {
    expect(docYDinh('hôm nay trời thế nào')).toBeNull();
    expect(docYDinh('')).toBeNull();
  });

  /*
   * ⚠️ "báo **cáo nhất**" chứa đúng chuỗi "cao nhat". Không xử riêng thì câu hỏi
   * về cái ÍT nhất được trả lời bằng cái NHIỀU nhất — ngược hẳn, bằng một con
   * số có thật, nên không có dấu hiệu nào để nhận ra.
   */
  it('từ lật chiều thắng chuỗi "cao nhat" nằm lẫn trong "báo cáo nhất"', () => {
    expect(docYDinh('khu vực nào ít báo cáo nhất')).toBe('thap_nhat');
    expect(docYDinh('mô hình nào ít bảng nhất')).toBe('thap_nhat');
  });

  it('tính từ bị danh từ chen vào giữa vẫn đọc ra được', () => {
    // Bảng từ khoá so chuỗi liền nhau nên "nhiều doanh thu nhất" trượt hết.
    expect(docYDinh('khu vực nào nhiều doanh thu nhất')).toBe('cao_nhat');
  });

  it('lưới hứng "nhất" KHÔNG cướp của ti_trong và top_n', () => {
    // Hai câu này đều có chữ "nhất", và thứ tự trong bảng cố ý xếp chúng lên
    // trước `cao_nhat`. Lưới hứng phải nằm SAU bảng mới giữ được thứ tự đó.
    expect(docYDinh('Miền Bắc chiếm bao nhiêu % so với cao nhất')).toBe('ti_trong');
    expect(docYDinh('top 3 cao nhất là những vùng nào')).toBe('top_n');
  });
});

describe('Hỏi ngược chiều trên biểu đồ', () => {
  it('"ít … nhất" ra dòng thấp nhất, không phải dòng cao nhất', () => {
    const kq = traLoi(nguonBieuDo(), 'khu vực nào ít báo cáo nhất');

    // Miền Trung 200 là thấp nhất; Miền Nam 500 là cao nhất.
    expect(kq?.cau).toContain('Miền Trung');
    expect(kq?.cau).not.toContain('Miền Nam');
  });

  it('"nhiều … nhất" ra dòng cao nhất', () => {
    expect(traLoi(nguonBieuDo(), 'khu vực nào nhiều doanh thu nhất')?.cau).toContain('Miền Nam');
  });
});

describe('Tính trên số liệu biểu đồ', () => {
  it('cao nhất và thấp nhất gọi đúng tên nhóm và đúng số', () => {
    expect(traLoi(nguonBieuDo(), 'khu vực nào cao nhất')?.cau).toContain('Miền Nam');
    expect(traLoi(nguonBieuDo(), 'khu vực nào cao nhất')?.cau).toContain('500');
    expect(traLoi(nguonBieuDo(), 'thấp nhất là khu vực nào')?.cau).toContain('Miền Trung');
  });

  it('tổng và trung bình', () => {
    expect(traLoi(nguonBieuDo(), 'tổng doanh thu là bao nhiêu')?.cau).toContain('1.000');
    // 1000 / 3 nhóm
    expect(traLoi(nguonBieuDo(), 'doanh thu trung bình')?.cau).toContain('333,333');
  });

  it('đếm nhóm, và đếm nhãn PHÂN BIỆT chứ không đếm dòng', () => {
    // Biểu đồ hai chiều có mỗi nhãn nhiều dòng — một cho mỗi chuỗi. Đếm dòng sẽ
    // trả lời "6 khu vực" cho một biểu đồ có 3 khu vực.
    const hai = nguonBieuDo({
      seriesLabel: 'Năm',
      rows: [
        { label: 'Miền Bắc', series: '2024', value: 100 },
        { label: 'Miền Bắc', series: '2025', value: 200 },
        { label: 'Miền Nam', series: '2024', value: 400 },
        { label: 'Miền Nam', series: '2025', value: 500 },
      ],
    });
    expect(traLoi(hai, 'có mấy khu vực')?.cau).toContain('2 Khu vực');
  });

  it('có chiều thứ hai thì cao nhất gọi CẢ nhãn và chuỗi', () => {
    /*
     * Nhãn trùng nhau khi có `series`. Trả về mỗi "Miền Nam" thì người đọc không
     * biết là năm nào — và năm nào mới có thể là tin đáng chú ý.
     */
    const hai = nguonBieuDo({
      seriesLabel: 'Năm',
      rows: [
        { label: 'Miền Bắc', series: '2024', value: 100 },
        { label: 'Miền Nam', series: '2025', value: 900 },
      ],
    });
    const cau = traLoi(hai, 'cao nhất')?.cau ?? '';
    expect(cau).toContain('Miền Nam');
    expect(cau).toContain('2025');
  });

  it('top N lấy N từ câu hỏi, mặc định 5', () => {
    const cau = traLoi(nguonBieuDo(), 'top 2 khu vực')?.cau ?? '';
    expect(cau).toContain('Miền Nam');
    expect(cau).toContain('Miền Bắc');
    expect(cau).not.toContain('Miền Trung');
  });

  it('tỉ trọng và so sánh', () => {
    expect(traLoi(nguonBieuDo(), 'Miền Bắc chiếm bao nhiêu phần trăm')?.cau).toContain('30 %');
    const ss = traLoi(nguonBieuDo(), 'Miền Bắc so với Miền Nam')?.cau ?? '';
    expect(ss).toContain('Miền Nam');
    expect(ss).toContain('200'); // chênh 500 - 300
  });

  it('hỏi thẳng tên nhóm, không có từ khoá nào', () => {
    // "Miền Bắc bao nhiêu" không chứa từ khoá ý định nào cả.
    expect(traLoi(nguonBieuDo(), 'Miền Bắc bao nhiêu')?.cau).toContain('300');
  });

  it('nhãn DÀI NHẤT thắng — không trả lời về một nhóm khác', () => {
    /*
     * "Miền Bắc" là chuỗi con của "Miền Bắc Trung Bộ". Lấy nhãn ngắn là trả lời
     * về nhóm khác bằng một con số CÓ THẬT, nên không có gì báo là đã nhầm.
     */
    const n = nguonBieuDo({
      rows: [
        { label: 'Miền Bắc', value: 300 },
        { label: 'Miền Bắc Trung Bộ', value: 777 },
      ],
    });
    expect(traLoi(n, 'Miền Bắc Trung Bộ bao nhiêu')?.cau).toContain('777');
  });
});

describe('Số liệu đã bị cắt thì PHẢI nói ra', () => {
  /*
   * Ca quan trọng nhất của cả file.
   *
   * `grouped`/`paging.hasMore` nghĩa là `rows` không phải toàn bộ. Một câu
   * "Tổng doanh thu là 1.000" trên 5 nhóm của 13 nhóm là SAI, và nó sai theo
   * cách không ai kiểm được — con số đúng với những gì đang vẽ.
   */
  it('grouped bật -> câu trả lời tổng mang cảnh báo', () => {
    const cau = traLoi(nguonBieuDo({ grouped: true }), 'tổng doanh thu')?.cau ?? '';
    expect(cau).toContain('3 nhóm đang hiện');
    expect(cau).toContain('không phải toàn bộ');
  });

  it('còn trang nhóm nữa -> cũng mang cảnh báo', () => {
    const cau =
      traLoi(nguonBieuDo({ paging: { page: 0, hasMore: true } }), 'trung bình')?.cau ?? '';
    expect(cau).toContain('đang hiện');
  });

  it('tỉ trọng cũng mang cảnh báo — nó còn sai lệch nhiều hơn', () => {
    // Tổng dùng làm mẫu số chỉ là tổng các nhóm đang hiện, nên tỉ trọng tính ra
    // LỚN HƠN tỉ trọng thật.
    const cau = traLoi(nguonBieuDo({ grouped: true }), 'Miền Bắc chiếm bao nhiêu %')?.cau ?? '';
    expect(cau).toContain('đang hiện');
  });

  it('không bị cắt thì KHÔNG thêm cảnh báo — ca đối chứng', () => {
    // Thiếu ca này thì một bản "lúc nào cũng cảnh báo" vẫn cho ba ca trên màu
    // xanh, và mọi câu trả lời đều kèm một lời rào không đúng sự thật.
    expect(traLoi(nguonBieuDo(), 'tổng doanh thu')?.cau).not.toContain('đang hiện');
  });
});

describe('Con số in ra GIỐNG HỆT bảng số liệu', () => {
  it('thước đo phần trăm đọc theo cùng một hàm', () => {
    /*
     * `format: 'percent'` nghĩa là kho lưu 0,283 và màn hình đọc "28,3 %". Lõi
     * hỏi đáp tự chia 100 lần nữa, hay quên chia, đều cho ra một con số lệch
     * hẳn so với bảng ngay dưới biểu đồ.
     */
    const n = nguonBieuDo({ format: 'percent', rows: [{ label: 'Miền Bắc', value: 0.283 }] });
    const cau = traLoi(n, 'cao nhất')?.cau ?? '';
    expect(cau).toContain(formatValue(0.283, 'percent'));
    expect(cau).toContain('28,3 %');
  });
});

describe('Tra cứu dữ kiện của trang', () => {
  const kho: Nguon = {
    ten: 'Đơn hàng Q4',
    duKien: [
      { nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431', luuY: 'tệp đã bị cắt khi tải lên' },
      { nhan: 'Số cột của Đơn hàng Q4', gia: '8' },
      { nhan: 'Tệp gốc của Đơn hàng Q4', gia: 'bao-cao-q4.xlsx' },
    ],
  };

  it('khớp theo TỪ trùng, không cần chứa cả chuỗi', () => {
    // Nhãn "Số dòng của Đơn hàng Q4" vs câu hỏi "đơn hàng q4 có bao nhiêu dòng"
    // — không chuỗi nào chứa chuỗi nào.
    expect(traLoi(kho, 'đơn hàng q4 có bao nhiêu dòng')?.cau).toContain('12.431');
    expect(traLoi(kho, 'tệp gốc của đơn hàng q4')?.cau).toContain('bao-cao-q4.xlsx');
  });

  it('dữ kiện có luuY thì câu trả lời PHẢI mang theo', () => {
    // `rowCount` một mình "nói dối" khi tệp bị cắt — doc comment của chính DTO
    // nói vậy. Khung lặp lại con số mà bỏ điều kiện thì nói dối to hơn màn hình.
    expect(traLoi(kho, 'đơn hàng q4 có bao nhiêu dòng')?.cau).toContain('đã bị cắt');
  });

  it('trùng đúng một từ -> null, vì đó là trùng ngẫu nhiên', () => {
    expect(traLoi(kho, 'của')).toBeNull();
    expect(traLoi(kho, 'hôm nay trời thế nào')).toBeNull();
  });

  it('hai dữ kiện bằng điểm -> null, không chọn bừa', () => {
    /*
     * "số của X" trùng 2 từ với cả "Số dòng của X" và "Số cột của X". Chọn cái
     * đầu danh sách là trả lời bằng một con số có thật cho một câu hỏi chưa rõ.
     */
    const haiNgang: Nguon = {
      ten: 'X',
      duKien: [
        { nhan: 'Số dòng của X', gia: '10' },
        { nhan: 'Số cột của X', gia: '20' },
      ],
    };
    expect(traLoi(haiNgang, 'số của X')).toBeNull();
  });
});

describe('Nguồn không có bảng thì không tính được', () => {
  it('hỏi câu tính toán trên nguồn chỉ có dữ kiện -> null', () => {
    // Trang Kho dữ liệu không giữ số liệu tổng hợp nào, nên "tổng doanh thu" ở
    // đó phải ra "chưa hiểu" chứ không phải một con số lấy từ chỗ khác.
    const chiDuKien: Nguon = { ten: 'X', duKien: [{ nhan: 'Số cột của X', gia: '8' }] };
    expect(traLoi(chiDuKien, 'khu vực nào doanh thu cao nhất')).toBeNull();
  });

  it('bảng rỗng nói rõ là rỗng, không phải trả về 0', () => {
    // "Tổng là 0" và "không có dòng nào" là hai chuyện khác nhau.
    const rong = nguonBieuDo({ rows: [] });
    expect(traLoi(rong, 'tổng doanh thu')?.cau).toContain('không có dòng nào');
  });
});
