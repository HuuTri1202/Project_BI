import type { ReportDataDto, ReportDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { duKienNguonBaoCao } from '../src/features/chat/duKienTrang';
import { formatValue } from '../src/features/reports/nhanO';
import type { Nguon } from '../src/features/chat/nguCanh';
import {
  chuanHoa,
  docDieuKien,
  docYDinh,
  luaChonHeThong,
  luaChonTrang,
  moHinhTheoTen,
  nguonMoHo,
  traLoi,
  traLoiBangThoEp,
  traLoiHeThong,
  traLoiTrang,
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

/* ═══ BẢNG DỮ LIỆU THÔ — mấy luật không đo được qua bộ đánh giá ═══════════
 *
 * Bộ đánh giá chạy trên một bảng dựng sẵn, nên nó không đo được mấy CẬN dưới
 * đây — chúng chỉ lộ ra với những bảng có hình dạng đặc biệt. Mỗi ca ở đây
 * dựng đúng một hình dạng như vậy.
 */
describe('Bảng dữ liệu thô: câu hỏi chọn cột', () => {
  const nguon = (cot: string[], dong: (string | number | boolean | null)[][]): Nguon => ({
    ten: 'Bộ dữ liệu',
    duKien: [],
    bangTho: { cot, dong, luuY: 'tính trên 3 dòng xem trước' },
  });

  /*
   * ⚠️ Giá trị NGẮN không được dùng để nhận ra cột.
   *
   * Một mã kho "A" có mặt trong gần như mọi câu tiếng Việt. Nhận cột qua nó là
   * nhóm theo một cột chỉ vì một sự trùng ngẫu nhiên — rồi đưa ra một con số có
   * thật cho một câu hỏi khác.
   */
  it('giá trị ngắn hơn bốn ký tự KHÔNG được dùng để nhận ra cột', () => {
    const n = nguon(
      ['Sản phẩm', 'Mã kho', 'Doanh thu'],
      [
        ['Staples', 'A', 100],
        ['Staples', 'B', 50],
        ['Boston', 'A', 70],
      ],
    );

    /*
     * Câu hỏi KHÔNG gọi tên cột chữ nào, và cũng không gọi giá trị dài nào —
     * đúng cửa mà ngưỡng bốn ký tự đang canh. Chữ "a" thì nằm sẵn trong "cao",
     * "nhất", "bao"; một ngưỡng lỏng sẽ nhận mã kho "A" làm cột nhãn và trả về
     * 170 (tổng kho A) thay vì 150 (tổng của Staples).
     */
    const kq = traLoi(n, 'doanh thu cao nhất là bao nhiêu');

    expect(kq?.cau).toContain('150');
    expect(kq?.cau).not.toContain('170');
  });

  /*
   * ═══ Hai cột do LỚP MÔ HÌNH ép ═════════════════════════════════════════
   *
   * Bảng tiêu đề tiếng Anh, câu hỏi tiếng Việt: phép so từ khoá không có một
   * chữ nào để bám. Hai cột số nên luật "chỉ có một cột đo thì khỏi chọn" cũng
   * không cứu được — đúng hình dạng mà lớp chọn cột sinh ra để lo.
   */
  const ANH = (): Nguon =>
    nguon(
      ['Region', 'City', 'Sales', 'Profit'],
      [
        ['East', 'Boston', 100, 7],
        ['East', 'New York', 50, 30],
        ['West', 'Seattle', 90, 4],
      ],
    );

  it('không ép cột thì câu tiếng Việt KHÔNG có đáp án nào', () => {
    const bt = ANH().bangTho;
    expect(bt && traLoiBangThoEp(bt, 'thành phố nào lời nhất')).toBeNull();
  });

  it('ép đúng hai cột thì tính trên ĐÚNG hai cột đó', () => {
    const bt = ANH().bangTho;
    const kq = bt && traLoiBangThoEp(bt, 'thành phố nào lời nhất', { nhan: 1, do: 3 });

    // New York lời 30 — cao nhất. Boston bán nhiều nhất (100) nhưng không hỏi.
    expect(kq?.cau).toContain('New York');
    expect(kq?.cau).not.toContain('Boston');
  });

  /*
   * ⚠️ Chỉ số ép vẫn bị kiểm lại. Đặt một cột CHỮ vào ô ĐO thì `oThanhSo` trả
   * `null` cho mọi dòng, câu trả lời biến mất im lặng, và nó trông như mô hình
   * bó tay chứ không như một cột đặt nhầm ô.
   */
  it('ép một cột CHỮ vào ô đo thì BỎ phép ép, không dựng bừa', () => {
    const bt = ANH().bangTho;
    // Cột 1 là "City" — chữ, không đo được. Bỏ phép ép thì không còn cột đo
    // nào, và câu hỏi quay về đúng chỗ nó đứng khi chưa ai chọn hộ: `null`.
    expect(bt && traLoiBangThoEp(bt, 'thành phố nào lời nhất', { nhan: null, do: 1 })).toBeNull();
    // Cột 9 không tồn tại — cùng luật, và cột nhãn thì rơi về phép đoán cũ.
    expect(bt && traLoiBangThoEp(bt, 'thành phố nào lời nhất', { nhan: 9, do: 9 })).toBeNull();
  });

  /*
   * ⚠️ Bỏ chỉ số sai phải RƠI VỀ phép so từ khoá, không phải rơi xuống `null`.
   *
   * Khác biệt chỉ lộ ra khi câu hỏi TỰ gọi tên được cột: nhận bừa chỉ số sai
   * thì `oThanhSo` trả `null` cho mọi dòng và câu trả lời biến mất — người
   * dùng mất một đáp án mà khung vốn có sẵn, chỉ vì mô hình chỉ trệch một ô.
   */
  it('chỉ số ép sai thì vẫn còn đường cũ: câu hỏi tự gọi tên cột', () => {
    const bt = nguon(
      ['Sản phẩm', 'Doanh thu', 'Lợi nhuận'],
      [
        ['Staples', 100, 7],
        ['Boston', 50, 30],
      ],
    ).bangTho;

    // Ép cột 0 ("Sản phẩm" — chữ) vào ô ĐO. Bỏ nó đi thì chính câu hỏi chỉ ra
    // cột "Doanh thu", và Staples 100 là cao nhất.
    const kq = bt && traLoiBangThoEp(bt, 'doanh thu cao nhất là bao nhiêu', { nhan: null, do: 0 });

    expect(kq?.cau).toContain('100');
  });

  /** Cột toàn true/false không phải thước đo: cộng nó ra một con số không ai hỏi. */
  it('cột boolean không được coi là cột đo', () => {
    const n = nguon(
      ['Sản phẩm', 'Đã giao'],
      [
        ['Staples', true],
        ['Boston', false],
      ],
    );

    // Không cột đo nào, và câu hỏi không gọi tên cột chữ nào — không tính được gì.
    expect(traLoi(n, 'tổng là bao nhiêu')).toBeNull();
  });

  /*
   * ⚠️ Dấu `.` trong ô thô là dấu THẬP PHÂN, không phải hàng nghìn.
   *
   * `soVi` đọc chuỗi ĐÃ định dạng theo `vi-VN` nên nó hiểu "1.5" là 15. Ô ở đây
   * đến thẳng từ CSDL, nên dùng nhầm là sai mười lần bằng một con số hợp lệ.
   */
  it('ô "1.5" đọc là một phẩy năm, không phải mười lăm', () => {
    const n = nguon(
      ['Sản phẩm', 'Doanh thu'],
      [
        ['Staples', '1.5'],
        ['Boston', '2.5'],
      ],
    );

    const kq = traLoi(n, 'tổng doanh thu là bao nhiêu');
    expect(kq?.cau).toContain('4');
    expect(kq?.cau).not.toContain('40');
  });

  /** Vế điều kiện luôn đi kèm — bảng này là MẪU, không phải toàn bộ. */
  it('mọi câu trả lời tính trên bảng thô đều mang vế điều kiện', () => {
    const n = nguon(
      ['Sản phẩm', 'Doanh thu'],
      [
        ['Staples', 100],
        ['Boston', 50],
      ],
    );

    for (const hoi of ['tổng doanh thu', 'sản phẩm nào doanh thu cao nhất']) {
      expect(traLoi(n, hoi)?.cau, hoi).toContain('xem trước');
    }
  });

  /*
   * BẤM một gợi ý phải ra ĐÚNG câu mà GÕ nhãn đó ra cho.
   *
   * Nhãn gợi ý chính là câu hỏi — xem `phepCuaBangTho`. Hai đường cho hai kết quả
   * khác nhau là người dùng bấm một đằng, gõ ra một nẻo.
   */
  it('bấm gợi ý cho ra đúng câu mà gõ nhãn đó cho ra', () => {
    const n = nguon(
      ['Sản phẩm', 'Doanh thu'],
      [
        ['Staples', 100],
        ['Boston', 50],
      ],
    );

    const ds = luaChonTrang([n], n, '');
    expect(ds.length).toBeGreaterThan(2);
    for (const lc of ds) {
      expect(lc.chay()?.cau, lc.nhan).toBe(traLoi(n, lc.nhan)?.cau);
    }
  });
});

/* ═══ MÔ HÌNH ĐƯỢC GỌI TÊN — cửa vào của đường hỏi truy vấn MỚI ═════════
 *
 * Đây là thứ cho phép đứng ở Kho dữ liệu hay Trang chủ mà vẫn hỏi được một câu
 * số liệu thật. Nó cũng là cửa nguy hiểm nhất: một truy vấn chạy trên SAI mô
 * hình vẫn ra một con số đẹp, không dấu hiệu nào.
 */
describe('Mô hình mà câu hỏi gọi tên', () => {
  const ds: Nguon[] = [
    { ten: 'Tổng quan toàn tổ chức', duKien: [] },
    { ten: 'Bán hàng', duKien: [], moHinhId: 7 },
    { ten: 'Bán hàng 2026', duKien: [], moHinhId: 9 },
    { ten: 'Orders', duKien: [] },
  ];

  it('gọi tên thì ra đúng mô hình đó', () => {
    expect(moHinhTheoTen(ds, 'doanh thu của Bán hàng tháng 3')).toBe(7);
  });

  /*
   * Cùng luật `nguonTheoTen` và `timDong`: "Bán hàng" nằm lọt trong "Bán hàng
   * 2026", nên lấy cái ngắn là chạy truy vấn trên một mô hình khác hẳn.
   */
  it('tên DÀI NHẤT thắng', () => {
    expect(moHinhTheoTen(ds, 'doanh thu của Bán hàng 2026')).toBe(9);
  });

  it('không ai gọi tên thì KHÔNG đoán', () => {
    expect(moHinhTheoTen(ds, 'doanh thu miền bắc tháng 3')).toBeNull();
  });

  it('nguồn không phải mô hình thì không mở đường này', () => {
    expect(moHinhTheoTen(ds, 'Orders có bao nhiêu dòng')).toBeNull();
  });

  /*
   * ⚠️ Ba mô hình cùng tên "Global-Superstore" trong một tổ chức là chuyện có
   * thật — xem `nhanDuyNhat`. Chọn một trong ba bằng cách tung đồng xu rồi chạy
   * một truy vấn trên nó là đúng kiểu sai mà cả cửa này tồn tại để chặn.
   */
  it('hai mô hình TRÙNG TÊN thì bỏ, không chọn bừa', () => {
    const trung: Nguon[] = [
      { ten: 'Global-Superstore', duKien: [], moHinhId: 1 },
      { ten: 'Global-Superstore', duKien: [], moHinhId: 2 },
    ];
    expect(moHinhTheoTen(trung, 'doanh thu của Global-Superstore')).toBeNull();
  });
});

/*
 * TÊN NGUỒN cũng là chữ khung đã thấy.
 *
 * `tuDaBiet` góp tên nguồn, nhãn và giá trị. Nguồn nào cũng nhắc tên mình trong
 * nhãn ("Số dòng của Orders") nên phần tên nguồn trông như thừa — trừ mấy nguồn
 * TÓM TẮT, vốn cố ý KHÔNG để tên mình lọt vào nhãn nào (xem `boTenMuc`). Bỏ nó đi
 * là mọi câu gọi tên một nguồn kiểu đó bị từ chối oan.
 */
describe('Vốn từ của phép kiểm thực thể lạ', () => {
  it('tên nguồn được tính là đã biết, dù không nhãn nào nhắc tới nó', () => {
    const n: Nguon = {
      ten: 'Kho vận Miền Trung',
      duKien: [{ nhan: 'Số bảng đang có', gia: '3' }],
    };

    // "Miền", "Trung" chỉ có trong TÊN nguồn, không có trong nhãn lẫn giá trị.
    expect(traLoiTrang([n], n, 'số bảng đang có của Kho vận Miền Trung')?.cau).toContain('3');
  });

  it('gọi tên một thứ KHÔNG có thì từ chối, dù nhãn trùng đủ từ', () => {
    const n: Nguon = {
      ten: 'Kho vận Miền Trung',
      duKien: [{ nhan: 'Số bảng đang có', gia: '3' }],
    };

    /*
     * Ba chữ "số", "bảng", "đang" thừa sức kéo nhãn trên về đích — nhưng "Miền
     * Đông" không tồn tại, nên con số 3 là câu trả lời cho một câu hỏi khác.
     *
     * ⚠️ "Đông" chứ không phải "Nam": cận bốn ký tự của `nhacThuLa` cố ý cho
     * một tên riêng ba ký tự lọt qua — đánh đổi đã ghi ở đó. Viết ca bằng "Nam"
     * là đo một lời hứa không ai hứa.
     */
    expect(traLoiTrang([n], n, 'số bảng đang có của Kho vận Miền Đông')).toBeNull();
  });
});

/**
 * Khung hỏi NGƯỢC khi không biết người dùng hỏi mục nào — xem `nguonMoHo`.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "nếu trên trang có 2 báo cáo thì làm thế nào để biết người dùng muốn hỏi
 *    báo cáo nào … chatbot hỏi ngược lại user đang muốn hỏi biểu đồ nào"
 *
 * Đây là nhóm ca canh chỗ KHÔNG hỏi lại, nhiều hơn chỗ có hỏi. Một khung bắt
 * xác nhận ở mọi câu thì phiền hơn hẳn một khung đoán sai thỉnh thoảng, và nó
 * sẽ bị tắt đi — lúc đó thì chẳng còn gì bảo vệ ai.
 */
describe('nguonMoHo — hỏi lại khi hai mục cùng trả lời được', () => {
  const bang = (nhan: string, gia: number): ReportDataDto => ({
    rows: [{ label: nhan, value: gia }],
    dimensionLabel: 'Sản phẩm',
    measureLabel: 'Doanh thu',
    grouped: false,
  });

  const hai = (): Nguon[] => [
    { ten: 'Doanh thu theo Sản phẩm', duKien: [], bang: bang('Bánh', 100) },
    { ten: 'Chi phí theo Sản phẩm', duKien: [], bang: bang('Kẹo', 900) },
  ];

  it('hai biểu đồ cùng trả lời được, hai con số khác nhau -> hỏi lại', () => {
    expect(nguonMoHo(hai(), 'cao nhất là gì')).toEqual([0, 1]);
  });

  it('câu GỌI TÊN một biểu đồ thì không hỏi lại', () => {
    // Người dùng đã nói rõ. Hỏi lại ở đây là bắt họ nói lại thứ vừa nói.
    expect(nguonMoHo(hai(), 'cao nhất trong Chi phí theo Sản phẩm')).toBeNull();
  });

  it('chỉ một mục trả lời được thì không hỏi lại', () => {
    const mot: Nguon[] = [
      { ten: 'Doanh thu theo Sản phẩm', duKien: [], bang: bang('Bánh', 100) },
      { ten: 'Ghi chú', duKien: [{ nhan: 'Người tạo', gia: 'Thái' }] },
    ];
    expect(nguonMoHo(mot, 'cao nhất là gì')).toBeNull();
  });

  it('vẫn hỏi lại khi chip đang chọn KHÔNG phải một trong hai ứng viên', () => {
    /*
     * Bản đầu đòi chip phải trả lời được, với lý do "chưa có câu trả lời im
     * lặng nào để chặn". Sai: lớp mô hình chọn nhãn phía sau sẽ chọn giúp một
     * nhãn trong CẢ trang, nên người dùng vẫn nhận số của một mục họ chưa
     * chọn — chỉ muộn hơn một nhịp và khó lần ra hơn.
     */
    const lech: Nguon[] = [
      { ten: 'Ghi chú', duKien: [{ nhan: 'Người tạo', gia: 'Thái' }] },
      { ten: 'Doanh thu theo Sản phẩm', duKien: [], bang: bang('Bánh', 100) },
      { ten: 'Chi phí theo Sản phẩm', duKien: [], bang: bang('Kẹo', 900) },
    ];
    expect(nguonMoHo(lech, 'cao nhất là gì')).toEqual([1, 2]);
  });

  it('hai mục cho CÙNG một câu trả lời thì không hỏi lại', () => {
    // Hỏi lại ở đây chỉ bắt người dùng bấm thêm một nhịp để nhận lại đúng câu
    // họ vừa được trả lời.
    const giong: Nguon[] = [
      { ten: 'Biểu đồ A', duKien: [], bang: bang('Bánh', 100) },
      { ten: 'Biểu đồ B', duKien: [], bang: bang('Bánh', 100) },
    ];
    expect(nguonMoHo(giong, 'cao nhất là gì')).toBeNull();
  });

  it('câu hỏi về CẢ danh sách thì không hỏi lại', () => {
    // `soSanhNguon` đã trả lời bằng cả danh sách; hỏi "mục nào" ở đó là hỏi
    // đúng thứ câu hỏi đang hỏi.
    const ds: Nguon[] = [
      { ten: 'Orders', duKien: [{ nhan: 'Số dòng của Orders', gia: '120' }] },
      { ten: 'People', duKien: [{ nhan: 'Số dòng của People', gia: '90' }] },
    ];
    expect(nguonMoHo(ds, 'mục nào nhiều dòng nhất')).toBeNull();
  });

  it('một nguồn thì không có gì để hỏi', () => {
    expect(nguonMoHo([hai()[0]!], 'cao nhất là gì')).toBeNull();
  });
});

/*
 * ═══ Báo cáo này lấy số từ ĐÂU ═════════════════════════════════════════════
 *
 * Lỗi thật, do người dùng thật tìm ra ở lượt đầu tiên sau khi bật sổ ghi câu
 * trượt: hỏi "lấy từ đâu ra đó" trên trang xem báo cáo thì khung nói chưa hiểu.
 * Trang đó khai `duKien: []` nên không lớp nào có gì để bấu víu — phép so từ
 * khoá không có nhãn để so, mô hình không có mục để chọn.
 *
 * Bộ này canh ba chuyện, và chuyện THỨ HAI mới là chuyện sửa được lỗi gốc:
 *
 *   1. Hai dữ kiện dựng đúng từ `ReportDto`, và dòng "bộ dữ liệu" KHÔNG xuất
 *      hiện cho báo cáo dựng trên mô hình.
 *   2. Chúng có mặt trong DANH SÁCH gửi cho mô hình. Đây là thứ thật sự trả
 *      lời "lấy từ đâu ra đó" — nhãn là cụm danh từ nên phép so từ khoá cố ý
 *      không khớp câu đó, việc hiểu nó là việc của lớp mô hình.
 *   3. Gắn vào mọi ô mà không sinh ra hai hệ quả: nhãn lặp trong danh sách, và
 *      câu hỏi ngược "bạn muốn hỏi biểu đồ nào" cho một câu chỉ có một đáp án.
 */
function baoCao(part: Partial<ReportDto> = {}): ReportDto {
  return {
    id: 1,
    workspaceId: 1,
    source: 'datamodel',
    sourceName: 'Bán hàng',
    datasetId: null,
    datasetSource: null,
    datamodelId: 7,
    name: 'Doanh thu 2026',
    chartType: 'bar',
    config: null,
    modelConfig: null,
    canvas: null,
    ...part,
  } as ReportDto;
}

describe('Trang xem báo cáo khai được số liệu lấy từ đâu', () => {
  it('báo cáo trên mô hình: KHÔNG hứa một nguồn cho cả mô hình nhiều bảng', () => {
    const dk = duKienNguonBaoCao(baoCao());

    expect(dk).toHaveLength(1);
    expect(dk[0]?.nhan).toBe('Nguồn số liệu của báo cáo Doanh thu 2026');
    expect(dk[0]?.gia).toBe('Mô hình dữ liệu Bán hàng');
  });

  it('báo cáo trên bộ dữ liệu: nói thêm bộ đó nạp từ tệp hay từ CSDL', () => {
    const dk = duKienNguonBaoCao(
      baoCao({
        source: 'dataset',
        sourceName: 'Đơn hàng Q4',
        datasetId: 3,
        datasetSource: 'file',
        datamodelId: null,
      }),
    );

    expect(dk.map((d) => d.gia)).toEqual(['Bộ dữ liệu Đơn hàng Q4', 'Từ file']);
  });

  /*
   * ⚠️ Ca sửa đúng lỗi gốc. Trước khi sửa, danh sách này chỉ có mấy phép tính
   * trên bảng số ("Customer Name nào có Quantity cao nhất") — mô hình đọc hết
   * rồi trả về 0, hoàn toàn hợp lý, vì không mục nào nói về nguồn gốc cả.
   */
  it('nhãn nguồn gốc có trong danh sách gửi cho mô hình', () => {
    const goc = duKienNguonBaoCao(baoCao());
    const o: Nguon = { ...nguonBieuDo(), duKien: goc };

    const nhan = luaChonTrang([o], o, 'lấy từ đâu ra đó').map((lc) => lc.nhan);

    expect(nhan).toContain('Nguồn số liệu của báo cáo Doanh thu 2026');
  });

  it('khung mười hai ô vẫn chỉ tốn MỘT chỗ trong trần nhãn', () => {
    const goc = duKienNguonBaoCao(baoCao());
    const o = (ten: string): Nguon => ({ ...nguonBieuDo(), ten, duKien: goc });
    const ds = [o('Ô một'), o('Ô hai'), o('Ô ba')];

    const nhan = luaChonTrang(ds, ds[0] as Nguon, 'nguồn').map((lc) => lc.nhan);

    expect(nhan.filter((n) => n === 'Nguồn số liệu của báo cáo Doanh thu 2026')).toHaveLength(1);
  });

  /*
   * Ba ô đều trả lời được câu này, nhưng cả ba trả lời GIỐNG HỆT nhau. Hỏi
   * ngược "bạn muốn hỏi biểu đồ nào" ở đây là bắt người ta chọn giữa ba câu
   * trả lời không khác một chữ.
   */
  /*
   * ⚠️ Ca canh một câu ĐÚNG mà đọc ra NGHĨA KHÁC — xem `luuY` trong
   * `duKienNguonBaoCao`.
   *
   * Dựng lại đúng màn hình đã sinh ra lỗi: báo cáo tên "doanh thu theo name",
   * trên khung có hai ô "doanh thu theo Name" và "Sale price theo Name". Chọn ô
   * thứ hai rồi hỏi nguồn, câu trả lời mở đầu bằng tên gần hệt tên ô KIA — nên
   * nó phải tự nói ra là nó đúng cho cả khung, không riêng ô nào.
   */
  it('nói rõ nguồn đúng cho MỌI ô, vì tên báo cáo trùng được với tên một ô', () => {
    const goc = duKienNguonBaoCao(baoCao({ name: 'doanh thu theo name' }));
    const o: Nguon = { ...nguonBieuDo(), ten: 'Sale price theo Name', duKien: goc };

    const lc = luaChonTrang([o], o, 'lấy từ đâu ra đó').find((x) =>
      x.nhan.startsWith('Nguồn số liệu của báo cáo'),
    );

    expect(lc?.chay().cau).toMatch(/Mọi biểu đồ trong báo cáo này đều lấy số từ đó\.$/);
  });

  it('ba ô cùng đáp án thì KHÔNG hỏi ngược muốn hỏi biểu đồ nào', () => {
    const goc = duKienNguonBaoCao(baoCao());
    const o = (ten: string): Nguon => ({ ...nguonBieuDo(), ten, duKien: goc });
    const ds = [o('Ô một'), o('Ô hai'), o('Ô ba')];

    expect(nguonMoHo(ds, 'nguồn số liệu của báo cáo Doanh thu 2026')).toBeNull();
  });
});

/*
 * ═══ Hỏi về một GIÁ TRỊ CHUỖI, không phải một nhãn trục ════════════════════
 *
 * Trên biểu đồ cột chồng "Số lượng theo Khu vực" tách màu theo "Nhóm hàng",
 * câu "Gia dụng bao nhiêu" không khớp nhãn trục nào — nên trước bản này nó rơi
 * thẳng xuống "chưa hiểu", trong khi "Gia dụng" đang là một mảng màu mà người
 * dùng đang chỉ vào.
 *
 * Hai chốt được canh riêng:
 *
 *   1. Phải cộng qua MỌI nhãn trục, không trả về một Ô. Một ô Gia dụng là 100;
 *      câu hỏi về cả mảng màu thì phải là 302. Trả về 100 là đúng số, sai thứ
 *      được hỏi — và 100 cũng là một con số có thật trên biểu đồ.
 *   2. Nhãn trục xét TRƯỚC tên chuỗi. Đó là hành vi đã có từ trước, và đổi thứ
 *      tự là lặng lẽ đổi câu trả lời của những câu đang đúng.
 */
describe('Giá trị của một CHUỖI trên biểu đồ hai chiều', () => {
  const haiChieu = (): Nguon => ({
    ten: 'Số lượng theo Khu vực',
    duKien: [],
    bang: {
      rows: [
        { label: 'Miền Bắc', series: 'Gia dụng', value: 100 },
        { label: 'Miền Bắc', series: 'Điện tử', value: 80 },
        { label: 'Miền Nam', series: 'Gia dụng', value: 102 },
        { label: 'Miền Nam', series: 'Điện tử', value: 95 },
        { label: 'Miền Trung', series: 'Gia dụng', value: 100 },
        // Chuỗi chỉ có MỘT dòng — để canh vế "cộng qua N" không bật vô cớ.
        { label: 'Miền Bắc', series: 'Sách', value: 7 },
      ],
      dimensionLabel: 'Khu vực',
      measureLabel: 'Số lượng',
      seriesLabel: 'Nhóm hàng',
      grouped: false,
    },
  });

  it('cộng qua MỌI nhãn trục, không trả về một ô', () => {
    const kq = traLoi(haiChieu(), 'Gia dụng bao nhiêu');

    expect(kq?.cau).toContain('302');
    expect(kq?.cau).toContain('cộng qua 3 Khu vực');
    // 100 là một ô Gia dụng có thật — đúng cái con số không được trả về.
    expect(kq?.so).toEqual(['302']);
  });

  it('cộng qua đúng số nhãn mà chuỗi đó có mặt, không phải tổng số nhãn', () => {
    const kq = traLoi(haiChieu(), 'Điện tử bao nhiêu');

    expect(kq?.cau).toContain('175');
    expect(kq?.cau).toContain('cộng qua 2 Khu vực');
  });

  /*
   * Một chuỗi chỉ xuất hiện ở một nhãn thì "cộng qua 1 Khu vực" là một vế
   * không mang thông tin nào — nó chỉ làm câu trả lời dài ra và nghe như vừa
   * có một phép tính xảy ra.
   */
  it('chuỗi chỉ có MỘT dòng thì KHÔNG nói "cộng qua"', () => {
    const kq = traLoi(haiChieu(), 'Sách bao nhiêu');

    expect(kq?.cau).toContain('7');
    expect(kq?.cau).not.toContain('cộng qua');
  });

  it('nhãn trục xét TRƯỚC tên chuỗi', () => {
    const kq = traLoi(haiChieu(), 'Miền Nam bao nhiêu');

    // 197 = tổng của Miền Nam, không phải tổng của một nhóm hàng nào.
    expect(kq?.cau).toContain('Miền Nam');
    expect(kq?.cau).toContain('197');
  });

  it('không gọi tên nhãn lẫn chuỗi nào thì vẫn CHƯA HIỂU', () => {
    expect(traLoi(haiChieu(), 'thời tiết bao nhiêu')).toBeNull();
  });
});

/*
 * ⚠️ Tên chuỗi DÀI NHẤT thắng — cùng luật, cùng lý do với `timDong`.
 *
 * "Gia dụng" và "Gia dụng cao cấp" cùng nằm trong câu hỏi về cái thứ hai. Lấy
 * cái ngắn là trả lời về một mảng màu KHÁC, bằng một con số có thật trên đúng
 * biểu đồ đó — nên không có một dấu hiệu nào cho thấy đã nhầm.
 */
describe('Tên chuỗi lồng nhau', () => {
  const long: Nguon = {
    ten: 'Số lượng theo Khu vực',
    duKien: [],
    bang: {
      rows: [
        { label: 'Miền Bắc', series: 'Gia dụng', value: 100 },
        { label: 'Miền Nam', series: 'Gia dụng', value: 100 },
        { label: 'Miền Bắc', series: 'Gia dụng cao cấp', value: 11 },
      ],
      dimensionLabel: 'Khu vực',
      measureLabel: 'Số lượng',
      seriesLabel: 'Nhóm hàng',
      grouped: false,
    },
  };

  it('hỏi tên dài thì KHÔNG trả lời bằng nhóm tên ngắn', () => {
    const kq = traLoi(long, 'Gia dụng cao cấp bao nhiêu');

    expect(kq?.cau).toContain('11');
    expect(kq?.so).toEqual(['11']);
  });

  it('hỏi tên ngắn vẫn ra đúng nhóm tên ngắn', () => {
    expect(traLoi(long, 'Gia dụng bao nhiêu')?.so).toEqual(['200']);
  });
});
