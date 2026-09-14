import { COLUMN_ROLE_TERMS, type ExplorerFieldDto } from '@bi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Shelf } from '../src/features/reports/builder/controls';
import { VisualPanel } from '../src/features/reports/builder/VisualPanel';
import { emptyVisual } from '../src/features/reports/builder/visual';

/**
 * Ô thả phải NÓI RA nó nhận loại trường nào, kể cả khi đã có trường bên trong.
 *
 * ─── Ảnh chụp màn hình của người dùng ───────────────────────────────────────
 *
 * Ba ô đã điền: "Trục / Product Name", "Giá trị / Quantity", "Nhóm màu /
 * Category". Không dòng nào nói ô Trục cần một chiều còn ô Giá trị cần một
 * thước đo — câu `hint` có nói, nhưng chính trường vừa thả đã chiếm chỗ nó.
 *
 * Nên hai ca dưới đây kiểm ĐÚNG trạng thái đã điền, không phải trạng thái
 * trống: trạng thái trống chưa bao giờ là chỗ thiếu thông tin.
 */

const TRUONG: ExplorerFieldDto = {
  id: 7,
  label: 'Product Name',
  datasetName: 'Orders',
  cubeType: 'string',
};

function shelf(accepts: 'dimension' | 'measure', label: string): React.ReactElement {
  return (
    <Shelf
      label={label}
      hint="Không được thấy câu này khi ô đã có trường"
      accepts={accepts}
      field={TRUONG}
      dragging={null}
      onAssign={() => {}}
      onClear={() => {}}
    />
  );
}

describe('Shelf — loại trường của ô thả', () => {
  it('ô nhận chiều nói "Dimension", ô nhận thước đo nói "Measure"', () => {
    const { unmount } = render(shelf('dimension', 'Trục'));
    expect(screen.getByText(/^\(Dimension\)$/)).not.toBeNull();
    unmount();

    render(shelf('measure', 'Giá trị'));
    expect(screen.getByText(/^\(Measure\)$/)).not.toBeNull();
  });

  it('đọc từ `accepts`, nên không nói được một đằng mà nhận một nẻo', () => {
    // Chữ trong ngoặc và biến quyết định cú thả có được nhận hay không
    // (`nhanDuoc`) là CÙNG một biến. Ca này khoá điều đó: nhãn cứng — dù chỉ là
    // một prop `kindLabel` truyền từ ngoài — sẽ lệch ngay lần đầu ai đó đổi
    // `accepts` mà quên đổi nhãn, và ô sẽ mời người dùng thả thứ nó từ chối.
    render(shelf('measure', 'Trục'));

    expect(screen.queryByText(new RegExp(COLUMN_ROLE_TERMS.dimension))).toBeNull();
    expect(screen.getByText(new RegExp(COLUMN_ROLE_TERMS.measure))).not.toBeNull();
  });

  it('KHÔNG lấy tiếng Việt của vai trò làm chữ trong ngoặc', () => {
    // "Trục Chiều (Dimension)" là ba từ cho một ý trong một cột hẹp. Ô đã có
    // tên riêng rồi; thứ nó còn thiếu chỉ là loại trường.
    render(shelf('dimension', 'Trục'));

    expect(screen.queryByText(/Chiều/)).toBeNull();
  });
});

/**
 * Cùng chuyện đó, nhưng trên BẢNG CẤU HÌNH THẬT.
 *
 * Ca `Shelf` ở trên kiểm component; ba ca dưới kiểm ba ô mà người dùng thật sự
 * nhìn thấy — kể cả cái tên đổi theo loại biểu đồ ("Trục" thành "Lát cắt" với
 * biểu đồ tròn), thứ mà một ca dựng \`Shelf\` bằng tay sẽ bỏ sót.
 */

const CHIEU: ExplorerFieldDto[] = [
  { id: 1, label: 'Product Name', datasetName: 'Orders', cubeType: 'string' },
  { id: 3, label: 'Category', datasetName: 'Orders', cubeType: 'string' },
];
const THUOC_DO: ExplorerFieldDto[] = [
  { id: 2, label: 'Quantity', datasetName: 'Orders', cubeType: 'number' },
];

function bangCauHinh(chartType: 'bar' | 'pie'): React.ReactElement {
  const draft = {
    ...emptyVisual({ x: 0, y: 0 }),
    chartType,
    dimensionId: 1,
    measureId: 2,
    seriesId: chartType === 'pie' ? null : 3,
  };

  return (
    <VisualPanel
      draft={draft}
      dimensions={CHIEU}
      measures={THUOC_DO}
      dragging={null}
      onChange={() => {}}
    />
  );
}

describe('VisualPanel — cả ba ô thả đều nói loại trường', () => {
  it('ảnh chụp của người dùng: Trục, Giá trị, Nhóm màu đều đã điền', () => {
    render(bangCauHinh('bar'));

    // `getByText` ném lỗi nếu không thấy, nên ba dòng này vừa là kiểm vừa là
    // mô tả đúng cái người dùng đọc được trên màn hình.
    expect(screen.getByText('Trục').parentElement?.textContent).toContain('(Dimension)');
    expect(screen.getByText('Giá trị').parentElement?.textContent).toContain('(Measure)');
    expect(screen.getByText('Nhóm màu').parentElement?.textContent).toContain('(Dimension)');
  });

  it('biểu đồ tròn đổi tên ô thành "Lát cắt" mà vẫn giữ loại trường', () => {
    render(bangCauHinh('pie'));

    expect(screen.getByText('Lát cắt').parentElement?.textContent).toContain('(Dimension)');
    // Ô Nhóm màu của biểu đồ tròn bị KHOÁ, và nó vẫn phải nói mình nhận gì:
    // người dùng cần biết cái ô xám đó là chỗ của chiều, không phải thước đo.
    expect(screen.getByText('Nhóm màu').parentElement?.textContent).toContain('(Dimension)');
  });
});
