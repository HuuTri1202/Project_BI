import type { ExplorerFieldDto, ExplorerFilterDto } from '@bi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoLoc } from '../src/features/reports/builder/BoLoc';

/**
 * Ô soạn điều kiện lọc của một biểu đồ — §B1.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Hai thứ, và cả hai đều là cách một điều kiện lọc có thể IM LẶNG không lọc gì:
 *
 *   1. `set`/`notSet` còn sót giá trị -> backend từ chối cả lần lưu, và người
 *      dùng chỉ thấy một câu 400 sau khi đã dựng xong cả báo cáo.
 *   2. Cột NGÀY nhập bằng ô chữ -> người Việt gõ "01/10/2026", Cube so với
 *      chuỗi ISO, không dòng nào khớp. Biểu đồ trắng, không lỗi, không dấu hiệu.
 */

const CHIEU: ExplorerFieldDto[] = [
  { id: 11, label: 'Chi nhánh', datasetName: 'don-hang', cubeType: 'string' },
  { id: 12, label: 'Ngày bán', datasetName: 'don-hang', cubeType: 'time' },
];

function dung(filters: ExplorerFilterDto[] = []): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  render(<BoLoc filters={filters} dimensions={CHIEU} onChange={onChange} />);
  return { onChange };
}

describe('BoLoc', () => {
  it('chưa có điều kiện nào thì nói rõ ô đang vẽ toàn bộ dữ liệu', () => {
    dung();

    expect(screen.getByText(/đang vẽ toàn bộ dữ liệu/)).toBeInTheDocument();
  });

  it('thêm điều kiện: lấy chiều đầu tiên và phép "bằng"', () => {
    const { onChange } = dung();

    fireEvent.click(screen.getByRole('button', { name: /Thêm điều kiện/ }));

    expect(onChange).toHaveBeenCalledWith([{ dimensionId: 11, operator: 'equals', values: [''] }]);
  });

  it('đổi sang "để trống" thì DỌN giá trị cũ', () => {
    // Còn sót `values` là backend từ chối cả lần lưu — `explorerFilterSchema`
    // đòi `set`/`notSet` không có giá trị.
    const { onChange } = dung([{ dimensionId: 11, operator: 'equals', values: ['Quận 1'] }]);

    fireEvent.change(screen.getByLabelText('Phép so sánh'), { target: { value: 'notSet' } });

    expect(onChange).toHaveBeenCalledWith([{ dimensionId: 11, operator: 'notSet', values: [] }]);
  });

  it('"để trống" thì không còn ô nhập giá trị', () => {
    dung([{ dimensionId: 11, operator: 'notSet', values: [] }]);

    expect(screen.queryByLabelText('Giá trị')).toBeNull();
  });

  /*
   * Ô LỊCH của trình duyệt, không phải ô chữ: nó hiện theo ngôn ngữ máy nhưng
   * trả về đúng ISO, nên cái bẫy "01/10/2026 không khớp dòng nào" không còn chỗ
   * để xảy ra.
   */
  it('chiều THỜI GIAN dùng ô chọn ngày', () => {
    dung([{ dimensionId: 12, operator: 'gte', values: ['2026-10-01'] }]);

    expect(screen.getByLabelText('Giá trị')).toHaveAttribute('type', 'date');
  });

  it('chiều CHỮ dùng ô nhập thường', () => {
    dung([{ dimensionId: 11, operator: 'equals', values: ['Quận 1'] }]);

    expect(screen.getByLabelText('Giá trị')).toHaveAttribute('type', 'text');
  });

  it('bỏ một điều kiện', () => {
    const { onChange } = dung([
      { dimensionId: 11, operator: 'equals', values: ['A'] },
      { dimensionId: 12, operator: 'gte', values: ['2026-10-01'] },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ điều kiện 1' }));

    expect(onChange).toHaveBeenCalledWith([
      { dimensionId: 12, operator: 'gte', values: ['2026-10-01'] },
    ]);
  });

  it('mô hình chưa có chiều nào thì không hiện gì', () => {
    const { container } = render(<BoLoc filters={[]} dimensions={[]} onChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
