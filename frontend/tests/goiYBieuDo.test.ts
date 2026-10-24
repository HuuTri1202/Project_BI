import type { ExplorerFieldDto, ExplorerFieldsDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import {
  capChoMoHinh,
  capTheoId,
  cauGoiY,
  cauSua,
  deXuatBieuDo,
  docSuaBieuDo,
  duKienODangChon,
  goiYBieuDo,
  goiYMoHo,
  muonVe,
  tachMoHo,
  tenDeXuat,
  tenPhanBiet,
} from '../src/features/chat/goiYBieuDo';

/**
 * "Tui muốn xem doanh thu theo khu vực" — kéo gì vào đâu, chọn biểu đồ nào.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "khi đứng ở trang vẽ biểu đồ … người dùng có thể hỏi chatbot như là tui
 *    muốn xem doanh thu theo khu vực thì chatbot sẽ gợi ý nên kéo dim và
 *    measure nào vào và chọn biểu đồ nào"
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Phần lớn ca ở đây canh chỗ KHÔNG gợi ý. Một hướng dẫn kéo nhầm trường dẫn
 * người dùng dựng ra một biểu đồ ĐÚNG HÌNH, SAI SỐ LIỆU — và đó là thứ không
 * ai kiểm lại, vì nó trông y hệt một biểu đồ đúng.
 */

const truong = (f: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
  ({ id: 1, label: 'X', datasetName: 'Orders', cubeType: 'string', ...f }) as ExplorerFieldDto;

const MO_HINH: ExplorerFieldsDto = {
  dimensions: [
    truong({ id: 1, label: 'Khu vực', datasetName: 'Khách hàng' }),
    truong({ id: 2, label: 'Nhóm hàng', datasetName: 'Sản phẩm' }),
    truong({ id: 3, label: 'Ngày đặt', datasetName: 'Đơn hàng', cubeType: 'time' }),
  ],
  measures: [
    truong({ id: 10, label: 'Doanh thu', datasetName: 'Đơn hàng', cubeType: 'number' }),
    truong({ id: 11, label: 'Số đơn', datasetName: 'Đơn hàng', cubeType: 'number' }),
  ],
};

describe('goiYBieuDo', () => {
  it('"tui muốn xem doanh thu theo khu vực" -> đúng chiều, đúng thước đo, cột', () => {
    const g = goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực');

    expect(g?.chieu.label).toBe('Khu vực');
    expect(g?.thuocDo.label).toBe('Doanh thu');
    // `bar` là mặc định mà chính `CHART_TYPE_HINTS` đã khai.
    expect(g?.loai).toBe('bar');
  });

  it('chiều THỜI GIAN thì chọn biểu đồ đường', () => {
    const g = goiYBieuDo(MO_HINH, 'làm sao để xem số đơn theo ngày đặt');

    expect(g?.chieu.label).toBe('Ngày đặt');
    expect(g?.loai).toBe('line');
  });

  it('hỏi TỈ TRỌNG thì chọn biểu đồ tròn', () => {
    const g = goiYBieuDo(MO_HINH, 'tui muốn xem tỉ trọng doanh thu theo nhóm hàng');

    expect(g?.chieu.label).toBe('Nhóm hàng');
    expect(g?.loai).toBe('pie');
  });

  it('KHỚP được cả khi câu không có chữ ý định nào', () => {
    /*
     * Hợp đồng đã đổi, có chủ ý. Bản đầu gộp "câu này xin biểu đồ không" vào
     * chính phép khớp, và 8/30 ca trượt hẳn chỉ vì cách nói nằm ngoài một danh
     * sách viết tay. Giờ hàm này chỉ trả lời MỘT câu: "câu này gọi tên cặp
     * trường nào".
     */
    expect(goiYBieuDo(MO_HINH, 'doanh thu theo khu vực')?.chieu.label).toBe('Khu vực');
  });

  it('`muonVe` mới là thứ phân biệt "xin biểu đồ" với "xin con số"', () => {
    /*
     * Và panel dùng nó để xếp THỨ TỰ, không phải để chặn: có chữ ý định thì
     * đường vẽ đi trước, không có thì nó vẫn được thử — sau khi đường số liệu
     * đã trượt. Nhờ vậy thiếu một cách nói trong danh sách chỉ đổi thứ tự chứ
     * không mất đường.
     */
    expect(muonVe('tui muốn xem doanh thu theo khu vực')).toBe(true);
    expect(muonVe('vẽ biểu đồ doanh thu theo khu vực')).toBe(true);
    expect(muonVe('doanh thu theo khu vực là bao nhiêu')).toBe(false);
  });

  it('không trường nào khớp thì không gợi ý', () => {
    expect(goiYBieuDo(MO_HINH, 'tui muốn xem tồn kho theo nhà cung cấp')).toBeNull();
  });

  it('HOÀ điểm thì bỏ, không bẻ hoà', () => {
    // Câu hỏi không đủ để phân biệt hai thước đo — và đoán bừa ở đây là dẫn
    // người dùng dựng một biểu đồ đúng hình, sai số liệu.
    const hoa: ExplorerFieldsDto = {
      dimensions: MO_HINH.dimensions,
      measures: [
        truong({ id: 10, label: 'Doanh thu gộp', cubeType: 'number' }),
        truong({ id: 11, label: 'Doanh thu thuần', cubeType: 'number' }),
      ],
    };
    expect(goiYBieuDo(hoa, 'tui muốn xem doanh thu theo khu vực')).toBeNull();
  });

  it('chữ của CÂU HỎI không được chấm điểm như chữ của dữ liệu', () => {
    /*
     * Nguy nhất ở nhánh KHÔNG có chữ "theo": ở đó cả câu — kể cả "vẽ", "biểu
     * đồ" — được chấm lên cả hai danh sách. Một chiều tên "Loại biểu đồ" sẽ ăn
     * hai điểm từ chính mấy chữ người dùng dùng để RA LỆNH, hoà với "Khu vực",
     * và hoà thì mất luôn lời gợi ý.
     */
    const bay: ExplorerFieldsDto = {
      dimensions: [truong({ id: 1, label: 'Loại biểu đồ' }), truong({ id: 2, label: 'Khu vực' })],
      measures: MO_HINH.measures,
    };
    expect(goiYBieuDo(bay, 'vẽ biểu đồ khu vực và doanh thu')?.chieu.label).toBe('Khu vực');
  });

  it('không có chữ "theo" thì vẫn chấm được trên cả câu', () => {
    const g = goiYBieuDo(MO_HINH, 'vẽ biểu đồ khu vực và doanh thu');
    expect(g?.chieu.label).toBe('Khu vực');
    expect(g?.thuocDo.label).toBe('Doanh thu');
  });
});

describe('cauGoiY', () => {
  it('gọi tên ô ĐÚNG như trên màn hình, và kèm cả bảng chứa trường', () => {
    const g = goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực');
    const kq = cauGoiY(g!);

    // Tên ô mượn `CHART_SHELF_LABELS` — viết cứng "ô Trục" là chỉ người dùng đi
    // tìm một cái ô không tồn tại.
    expect(kq.cau).toContain('ô Chiều dữ liệu');
    expect(kq.cau).toContain('ô Giá trị');
    expect(kq.cau).toContain('Biểu đồ cột');
    // Cột trường gom theo bảng, nên không nói bảng là bắt họ tự dò.
    expect(kq.cau).toContain('bảng Khách hàng');
  });

  it('TÊN TRƯỜNG nằm trong `so` — lớp diễn đạt không được làm nó biến mất', () => {
    /*
     * `so` ở đây không mang con số nào. Luật đối chiếu bên backend chỉ hỏi "mọi
     * chuỗi trong `so` còn nguyên không", nên cùng cơ chế ấy canh được tên
     * trường: mô hình viết lại cho mượt thì được, đổi "Doanh thu" thành "doanh
     * số" thì câu bị bỏ. Một hướng dẫn gọi sai tên trường thì người dùng tìm cả
     * buổi không thấy nó trong cột.
     */
    const kq = cauGoiY(goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực')!);
    expect(kq.so).toContain('Khu vực');
    expect(kq.so).toContain('Doanh thu');
    expect(kq.so).toContain('Biểu đồ cột');
  });
});

/**
 * ĐỀ XUẤT SẴN — không gian đầu ra đóng.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "có cách nào tốt hơn để người dùng muốn xem dữ liệu gì thì chatbot có thể
 *    đề xuất ngay, chứ ko dựa vào chat bằng câu chữ … vì nó rất rộng"
 *
 * Đúng. Câu nói ra được thì vô hạn; biểu đồ mô hình này dựng được thì đếm
 * được. Bộ ca ở đây canh phép xếp hạng, vì một danh sách đề xuất xếp sai thì
 * vẫn bấm được — nó chỉ lặng lẽ bày ra mấy cái không ai cần.
 */
describe('deXuatBieuDo', () => {
  it('THỜI GIAN thắng khi cùng bảng, kể cả khi nó đứng sau', () => {
    /*
     * "Doanh thu theo tháng" gần như luôn là câu người ta hỏi trước, còn
     * "doanh thu theo mã đơn" là một biểu đồ một cột mỗi đơn — đúng cú pháp,
     * vô dụng.
     *
     * Hai chiều cùng bảng nên điểm cùng-bảng hoà, và "Mã đơn" đứng TRƯỚC: ca
     * này chỉ xanh khi vế thời gian thật sự được cộng.
     */
    const cungBang = {
      dimensions: [
        truong({ id: 1, label: 'Mã đơn', datasetName: 'Đơn hàng' }),
        truong({ id: 2, label: 'Ngày đặt', datasetName: 'Đơn hàng', cubeType: 'time' }),
      ],
      measures: [truong({ id: 10, label: 'Doanh thu', datasetName: 'Đơn hàng' })],
    };
    const ds = deXuatBieuDo(cungBang, 10);

    expect(ds[0]?.chieu.label).toBe('Ngày đặt');
    expect(ds[0]?.loai).toBe('line');
  });

  it('CÙNG BẢNG thắng, kể cả khi nó đứng sau trong cột trường', () => {
    /*
     * Cặp cùng bảng không cần quan hệ nào bắc qua nên nó luôn vẽ ra được; cặp
     * bắc qua hai bảng phụ thuộc vào một quan hệ mà danh sách trường không nói
     * gì về nó.
     *
     * "Khu vực" đứng TRƯỚC trong danh sách, nên thứ tự gốc một mình sẽ cho nó
     * thắng — ca này chỉ xanh khi phép cộng điểm thật sự chạy.
     */
    const cheo = {
      dimensions: [
        truong({ id: 1, label: 'Khu vực', datasetName: 'Khách hàng' }),
        truong({ id: 2, label: 'Mã đơn', datasetName: 'Đơn hàng' }),
      ],
      measures: [truong({ id: 10, label: 'Doanh thu', datasetName: 'Đơn hàng' })],
    };

    expect(deXuatBieuDo(cheo, 10)[0]?.chieu.label).toBe('Mã đơn');
  });

  it('tối đa HAI cặp mỗi thước đo', () => {
    /*
     * Không có trần này thì một thước đo có nhiều chiều cùng bảng chiếm sạch
     * danh sách, và người mở khung ra chỉ thấy năm biến thể của một con số.
     */
    const nhieuChieu = {
      dimensions: [
        truong({ id: 1, label: 'A', datasetName: 'Đơn hàng' }),
        truong({ id: 2, label: 'B', datasetName: 'Đơn hàng' }),
        truong({ id: 3, label: 'C', datasetName: 'Đơn hàng' }),
        truong({ id: 4, label: 'D', datasetName: 'Đơn hàng' }),
      ],
      measures: [truong({ id: 10, label: 'Doanh thu', datasetName: 'Đơn hàng' })],
    };

    expect(deXuatBieuDo(nhieuChieu, 10)).toHaveLength(2);
  });

  it('cắt đúng trần đã xin', () => {
    expect(deXuatBieuDo(MO_HINH, 3)).toHaveLength(3);
  });

  it('trang không khai trường thì không có đề xuất nào', () => {
    // Ngoài trình dựng thì không có ô nào để vẽ vào.
    expect(deXuatBieuDo(undefined)).toEqual([]);
  });

  it('tên đề xuất ĐÚNG công thức tiêu đề ô sẽ mang sau khi vẽ', () => {
    // Lệch một chữ là người dùng bấm xong nhìn lên thấy ô tên khác, rồi phải
    // tự đoán có phải cái mình vừa bấm không. Cùng công thức với `titleOf`.
    const g = goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực');
    expect(tenDeXuat(g!)).toBe('Doanh thu theo Khu vực');
  });
});

describe('loại biểu đồ người dùng GỌI TÊN', () => {
  it('gọi tên thì họ thắng, kể cả khi chiều là THỜI GIAN', () => {
    // Họ đang nhìn màn hình và đã nói ra; vẽ loại khác là bỏ ngoài tai.
    const g = goiYBieuDo(MO_HINH, 'vẽ biểu đồ cột doanh thu theo ngày đặt');
    expect(g?.chieu.label).toBe('Ngày đặt');
    expect(g?.loai).toBe('bar');
  });

  it('"dạng …" và "kiểu …" cũng tính', () => {
    expect(goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực dạng tròn')?.loai).toBe('pie');
    expect(goiYBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực kiểu thanh ngang')?.loai).toBe(
      'hbar',
    );
  });

  it('⚠️ "theo MIỀN" KHÔNG phải lệnh vẽ biểu đồ miền', () => {
    /*
     * Cái bẫy đắt nhất của tính năng này. "Biểu đồ miền" là `area`, mà "miền"
     * một mình lại là cách người Việt gọi vùng địa lý — và "doanh thu theo
     * miền" là một trong những câu hay gặp nhất.
     *
     * Nhận "miền" trần thì một câu hỏi về vùng biến thành một lệnh đổi loại
     * biểu đồ: im lặng, đúng kiểu dữ liệu, không có gì báo. Cùng lý do với
     * "cột" (tên cột), "đường" (tên đường phố), "bảng" (tên bảng).
     */
    const coMien: ExplorerFieldsDto = {
      dimensions: [truong({ id: 1, label: 'Miền', datasetName: 'Khách hàng' })],
      measures: MO_HINH.measures,
    };
    const g = goiYBieuDo(coMien, 'tui muốn xem doanh thu theo miền');

    expect(g?.chieu.label).toBe('Miền');
    expect(g?.loai).toBe('bar');
  });

  it('gọi tên HAI loại thì không loại nào được chọn', () => {
    // Cùng luật nhường-khi-hoà với phép chấm điểm trường.
    // CỐ Ý không dùng cặp có "cột": `bar` cũng là loại mặc định, nên một ca như
    // vậy xanh cả khi luật hoà bị bỏ — nó không đo được gì.
    const g = goiYBieuDo(MO_HINH, 'vẽ biểu đồ đường hay biểu đồ tròn doanh thu theo khu vực');
    expect(g?.loai).toBe('bar');
  });
});

describe('goiYMoHo — hoà điểm thì hỏi lại, đừng im', () => {
  const haiDoanhThu: ExplorerFieldsDto = {
    dimensions: MO_HINH.dimensions,
    measures: [
      truong({ id: 10, label: 'Doanh thu gộp', cubeType: 'number' }),
      truong({ id: 11, label: 'Doanh thu thuần', cubeType: 'number' }),
    ],
  };

  it('một bên hoà thì trả về đúng mấy cặp ứng viên', () => {
    /*
     * Khung đã hiểu gần hết câu — nó biết chiều là "Khu vực", chỉ không biết
     * thước đo nào trong hai cái. Trả `null` ở đó là ném đi toàn bộ phần đã
     * hiểu để hỏi lại từ đầu.
     */
    const ds = goiYMoHo(haiDoanhThu, 'tui muốn xem doanh thu theo khu vực');

    expect(ds).toHaveLength(2);
    expect(ds.every((g) => g.chieu.label === 'Khu vực')).toBe(true);
    expect(ds.map((g) => g.thuocDo.label)).toEqual(['Doanh thu gộp', 'Doanh thu thuần']);
  });

  it('KHÔNG mơ hồ thì không hỏi gì', () => {
    expect(goiYMoHo(MO_HINH, 'tui muốn xem doanh thu theo khu vực')).toEqual([]);
  });

  it('CẢ HAI bên cùng hoà thì thôi — tích hai danh sách là một mớ vô nghĩa', () => {
    // Bày ra một màn hình lựa chọn mà phần lớn chẳng liên quan tới câu hỏi thì
    // còn tệ hơn nói thẳng là chưa hiểu.
    const caHai: ExplorerFieldsDto = {
      dimensions: [
        truong({ id: 1, label: 'Khu vực giao' }),
        truong({ id: 2, label: 'Khu vực bán' }),
      ],
      measures: haiDoanhThu.measures,
    };
    expect(goiYMoHo(caHai, 'tui muốn xem doanh thu theo khu vực')).toEqual([]);
  });

  it('không trường nào khớp thì cũng không hỏi', () => {
    expect(goiYMoHo(MO_HINH, 'tui muốn xem tồn kho theo nhà cung cấp')).toEqual([]);
  });
});

describe('điền hộ chiều mà người dùng không nói ra', () => {
  it('"theo tháng" -> chiều thời gian DUY NHẤT của mô hình', () => {
    /*
     * "tháng" là chữ của TA, không phải đoán tên trường của khách: nó nói ra
     * một YÊU CẦU ("chia theo trục thời gian"), còn trường nào đáp ứng thì
     * `cubeType === 'time'` trả lời chắc chắn.
     */
    const g = goiYBieuDo(MO_HINH, 'vẽ biểu đồ doanh thu theo tháng');
    expect(g?.chieu.label).toBe('Ngày đặt');
    expect(g?.loai).toBe('line');
  });

  it('HAI chiều thời gian thì KHÔNG điền — hết chắc chắn là dừng', () => {
    // "theo tháng" không chỉ ra cái nào trong hai, và một hướng dẫn kéo nhầm
    // trường dẫn tới biểu đồ đúng hình sai số liệu.
    const haiNgay: ExplorerFieldsDto = {
      dimensions: [
        truong({ id: 1, label: 'Ngày đặt', cubeType: 'time' }),
        truong({ id: 2, label: 'Ngày giao', cubeType: 'time' }),
      ],
      measures: MO_HINH.measures,
    };
    expect(goiYBieuDo(haiNgay, 'vẽ biểu đồ doanh thu theo tháng')).toBeNull();
  });

  it('chỉ nói thước đo mà đang XIN biểu đồ -> đề nghị chiều hợp nhất', () => {
    // Biểu đồ nào cũng cần một chiều, và khung biết chiều nào hợp nhất với
    // thước đo đó. Im lặng ở đây là câu trả lời tệ nhất.
    expect(goiYBieuDo(MO_HINH, 'vẽ biểu đồ doanh thu')?.chieu.label).toBe('Ngày đặt');
  });

  it('chỉ nói thước đo mà KHÔNG xin biểu đồ -> im, đó là câu hỏi số liệu', () => {
    expect(goiYBieuDo(MO_HINH, 'doanh thu là bao nhiêu')).toBeNull();
  });

  it('khớp được mà HOÀ thì không tự điền — đó là lúc hỏi lại', () => {
    /*
     * Hai chuyện khác hẳn nhau: "không nói gì về chiều" thì điền hộ được, còn
     * "nói mà trúng hai cái" thì phải hỏi. Gộp lại là tự chọn một trong hai
     * thứ người dùng vừa phân vân.
     */
    const hoa: ExplorerFieldsDto = {
      dimensions: [
        truong({ id: 1, label: 'Khu vực giao' }),
        truong({ id: 2, label: 'Khu vực bán' }),
      ],
      measures: MO_HINH.measures,
    };
    expect(goiYBieuDo(hoa, 'vẽ biểu đồ doanh thu theo khu vực')).toBeNull();
    expect(goiYMoHo(hoa, 'vẽ biểu đồ doanh thu theo khu vực')).toHaveLength(2);
  });
});

describe('nhiều chiều thời gian thì hỏi, không điền bừa', () => {
  const haiNgay: ExplorerFieldsDto = {
    dimensions: [
      truong({ id: 1, label: 'Ngày đặt', cubeType: 'time' }),
      truong({ id: 2, label: 'Ngày giao', cubeType: 'time' }),
      truong({ id: 3, label: 'Khu vực', datasetName: 'Khách hàng' }),
    ],
    measures: MO_HINH.measures,
  };

  it('ứng viên là mấy chiều THỜI GIAN, không phải chiều xếp hạng cao nhất', () => {
    // Luật "chỉ nói thước đo thì điền hộ" sẽ lặng lẽ chọn một chiều KHÔNG phải
    // thời gian — tức là bỏ ngoài tai đúng cái người dùng vừa nói.
    const ds = goiYMoHo(haiNgay, 'vẽ biểu đồ doanh thu theo tháng');

    expect(ds.map((g) => g.chieu.label)).toEqual(['Ngày đặt', 'Ngày giao']);
  });
});

/**
 * SỬA biểu đồ đã vẽ — top N, chiều xếp, tách màu.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Đường này GHI, không đọc. Nên kiểu hỏng ở đây khác hẳn mọi chỗ khác của
 * khung: không phải một câu trả lời sai mà là một biểu đồ bị sửa sai, và người
 * dùng chỉ thấy số liệu đổi chứ không thấy lý do. Ba nhánh được canh riêng:
 *
 *   1. Con số TRẦN TRỤI không bao giờ được hiểu thành số nhóm ("doanh thu
 *      2024" mà rút còn 2024 nhóm thì vừa sai vừa treo máy).
 *   2. Không nói về chiều xếp thì KHÔNG được chọn hộ — người xin đổi số nhóm
 *      không xin bẻ thứ tự.
 *   3. Tên chiều trúng hai trường thì HỎI LẠI, đúng luật đang áp cho đường vẽ.
 */
describe('docSuaBieuDo', () => {
  const NGAY_DOI: ExplorerFieldsDto = {
    dimensions: [
      truong({ id: 1, label: 'Ngày đặt', datasetName: 'Đơn hàng', cubeType: 'time' }),
      truong({ id: 2, label: 'Ngày giao', datasetName: 'Đơn hàng', cubeType: 'time' }),
    ],
    measures: [truong({ id: 10, label: 'Doanh thu', cubeType: 'number' })],
  };

  it('"chỉ lấy top 5" -> rút còn 5 nhóm, KHÔNG đụng thứ tự', () => {
    expect(docSuaBieuDo(MO_HINH, 'chỉ lấy top 5')).toEqual({ soNhom: 5 });
  });

  it('"cho tui 10 cái thôi" -> 10 nhóm', () => {
    expect(docSuaBieuDo(MO_HINH, 'cho tui 10 cái thôi')).toEqual({ soNhom: 10 });
  });

  it('"top 5 thấp nhất" -> vừa rút vừa xếp ngược', () => {
    expect(docSuaBieuDo(MO_HINH, 'top 5 thấp nhất')).toEqual({
      soNhom: 5,
      sapXep: 'value-asc',
    });
  });

  /*
   * ⚠️ Ca quan trọng nhất của nhánh số. Một con số trần trụi nằm trong câu
   * KHÔNG phải một yêu cầu đổi số nhóm — câu này hỏi về một năm.
   */
  it('"doanh thu 2024" KHÔNG phải lệnh rút còn 2024 nhóm', () => {
    expect(docSuaBieuDo(MO_HINH, 'doanh thu 2024')).toBeNull();
  });

  it('số vượt trần thì bỏ, không kẹp về trần', () => {
    expect(docSuaBieuDo(MO_HINH, 'top 900')).toBeNull();
  });

  it('nói cả "cao nhất" lẫn "thấp nhất" thì không chọn hộ chiều nào', () => {
    expect(docSuaBieuDo(MO_HINH, 'top 5 cao nhất hay thấp nhất')).toEqual({ soNhom: 5 });
  });

  it('"tách theo nhóm hàng" -> chiều phụ đúng trường', () => {
    expect(docSuaBieuDo(MO_HINH, 'tách theo nhóm hàng')).toEqual({ chieuPhuId: 2 });
  });

  it('"bỏ tách màu đi" -> gỡ chiều phụ', () => {
    expect(docSuaBieuDo(MO_HINH, 'bỏ tách màu đi')).toEqual({ chieuPhuId: null });
  });

  it('tên chiều trúng hai trường thì HỎI LẠI, không bốc một cái', () => {
    expect(docSuaBieuDo(NGAY_DOI, 'tách theo ngày')).toBe('mo-ho');
    expect(tachMoHo(NGAY_DOI, 'tách theo ngày').map((d) => d.label)).toEqual([
      'Ngày đặt',
      'Ngày giao',
    ]);
  });

  it('"tách theo" một thứ không có trường nào -> không sửa gì', () => {
    expect(docSuaBieuDo(MO_HINH, 'tách theo thời tiết')).toBeNull();
  });

  /*
   * Câu hỏi số liệu bình thường phải đi thẳng qua đường này. Một câu "chưa
   * hiểu" ở đây không chỉ mất câu trả lời — nó còn SỬA biểu đồ.
   */
  it('câu hỏi số liệu bình thường không bị nhận nhầm là lệnh sửa', () => {
    expect(docSuaBieuDo(MO_HINH, 'khu vực nào doanh thu cao nhất')).toBeNull();
    expect(docSuaBieuDo(MO_HINH, 'tổng doanh thu là bao nhiêu')).toBeNull();
    expect(docSuaBieuDo(MO_HINH, 'tui muốn xem doanh thu theo khu vực')).toBeNull();
  });
});

describe('cauSua', () => {
  it('kể đúng những gì đã đổi, và nhắc Ctrl+Z', () => {
    const kq = cauSua({ soNhom: 5, sapXep: 'value-asc' }, null);

    expect(kq.cau).toContain('5 nhóm');
    expect(kq.cau).toContain('nhỏ lên lớn');
    expect(kq.cau).toContain('Ctrl+Z');
  });

  /*
   * `so` là thứ backend đối chiếu lại câu mô hình viết ra. Thiếu tên trường ở
   * đây nghĩa là lớp viết lại được phép đổi nó thành một trường khác.
   */
  it('tên chiều và con số nằm trong `so` để lớp viết lại không bẻ được', () => {
    expect(cauSua({ soNhom: 5, chieuPhuId: 2 }, 'Nhóm hàng').so).toEqual(['5', 'Nhóm hàng']);
  });
});

/**
 * Ô đang chọn khai nó đang được đặt thế nào.
 *
 * ─── Lỗ hổng đo được ────────────────────────────────────────────────────────
 *
 * Khung SỬA được số nhóm, thứ tự, chiều tách màu — mà hỏi ngược lại "ô này
 * đang lấy mấy nhóm" thì chịu, vì ô đang chọn khai `duKien: []`. Ghi được mà
 * không đọc được.
 *
 * Nó cũng là thứ làm câu xác nhận của `cauSua` kiểm lại được: khung nói "đã
 * rút còn 5 nhóm", người dùng hỏi "giờ mấy nhóm" và đối chiếu.
 */
describe('duKienODangChon', () => {
  const o = {
    ten: 'Doanh thu theo Khu vực',
    loai: 'bar' as const,
    chieu: 'Khu vực',
    thuocDo: 'Doanh thu',
    chieuPhu: null,
    soNhom: 20,
    sapXep: 'value' as const,
  };

  it('khai loại biểu đồ, số nhóm và thứ tự bằng đúng chữ trên màn hình', () => {
    const d = duKienODangChon(o);

    expect(d).toContainEqual({
      nhan: 'Loại biểu đồ của ô Doanh thu theo Khu vực',
      gia: 'Biểu đồ cột',
    });
    expect(d).toContainEqual({ nhan: 'Số nhóm mỗi trang của ô Doanh thu theo Khu vực', gia: '20' });
    expect(d).toContainEqual({
      nhan: 'Thứ tự nhóm của ô Doanh thu theo Khu vực',
      gia: 'Theo giá trị (lớn → nhỏ)',
    });
  });

  /*
   * ⚠️ "chưa tách màu" LÀ một câu trả lời, không phải một ô trống. Bỏ hẳn dòng
   * này đi thì câu "ô này tách màu theo gì" rơi xuống "chưa hiểu", trong khi
   * khung biết thừa câu trả lời.
   */
  it('chưa tách màu thì vẫn khai, và nói thẳng là chưa chọn', () => {
    expect(duKienODangChon(o)).toContainEqual({
      nhan: 'Trường ở ô Nhóm màu của Doanh thu theo Khu vực',
      gia: 'chưa chọn',
    });
    expect(duKienODangChon({ ...o, chieuPhu: 'Nhóm hàng' })).toContainEqual({
      nhan: 'Trường ở ô Nhóm màu của Doanh thu theo Khu vực',
      gia: 'Nhóm hàng',
    });
  });

  /*
   * ⚠️ Gọi ô bằng ĐÚNG tên ô trên trình dựng ("Trục ngang", "Giá trị"), không
   * gọi "chiều"/"thước đo". Người dùng nhìn thấy chữ nào thì hỏi bằng chữ ấy;
   * khung dùng từ vựng khác là bắt họ dịch, và câu hỏi sẽ không khớp nhãn nào.
   */
  it('ô thứ ba đổi tên theo loại biểu đồ, không chép cứng một cái tên', () => {
    const cot = duKienODangChon(o).map((x) => x.nhan);
    const nhiet = duKienODangChon({ ...o, loai: 'heatmap' }).map((x) => x.nhan);
    const bang = duKienODangChon({ ...o, loai: 'table' }).map((x) => x.nhan);

    expect(cot).toContain('Trường ở ô Nhóm màu của Doanh thu theo Khu vực');
    expect(nhiet).toContain('Trường ở ô Trục Y của Doanh thu theo Khu vực');
    expect(bang).toContain('Trường ở ô Cột nhóm thứ hai của Doanh thu theo Khu vực');
  });

  it('hai ô kéo-thả chính gọi bằng đúng tên trên màn hình', () => {
    const d = duKienODangChon(o);

    expect(d).toContainEqual({
      nhan: 'Trường ở ô Chiều dữ liệu của Doanh thu theo Khu vực',
      gia: 'Khu vực',
    });
    expect(d).toContainEqual({
      nhan: 'Trường ở ô Giá trị của Doanh thu theo Khu vực',
      gia: 'Doanh thu',
    });
  });

  /*
   * Hai ô chính bỏ hẳn dòng khi còn trống, khác ô thứ ba luôn có mặt. Chủ ý:
   * "chưa kéo gì vào Giá trị" là trạng thái DANG DỞ của một ô chưa vẽ được,
   * còn "chưa chọn Nhóm màu" là một lựa chọn hợp lệ của một biểu đồ hoàn chỉnh.
   */
  it('hai ô chính còn trống thì KHÔNG khai một dòng rỗng', () => {
    const nhan = duKienODangChon({ ...o, chieu: null, thuocDo: null }).map((x) => x.nhan);

    expect(nhan).not.toContain('Trường ở ô Chiều dữ liệu của Doanh thu theo Khu vực');
    expect(nhan).not.toContain('Trường ở ô Giá trị của Doanh thu theo Khu vực');
    expect(nhan).toContain('Trường ở ô Nhóm màu của Doanh thu theo Khu vực');
  });
});

/*
 * ═══ Danh sách gửi cho MÔ HÌNH chọn ════════════════════════════════════════
 *
 * Lỗi đo được trên Global-Superstore: "tui muốn xem khu vực có discount như
 * thế nào". Phần dễ khung làm được — "discount" trùng nguyên chữ tên thước đo.
 * Phần khó — "khu vực" là chiều nào — phải để mô hình làm, mà mô hình chỉ chọn
 * được trong danh sách nó NHÌN THẤY. `deXuatBieuDo` cắt ở 20 cặp theo thứ tự
 * `flatMap`, nên hai mươi suất ấy bị thước đo đầu bảng ăn gần hết.
 */
describe('Danh sách cặp gửi cho mô hình xoay quanh thước đo đã gọi tên', () => {
  it('mọi chiều của ĐÚNG thước đo câu hỏi nói tới đều có mặt', () => {
    const cap = capChoMoHinh(MO_HINH, 'tui muốn xem khu vực có số đơn như thế nào');

    const cua = cap.filter((g) => g.thuocDo.label === 'Số đơn').map((g) => g.chieu.label);
    expect(cua).toEqual(MO_HINH.dimensions.map((d) => d.label));
  });

  /*
   * Khớp được một thước đo không có nghĩa là chắc chắn người dùng muốn đúng
   * cái đó — phần đuôi vẫn phải chừa chỗ cho mấy thước đo khác.
   */
  it('thước đo khác vẫn còn chỗ ở phần đuôi', () => {
    const cap = capChoMoHinh(MO_HINH, 'tui muốn xem khu vực có số đơn như thế nào');

    expect(cap.some((g) => g.thuocDo.label !== 'Số đơn')).toBe(true);
  });

  it('không gọi tên được thước đo nào thì rơi về danh sách chung', () => {
    const cap = capChoMoHinh(MO_HINH, 'vẽ cái gì đó đi');

    expect(cap.length).toBeGreaterThan(0);
    expect(new Set(cap.map((g) => g.thuocDo.label)).size).toBeGreaterThan(1);
  });
});

/*
 * ═══ Hai lựa chọn phải PHÂN BIỆT ĐƯỢC ══════════════════════════════════════
 *
 * Lỗi đo được: "tui muốn xem profit theo market" ra câu hỏi ngược kèm hai cái
 * nút đọc y hệt nhau — mô hình có hai bảng cùng mang cột `Market`. Bắt người
 * dùng chọn mà không cho họ cơ sở nào để chọn thì tệ hơn là không hỏi.
 */
describe('Tên đề xuất phân biệt được khi hai cặp trùng tên', () => {
  it('trùng tên thì kèm tên bảng, không trùng thì để nguyên', () => {
    const g = (chieuBang: string, id: number) => ({
      chieu: truong({ id, label: 'Market', datasetName: chieuBang }),
      thuocDo: truong({ id: 99, label: 'Profit', datasetName: 'Orders', cubeType: 'number' }),
      loai: 'bar' as const,
    });
    const khac = {
      chieu: truong({ id: 7, label: 'Khu vực', datasetName: 'Orders' }),
      thuocDo: truong({ id: 99, label: 'Profit', datasetName: 'Orders', cubeType: 'number' }),
      loai: 'bar' as const,
    };

    expect(tenPhanBiet([g('Orders', 1), g('People', 2), khac])).toEqual([
      'Profit theo Market (bảng Orders)',
      'Profit theo Market (bảng People)',
      'Profit theo Khu vực',
    ]);
  });

  /*
   * Hai bảng của CHIỀU giống nhau nốt thì chỗ khác nhau nằm ở thước đo —
   * nếu không, hai dòng lại đọc y hệt, chỉ là dài hơn.
   */
  it('chiều cùng bảng thì phân biệt bằng bảng của thước đo', () => {
    const g = (doBang: string, id: number) => ({
      chieu: truong({ id: 1, label: 'Market', datasetName: 'Orders' }),
      thuocDo: truong({ id, label: 'Profit', datasetName: doBang, cubeType: 'number' }),
      loai: 'bar' as const,
    });

    expect(tenPhanBiet([g('Orders', 50), g('Returns', 51)])).toEqual([
      'Profit theo Market (bảng Orders · thước đo ở Orders)',
      'Profit theo Market (bảng Orders · thước đo ở Returns)',
    ]);
  });
});

/*
 * ═══ Cặp trường do lớp ĐIỀN FORM chọn ══════════════════════════════════════
 *
 * Đường duy nhất hiểu được "thị trường" là "Market": mô hình chọn riêng từng ô
 * nên không gian là `chiều + thước đo`, không phải tích của hai cái.
 */
describe('Dựng đề xuất từ form mô hình vừa điền', () => {
  it('id có thật -> đúng cặp trường, loại biểu đồ đọc từ chính chiều', () => {
    const g = capTheoId(MO_HINH, 3, 10, 'tui muốn xem doanh thu của thị trường');

    expect(g?.chieu.label).toBe('Ngày đặt');
    expect(g?.thuocDo.label).toBe('Doanh thu');
    // Chiều thời gian -> biểu đồ đường, đúng luật `loaiHop` đang dùng.
    expect(g?.loai).toBe('line');
  });

  it('id lạ -> null, không dựng bừa một cặp nào', () => {
    expect(capTheoId(MO_HINH, 999, 10, 'x')).toBeNull();
    expect(capTheoId(MO_HINH, 1, 999, 'x')).toBeNull();
    expect(capTheoId(undefined, 1, 10, 'x')).toBeNull();
    expect(capTheoId(MO_HINH, undefined, 10, 'x')).toBeNull();
  });
});
