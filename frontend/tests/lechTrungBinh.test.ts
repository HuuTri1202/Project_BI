import type { ExplorerResultDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { doLech } from '../src/pages/tenant/datamodel/lechTrungBinh';

/**
 * Phát hiện trung bình bị kéo lệch.
 *
 * Đáng viết test vì hai lý do, và cả hai đều là loại lỗi đọc code thấy đúng:
 *
 *   1. Việc ghép dòng phải theo GIÁ TRỊ CHIỀU. `explorer.ts` sắp xếp theo thước
 *      đo đầu tiên giảm dần, nên kết quả trung vị về theo một thứ tự khác kết
 *      quả trung bình. Ghép theo chỉ số vẫn chạy, vẫn ra số, chỉ là so nhầm
 *      nhóm này với nhóm kia.
 *   2. Khối cảnh báo chỉ có giá trị nếu nó IM khi không có gì để nói. Một cảnh
 *      báo hiện quá tay là thứ người dùng học cách phớt lờ trong ba ngày, và
 *      sau đó nó không còn cảnh báo được gì nữa.
 */

const chieu = (id: number, label: string): ExplorerResultDto['columns'][number] => ({
  id,
  label,
  kind: 'dimension',
});

const thuocDo = (id: number, label: string): ExplorerResultDto['columns'][number] => ({
  id,
  label,
  kind: 'measure',
});

const kq = (
  columns: ExplorerResultDto['columns'],
  rows: (string | number | null)[][],
): ExplorerResultDto => ({ columns, rows, truncated: false });

/** Một chiều "Ngành" và một thước đo id 7. */
const cot = [chieu(1, 'Ngành'), thuocDo(7, 'Lợi nhuận')];
const chiThuocDo7 = new Set([7]);

describe('doLech', () => {
  it('ghép dòng theo GIÁ TRỊ CHIỀU, không theo chỉ số dòng', () => {
    // Trung bình giảm dần cho A trước B; trung vị giảm dần cho B trước A. Ghép
    // theo chỉ số sẽ so A với B và kết luận sai cả nhóm lẫn hai con số.
    const tb = kq(cot, [
      ['A', 100],
      ['B', 90],
    ]);
    const tv = kq(cot, [
      ['B', 50],
      ['A', 10],
    ]);

    const out = doLech(tb, tv, chiThuocDo7);

    expect(out).not.toBeNull();
    expect(out?.nhom).toBe('A');
    expect(out?.trungBinh).toBe(100);
    expect(out?.trungVi).toBe(10);
  });

  it('dữ liệu đều thì IM — đây là đường thường gặp nhất', () => {
    const tb = kq(cot, [
      ['A', 100],
      ['B', 80],
    ]);
    // Lệch 10% và 12,5%, đều dưới ngưỡng 50%.
    const tv = kq(cot, [
      ['A', 90],
      ['B', 71],
    ]);

    expect(doLech(tb, tv, chiThuocDo7)).toBeNull();
  });

  it('một nhóm lệch giữa bốn nhóm thì IM — đó là dữ liệu bình thường', () => {
    const tb = kq(cot, [
      ['A', 500],
      ['B', 100],
      ['C', 100],
      ['D', 100],
    ]);
    const tv = kq(cot, [
      ['A', 10],
      ['B', 98],
      ['C', 99],
      ['D', 100],
    ]);

    expect(doLech(tb, tv, chiThuocDo7)).toBeNull();
  });

  it('quá nửa số nhóm lệch thì NÓI', () => {
    const tb = kq(cot, [
      ['A', 500],
      ['B', 500],
      ['C', 100],
      ['D', 100],
    ]);
    const tv = kq(cot, [
      ['A', 10],
      ['B', 20],
      ['C', 99],
      ['D', 100],
    ]);

    const out = doLech(tb, tv, chiThuocDo7);

    expect(out?.soNhomLech).toBe(2);
    expect(out?.tongNhom).toBe(4);
    // Nhóm lệch NẶNG nhất: A lệch 49 lần, B lệch 24 lần.
    expect(out?.nhom).toBe('A');
  });

  it('truy vấn không gộp chiều nào thì nhóm là null', () => {
    const chiThuocDo = [thuocDo(7, 'Lợi nhuận')];
    const out = doLech(kq(chiThuocDo, [[28.61]]), kq(chiThuocDo, [[9.24]]), chiThuocDo7);

    expect(out?.nhom).toBeNull();
    expect(out?.trungBinh).toBe(28.61);
    expect(out?.trungVi).toBe(9.24);
    expect(out?.tongNhom).toBe(1);
  });

  it('Cube trả số dưới dạng CHUỖI — vẫn phải so được', () => {
    const out = doLech(kq(cot, [['A', '100']]), kq(cot, [['A', '10']]), chiThuocDo7);

    expect(out?.trungBinh).toBe(100);
    expect(out?.trungVi).toBe(10);
  });

  it('trung vị bằng 0 mà trung bình khác 0 là lệch tuyệt đối, không được bỏ qua', () => {
    // Không lập được tỷ lệ ở đây, nhưng đây đúng là ca lệch nặng nhất có thể:
    // quá nửa số dòng bằng 0 mà trung bình vẫn dương.
    const out = doLech(kq(cot, [['A', 5]]), kq(cot, [['A', 0]]), chiThuocDo7);

    expect(out?.trungVi).toBe(0);
  });

  it('cả hai đều bằng 0 thì không lệch', () => {
    expect(doLech(kq(cot, [['A', 0]]), kq(cot, [['A', 0]]), chiThuocDo7)).toBeNull();
  });

  it('thước đo không nằm trong lượt đối chứng thì không xét', () => {
    // Người dùng đang để thước đo này ở Tổng chứ không phải Trung bình — so nó
    // với trung vị là so hai thứ không liên quan.
    expect(doLech(kq(cot, [['A', 100]]), kq(cot, [['A', 10]]), new Set())).toBeNull();
  });

  it('nhiều thước đo cùng lệch thì chọn theo TỶ LỆ, không theo hiệu tuyệt đối', () => {
    // Doanh thu lệch 1.100.000 nhưng chỉ 55%; Lợi nhuận lệch 21 nhưng tới 233%.
    // Hiệu tuyệt đối của hai đơn vị khác nhau thì không so được với nhau.
    const cots = [chieu(1, 'Ngành'), thuocDo(7, 'Doanh thu'), thuocDo(8, 'Lợi nhuận')];
    const out = doLech(
      kq(cots, [['A', 3_100_000, 30]]),
      kq(cots, [['A', 2_000_000, 9]]),
      new Set([7, 8]),
    );

    expect(out?.label).toBe('Lợi nhuận');
  });

  it('dòng không có nhóm tương ứng ở kết quả kia thì bỏ qua, không đếm', () => {
    const tb = kq(cot, [
      ['A', 100],
      ['B', 100],
    ]);
    const tv = kq(cot, [['A', 10]]);

    const out = doLech(tb, tv, chiThuocDo7);

    expect(out?.tongNhom).toBe(1);
    expect(out?.soNhomLech).toBe(1);
  });
});
