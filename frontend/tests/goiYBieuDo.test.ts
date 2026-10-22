import type { ExplorerFieldDto, ExplorerFieldsDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import {
  cauGoiY,
  deXuatBieuDo,
  goiYBieuDo,
  muonVe,
  tenDeXuat,
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
