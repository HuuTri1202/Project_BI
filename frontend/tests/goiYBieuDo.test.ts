import type { ExplorerFieldDto, ExplorerFieldsDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { cauGoiY, goiYBieuDo } from '../src/features/chat/goiYBieuDo';

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

  it('KHÔNG có chữ ý định thì không gợi ý — đó là một câu hỏi SỐ LIỆU', () => {
    /*
     * "Doanh thu theo khu vực" một mình là câu hỏi số liệu hợp lệ, và trang này
     * trả lời được nó bằng ô đang chọn hoặc bằng một truy vấn mới. Chen hướng
     * dẫn vào trước là cướp mất câu trả lời thật.
     */
    expect(goiYBieuDo(MO_HINH, 'doanh thu theo khu vực')).toBeNull();
    expect(goiYBieuDo(MO_HINH, 'doanh thu theo khu vực là bao nhiêu')).toBeNull();
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
