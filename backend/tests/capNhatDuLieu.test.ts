import { describe, expect, it } from 'vitest';

import { kiemCapNhat } from '../src/services/dataset/commit';
import { HttpError } from '../src/utils/httpError';

/**
 * Luật của một lần CẬP NHẬT dữ liệu bằng tệp mới — §B2.
 *
 * ═══ Vì sao hai luật này đáng một bộ test riêng ════════════════════════════
 *
 * Chúng là thứ duy nhất đứng giữa "tháng sau có số mới" và "mọi báo cáo hỏng
 * cùng lúc". Cập nhật thay TOÀN BỘ dữ liệu của một bộ đang được mô hình và báo
 * cáo trỏ tới, và nó không có đường lùi: tệp cũ đã bị thay, bảng kho đã bị ghi
 * đè. Một tệp thiếu cột lọt qua đây là một buổi sáng mở báo cáo lên thấy lỗi
 * mà không hiểu vì sao.
 */
describe('kiemCapNhat', () => {
  const CU = ['Mã đơn', 'Ngày bán', 'Chi nhánh', 'Thành tiền'];

  function nem(header: string[][], cotDangCo: string[]): HttpError | null {
    try {
      kiemCapNhat(header, cotDangCo);
      return null;
    } catch (err) {
      return err instanceof HttpError ? err : null;
    }
  }

  it('đủ cột thì cho qua', () => {
    expect(nem([CU], CU)).toBeNull();
  });

  it('THÊM cột thì vẫn cho qua — tháng sau có thêm cột là chuyện thường', () => {
    expect(nem([[...CU, 'Khuyến mãi']], CU)).toBeNull();
  });

  it('THIẾU cột thì chặn, và câu lỗi GỌI TÊN cột đã mất', () => {
    const err = nem([['Mã đơn', 'Ngày bán']], CU);

    expect(err?.status).toBe(400);
    expect(err?.message).toContain('Chi nhánh');
    expect(err?.message).toContain('Thành tiền');
  });

  /*
   * Tệp xuất lại từ Excel rất hay thêm một khoảng trắng cuối tiêu đề. Từ chối
   * cả lần cập nhật vì đúng một ký tự trắng là một câu lỗi không ai hiểu nổi —
   * người dùng nhìn hai cái tên giống hệt nhau và được bảo là chúng khác nhau.
   */
  it('khoảng trắng thừa ở tiêu đề KHÔNG tính là thiếu cột', () => {
    expect(nem([CU.map((c) => ` ${c} `)], CU)).toBeNull();
  });

  /*
   * Lần nhập mới tách N sheet thành N bộ dữ liệu. Ở đây mà tách thì bộ đang có
   * bị thay bằng sheet đầu, còn N-1 bộ lạ xuất hiện trong kho mà không ai xin.
   */
  it('nhiều sheet thì chặn', () => {
    expect(nem([CU, CU], CU)?.status).toBe(400);
  });

  it('không sheet nào cũng chặn', () => {
    expect(nem([], CU)?.status).toBe(400);
  });

  /*
   * Bộ dữ liệu chưa có cột nào (bản ghi dở dang) thì không có gì để mất, nhưng
   * luật MỘT sheet vẫn phải giữ.
   */
  it('chưa có cột nào thì chỉ còn luật một sheet', () => {
    expect(nem([['A']], [])).toBeNull();
    expect(nem([['A'], ['B']], [])?.status).toBe(400);
  });
});
