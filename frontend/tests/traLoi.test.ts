import type { ReportDataDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { formatValue } from '../src/features/reports/nhanO';
import type { Nguon } from '../src/features/chat/nguCanh';
import {
  chuanHoa,
  docDieuKien,
  docYDinh,
  luaChonHeThong,
  luaChonTrang,
  traLoi,
  traLoiHeThong,
} from '../src/features/chat/traLoi';

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

describe('Từ người dùng gõ nối về từ trên nhãn', () => {
  /*
   * Mọi nhãn ở nhánh tra cứu do CHÍNH `duKienTrang.ts` viết ra, nên bảng đồng
   * nghĩa không đoán gì về dữ liệu của khách — nó chỉ nối từ người ta hay gõ về
   * đúng chữ ta đã chọn. Hai phía đều của ta.
   */
  it('nối được tiếng Anh và cách nói vòng về đúng chữ trên nhãn', () => {
    expect(chuanHoa('Orders có bao nhiêu row')).toBe('orders co bao nhieu dong');
    expect(chuanHoa('mấy column')).toBe('may cot');
    expect(chuanHoa('model nào nhiều table nhất')).toBe('mo hinh nao nhieu bang nhat');
    // "nặng bao nhiêu" là chính ví dụ mà `llm:kiem` dùng để thử lớp mô hình.
    expect(chuanHoa('nặng bao nhiêu')).toBe('dung luong bao nhieu');
  });

  /*
   * ⚠️ Phải so TỪ TRỌN VẸN. Thay theo chuỗi con là "profile" thành "protep" và
   * "models" thành "mo hinhs" — rồi mọi phép so sau đó trượt vì một lý do không
   * ai nghĩ tới khi đọc câu hỏi.
   */
  it('chỉ thay TỪ trọn vẹn, không thay chuỗi con', () => {
    expect(chuanHoa('profile')).toBe('profile');
    expect(chuanHoa('modeling')).toBe('modeling');
    expect(chuanHoa('tablet')).toBe('tablet');
  });

  it('không đổi một chữ nào của nhãn hiện ra', () => {
    // `chuanHoa` chỉ dùng để SO. Câu trả lời luôn dựng từ `nhan` nguyên văn.
    const nguon: Nguon = {
      ten: 'Orders',
      duKien: [{ nhan: 'Số dòng của Orders', gia: '51.290' }],
    };
    expect(traLoi(nguon, 'Orders có bao nhiêu row')?.cau).toBe('Số dòng của Orders: 51.290.');
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

describe('Biểu đồ hai chiều: hỏi chiều nào thì cộng theo chiều đó', () => {
  /**
   * Đúng hình dạng màn hình thật: Quantity theo Customer Name, tách màu theo
   * Product Name. Mỗi dòng là một CẶP (khách, sản phẩm).
   *
   * Staples: 5 + 6 = 11 — tổng lớn nhất, nhưng không dòng nào của nó lớn nhất.
   * Boston:  9      =  9 — dòng lớn nhất bảng, mà tổng lại thua.
   */
  function hinhHai(): Nguon {
    return {
      ten: 'Quantity theo Customer Name',
      duKien: [],
      bang: {
        rows: [
          { label: 'Jonathan Doherty', value: 9, series: 'Boston Pencil Sharpener' },
          { label: 'Jonathan Doherty', value: 5, series: 'Staples' },
          { label: 'Laura Armstrong', value: 6, series: 'Staples' },
          { label: 'Laura Armstrong', value: 2, series: 'Acco Index Tab' },
        ],
        dimensionLabel: 'Customer Name',
        measureLabel: 'Quantity',
        seriesLabel: 'Product Name',
        grouped: false,
      },
    };
  }

  /*
   * ⚠️ Ca cốt lõi. Trả lời bằng DÒNG lớn nhất ra "Jonathan Doherty (Boston
   * Pencil Sharpener): 9" — đúng số, sai câu hỏi. Sản phẩm bán nhiều nhất là
   * sản phẩm có TỔNG lớn nhất, cộng qua mọi khách đang hiện.
   */
  it('hỏi theo chuỗi thì cộng theo chuỗi, không lấy dòng lớn nhất', () => {
    const kq = traLoi(hinhHai(), 'product name nào có quantity cao nhất');

    expect(kq?.cau).toContain('Staples');
    expect(kq?.so).toEqual(['11']);
    expect(kq?.cau).not.toContain('Boston');
  });

  it('hỏi theo chiều trục thì cộng theo trục', () => {
    // Jonathan 9+5 = 14; Laura 6+2 = 8.
    const kq = traLoi(hinhHai(), 'customer name nào có quantity cao nhất');

    expect(kq?.cau).toContain('Jonathan Doherty');
    expect(kq?.so).toEqual(['14']);
  });

  it('thấp nhất cũng cộng theo chiều được hỏi', () => {
    expect(traLoi(hinhHai(), 'product name nào quantity thấp nhất')?.cau).toContain(
      'Acco Index Tab',
    );
  });

  it('top N cũng xếp hạng theo chiều được hỏi', () => {
    const kq = traLoi(hinhHai(), 'top 2 product name');

    expect(kq?.cau).toContain('1. Staples 11');
    expect(kq?.cau).toContain('2. Boston Pencil Sharpener 9');
  });

  /*
   * Không gọi tên chiều nào thì KHÔNG được tự ý cộng: không có cách nào biết
   * người hỏi muốn gộp hay không, và một con số gộp im lặng thì không ai nhận
   * ra. Giữ cách cũ — dòng lớn nhất, gọi đủ cả hai tên.
   */
  it('không gọi tên chiều nào thì vẫn trả lời bằng dòng lớn nhất', () => {
    const kq = traLoi(hinhHai(), 'cao nhất là gì');

    expect(kq?.cau).toContain('Jonathan Doherty (Boston Pencil Sharpener)');
    expect(kq?.so).toEqual(['9']);
  });

  /*
   * Gọi tên cả hai chiều mà hai tên rời nhau thì câu hỏi thật sự lẫn lộn. Chọn
   * bừa một chiều là đưa ra một con số GỘP mà không ai biết đã gộp theo gì.
   */
  it('gọi tên cả hai chiều thì không gộp bừa', () => {
    const kq = traLoi(hinhHai(), 'customer name với product name cái nào cao nhất');

    expect(kq?.cau).toContain('Jonathan Doherty (Boston Pencil Sharpener)');
  });

  /*
   * Trừ khi một tên nằm lọt trong tên kia — khi đó mọi câu hỏi về "Product
   * Name" đều chứa "Name", và tên dài hơn mới là tên người dùng gõ.
   */
  it('tên chiều này nằm trong tên chiều kia thì lấy tên dài hơn', () => {
    const n = hinhHai();
    const bang = { ...n.bang!, dimensionLabel: 'Name' };

    expect(traLoi({ ...n, bang }, 'product name nào cao nhất')?.cau).toContain('Staples');
  });

  it('số liệu bị cắt thì câu gộp vẫn mang cảnh báo', () => {
    const n = hinhHai();
    const bang = { ...n.bang!, paging: { page: 0, hasMore: true } };

    expect(traLoi({ ...n, bang }, 'product name nào có quantity cao nhất')?.cau).toContain(
      'không phải toàn bộ dữ liệu',
    );
  });
});

describe('Lọc theo giá trị', () => {
  function hinhHai(): Nguon {
    return {
      ten: 'Quantity theo Customer Name',
      duKien: [],
      bang: {
        rows: [
          { label: 'Jonathan', value: 9, series: 'Boston' },
          { label: 'Jonathan', value: 4, series: 'Staples' },
          { label: 'Laura', value: 4, series: 'Acco' },
          { label: 'Laura', value: 6, series: 'Staples' },
        ],
        dimensionLabel: 'Customer Name',
        measureLabel: 'Quantity',
        seriesLabel: 'Product Name',
        grouped: false,
      },
    };
  }

  it('đọc toán tử và ngưỡng từ chính câu người dùng gõ', () => {
    expect(docDieuKien('có số lượng là 4')).toEqual({ toanTu: '=', nguong: 4 });
    expect(docDieuKien('số lượng trên 10')).toEqual({ toanTu: '>', nguong: 10 });
    expect(docDieuKien('số lượng dưới 10')).toEqual({ toanTu: '<', nguong: 10 });
    expect(docDieuKien('số lượng từ 10 trở lên')).toEqual({ toanTu: '>=', nguong: 10 });
    expect(docDieuKien('số lượng từ 10 trở xuống')).toEqual({ toanTu: '<=', nguong: 10 });
    // Không có con số nào thì đây không phải câu hỏi lọc.
    expect(docDieuKien('liệt kê sản phẩm')).toBeNull();
  });

  /*
   * ⚠️ Từ DÀI phải thử trước: "lớn hơn hoặc bằng" CHỨA "lớn hơn". Sai thứ tự
   * thì ">= 10" thành "> 10", và câu trả lời thiếu đúng những mục bằng 10 —
   * một danh sách ngắn hơn sự thật, không có gì báo.
   */
  it('"lớn hơn hoặc bằng" không bị đọc thành "lớn hơn"', () => {
    expect(docDieuKien('quantity lớn hơn hoặc bằng 4')).toEqual({ toanTu: '>=', nguong: 4 });
    expect(docDieuKien('quantity nhỏ hơn hoặc bằng 4')).toEqual({ toanTu: '<=', nguong: 4 });
  });

  it('liệt kê đúng những chuỗi khớp điều kiện', () => {
    // Gộp theo Product Name: Boston 9, Staples 10, Acco 4.
    const kq = traLoi(hinhHai(), 'liệt kê product name có quantity là 4');

    expect(kq?.cau).toContain('Acco');
    expect(kq?.cau).not.toContain('Staples');
    expect(kq?.so).toEqual(['1']);
  });

  /*
   * "Liệt kê" mà không có con số là câu LIỆT KÊ HẾT, và tuyệt đối không được
   * tự nghĩ ra một ngưỡng (0, hay giá trị đầu tiên): bịa ra một điều kiện mà
   * người dùng chưa hề nói thì kết quả vẫn là một danh sách trông hợp lý.
   */
  it('câu lọc không có ngưỡng thì liệt kê HẾT, không tự đặt ngưỡng', () => {
    const kq = traLoi(hinhHai(), 'liệt kê product name');

    expect(kq?.cau ?? '').not.toContain('bằng 0');
    expect(kq?.cau ?? '').not.toContain('Product Name nào có Quantity bằng');
    // Gộp theo Product Name: Boston 9, Staples 10, Acco 4.
    expect(kq?.cau).toBe('3 Product Name trên biểu đồ này: Boston (9); Staples (10); Acco (4).');
  });

  /*
   * ⚠️ "trên" có hai nghĩa, và cả hai gặp liên tục trong cùng một câu. Đọc
   * "trên biểu đồ" thành toán tử `>` biến một câu lọc BẰNG 4 thành một danh
   * sách LỚN HƠN 4 — khác hẳn, mà không mục nào trong đó sai.
   */
  it('"trên biểu đồ" không phải toán tử lớn hơn', () => {
    expect(docDieuKien('liệt kê sản phẩm trên biểu đồ có số lượng 4')).toEqual({
      toanTu: '=',
      nguong: 4,
    });
    // Còn "trên 4" thì vẫn phải là lớn hơn.
    expect(docDieuKien('sản phẩm có số lượng trên 4')).toEqual({ toanTu: '>', nguong: 4 });
    expect(docDieuKien('sản phẩm dưới biểu đồ có số lượng 4')).toEqual({
      toanTu: '=',
      nguong: 4,
    });
  });

  it('không mục nào khớp thì nói thẳng', () => {
    expect(traLoi(hinhHai(), 'liệt kê product name có quantity là 99')?.cau).toContain(
      'Không Product Name nào',
    );
  });

  /*
   * Không gộp thì mỗi mục là một DÒNG, không phải một giá trị của chiều nào.
   * Gọi nó bằng tên chiều là nói sai: "2 Customer Name" trong khi danh sách
   * liệt kê ra hai CẶP (khách, sản phẩm).
   */
  it('không gộp thì không gọi mục là tên một chiều', () => {
    const kq = traLoi(hinhHai(), 'liệt kê những mục có giá trị là 4');

    expect(kq?.cau).toContain('mục trên biểu đồ');
    expect(kq?.cau).not.toContain('2 Customer Name');
  });
});

describe('luaChonTrang — mọi thứ trang trả lời được', () => {
  const bieuDo: Nguon = { ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() };
  const traCuu: Nguon = {
    ten: 'Đơn hàng Q4',
    duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '120' }],
  };

  /*
   * Lớp hiểu câu hỏi chỉ cho mô hình CHỌN một mục trong danh sách này. Thiếu
   * phép tính trong danh sách nghĩa là mô hình không bao giờ chọn được một
   * phép tính — và "liệt kê sản phẩm có số lượng là 4" nhận về "chưa hiểu"
   * ngay cạnh một biểu đồ có sẵn câu trả lời.
   */
  it('biểu đồ góp cả PHÉP TÍNH vào danh sách, không chỉ dữ kiện', () => {
    const nhan = luaChonTrang([bieuDo], bieuDo, '').map((lc) => lc.nhan);

    expect(nhan).toContain('Khu vực nào có Doanh thu cao nhất');
    expect(nhan).toContain('Tổng Doanh thu');
    expect(nhan.some((n) => n.startsWith('Liệt kê Khu vực theo Doanh thu'))).toBe(true);
  });

  it('mỗi lựa chọn tự chạy ra đúng câu trả lời của nó', () => {
    const ds = luaChonTrang([bieuDo], bieuDo, 'tổng doanh thu');
    const tong = ds.find((lc) => lc.nhan === 'Tổng Doanh thu');

    expect(tong?.chay()?.cau).toBe('Tổng Doanh thu là 1.000.');
  });

  it('nguồn đang chọn xếp trước — backend chỉ lấy 60 nhãn đầu', () => {
    const ds = luaChonTrang([bieuDo, traCuu], traCuu, '');

    expect(ds[0]?.nhan).toBe('Số dòng của Đơn hàng Q4');
  });

  it('nguồn không có biểu đồ thì chỉ góp dữ kiện', () => {
    expect(luaChonTrang([traCuu], traCuu, '')).toHaveLength(1);
  });
});

describe('Liệt kê bằng CHỮ — "có những sản phẩm nào trên biểu đồ"', () => {
  /*
   * Câu hỏi tự nhiên nhất về một biểu đồ, và trước đây nó nhận về "tôi chưa
   * hiểu" ngay cạnh một biểu đồ đang hiện đúng danh sách đó: không cụm từ khoá
   * nào khớp "có những … nào", vì giữa "những" và "nào" còn chen tên chiều.
   */
  it('nhận ra ý định liệt kê qua mấy cách nói khác nhau', () => {
    expect(docYDinh('có những sản phẩm nào trên biểu đồ')).toBe('loc');
    expect(docYDinh('liệt kê các sản phẩm')).toBe('loc');
    expect(docYDinh('danh sách khu vực')).toBe('loc');
    expect(docYDinh('tên các khu vực')).toBe('loc');
  });

  it('đọc ra ĐỦ tên, kèm giá trị của từng tên', () => {
    const kq = traLoi(nguonBieuDo(), 'có những khu vực nào trên biểu đồ');

    expect(kq?.cau).toBe(
      '3 Khu vực trên biểu đồ này: Miền Bắc (300); Miền Nam (500); Miền Trung (200).',
    );
    // Con số duy nhất mà câu này đứng trên là SỐ LƯỢNG mục. Tên và giá trị
    // từng mục không nằm trong `so`, nên lớp viết lại được phép đọc chúng
    // thành lời.
    expect(kq?.so).toEqual(['3']);
  });

  /*
   * ⚠️ Biểu đồ MỘT chiều thì `chieuHoi` trả `null` ngay từ dòng đầu, nên nhánh
   * này từng gọi mọi mục là "mục trên biểu đồ". Với một chiều thì mỗi dòng
   * đúng là một giá trị của chiều đó, và không gọi tên nó ra là bỏ mất thứ duy
   * nhất nói cho người đọc biết danh sách này là danh sách GÌ.
   */
  it('một chiều thì gọi tên chiều, hai chiều mà không nói rõ thì không gọi', () => {
    expect(traLoi(nguonBieuDo(), 'liệt kê tất cả')?.cau).toContain('3 Khu vực');

    const hai = traLoi(
      {
        ten: 'Quantity theo Customer Name',
        duKien: [],
        bang: bang({
          rows: [
            { label: 'Jonathan', value: 9, series: 'Boston' },
            { label: 'Laura', value: 4, series: 'Acco' },
          ],
          dimensionLabel: 'Customer Name',
          measureLabel: 'Quantity',
          seriesLabel: 'Product Name',
        }),
      },
      'liệt kê tất cả các mục',
    );
    expect(hai?.cau).toContain('mục trên biểu đồ');
    expect(hai?.cau).toContain('Jonathan (Boston)');
  });

  it('số liệu đã cắt bớt thì câu liệt kê vẫn mang cảnh báo', () => {
    const kq = traLoi(nguonBieuDo({ grouped: true }), 'liệt kê các khu vực');

    expect(kq?.cau).toContain('không phải toàn bộ dữ liệu');
  });

  /*
   * Nhãn nói "tất cả" thì phải liệt kê tất cả. Mô hình chọn nhãn này cho một
   * câu hỏi có con số lạc trong đó ("liệt kê tất cả sản phẩm, tôi có 3 biểu
   * đồ") mà nó lại lọc theo 3 thì nó nói sai chính việc nó vừa làm.
   */
  it('lựa chọn "Liệt kê tất cả" KHÔNG lọc theo con số trong câu hỏi', () => {
    const nguon = nguonBieuDo();
    const ds = luaChonTrang([nguon], nguon, 'liệt kê tất cả khu vực, tôi có 3 biểu đồ');
    const tatCa = ds.find((lc) => lc.nhan === 'Liệt kê tất cả Khu vực');

    expect(tatCa).toBeDefined();
    expect(tatCa?.chay()?.cau).toContain('3 Khu vực trên biểu đồ này');
    expect(tatCa?.chay()?.cau).toContain('Miền Nam');
  });
});

describe('Trả lời XUYÊN HỆ THỐNG', () => {
  /** Đúng hình dạng `useNguCanhHeThong` dựng ra: tóm tắt trước, từng mục sau. */
  function heThong(): Nguon[] {
    return [
      {
        ten: 'Tổng quan toàn tổ chức',
        duKien: [
          { nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: '12' },
          { nhan: 'Số mô hình dữ liệu trong toàn bộ tổ chức', gia: '3' },
        ],
      },
      { ten: 'Bán hàng', duKien: [{ nhan: 'Số bảng trong mô hình Bán hàng', gia: '5' }] },
      { ten: 'Kho vận', duKien: [{ nhan: 'Số bảng trong mô hình Kho vận', gia: '9' }] },
    ];
  }

  it('so cả danh sách, và nói rõ là so trên toàn tổ chức', () => {
    const kq = traLoiHeThong(heThong(), 'mô hình nào nhiều bảng nhất');

    expect(kq?.cau).toContain('Kho vận');
    expect(kq?.so).toEqual(['9']);
    /*
     * ⚠️ Vế phạm vi là bắt buộc. Danh sách này KHÔNG ở trên màn hình, nên
     * người đọc không có gì để đối chiếu; một câu "cao nhất là Kho vận" trơ
     * trọi đọc ra y như một câu về thứ họ đang nhìn.
     */
    expect(kq?.cau).toContain('trong toàn bộ tổ chức');
    expect(kq?.cau).not.toContain('trên trang này');
  });

  /*
   * Bản tóm tắt không bao giờ được GỌI TÊN ("có bao nhiêu bộ dữ liệu" không
   * nhắc tên nguồn nào), nên nếu thiếu bước so nhãn trên toàn bộ dữ kiện thì
   * đúng câu hỏi đơn giản nhất của cả tính năng lại không trả lời được.
   */
  it('tổng số đếm được, dù câu hỏi không gọi tên nguồn nào', () => {
    const kq = traLoiHeThong(heThong(), 'có bao nhiêu bộ dữ liệu');

    expect(kq?.cau).toContain('12');
    expect(kq?.cau).toContain('không phải trên trang đang mở');
  });

  it('gọi tên một mục thì trả lời về đúng mục đó', () => {
    expect(traLoiHeThong(heThong(), 'mô hình Kho vận có mấy bảng')?.cau).toContain('9');
  });

  it('câu lạ thì chưa hiểu, không đoán', () => {
    expect(traLoiHeThong(heThong(), 'hôm nay trời thế nào')).toBeNull();
  });

  it('chưa kéo được dữ liệu (ví dụ viewer bị 403) thì không trả lời gì', () => {
    expect(traLoiHeThong([], 'mô hình nào nhiều bảng nhất')).toBeNull();
  });

  /*
   * ⚠️ Mỗi nhãn gửi cho mô hình PHẢI chạy ra một câu trả lời. Một nhãn chọn
   * được mà `chay()` trả `null` thì bong bóng "chưa hiểu" nằm lại y nguyên sau
   * khi mô hình đã chọn đúng — trông như mô hình chưa được gọi.
   */
  it('mọi lựa chọn hệ thống đều chạy ra câu trả lời', () => {
    const ds = luaChonHeThong(heThong());

    expect(ds.length).toBeGreaterThan(2);
    for (const lc of ds) {
      expect(lc.chay(), lc.nhan).not.toBeNull();
    }
    expect(ds.map((lc) => lc.nhan)).toContain('Số bộ dữ liệu trong toàn bộ tổ chức');
    expect(ds.some((lc) => lc.nhan.includes('(toàn bộ tổ chức)'))).toBe(true);
  });

  /*
   * Danh sách hệ thống chỉ góp một chục nhãn, không phải sáu trăm: backend lấy
   * 60 nhãn đầu, và dữ kiện của từng bộ dữ liệu sẽ đẩy sạch nhãn của trang
   * người dùng đang nhìn ra khỏi danh sách đó.
   */
  it('không góp dữ kiện của từng mục vào danh sách cho mô hình chọn', () => {
    const nhan = luaChonHeThong(heThong()).map((lc) => lc.nhan);

    expect(nhan).not.toContain('Số bảng trong mô hình Bán hàng');
    expect(nhan.length).toBeLessThan(15);
  });
});
