import type { ExplorerFieldDto, ReportVisualDto } from '@bi/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { moTaCua } from '../src/features/reports/builder/fieldText';
import { VisualPanel } from '../src/features/reports/builder/VisualPanel';
import {
  assignField,
  emptyVisual,
  fieldLabelsOf,
  fromDto,
  previewConfigOfDraft,
  previewConfigOfDto,
  toDto,
  type VisualDraft,
} from '../src/features/reports/builder/visual';

/**
 * Đổi phép gộp cho riêng một biểu đồ — §10.22.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Tính năng này có ba cách hỏng âm thầm, và cả ba đều không ai thấy khi nhìn
 * màn hình:
 *
 *   1. `measureAgg` không vào KHOÁ CACHE. Khi đó đổi từ Tổng sang Trung bình là
 *      một lần trúng cache: không request, không lỗi, biểu đồ đứng yên — ô chọn
 *      trông như hỏng, mà thật ra là khoá sai.
 *   2. Nhãn không đi theo phép tính. Biểu đồ vẽ trung bình nhưng trục vẫn ghi
 *      "Sales", nên người đọc cộng nhầm một con số trung bình như một con tổng.
 *   3. Đổi thước đo mà giữ lại phép cũ. `avg` hợp lệ với một cột số nhưng vô
 *      nghĩa với thước đo đếm dòng; lần lưu sau nhận 400 cho một thứ người dùng
 *      chưa bao giờ chọn.
 */

const thuocDo = (p: Partial<ExplorerFieldDto> = {}): ExplorerFieldDto =>
  ({
    id: 10,
    label: 'Sales',
    datasetName: 'Global-Superstore · Orders',
    cubeType: 'number',
    agg: 'sum',
    availableAggs: ['sum', 'avg', 'min', 'max'],
    nguon: { kind: 'column', expr: 'Sales' },
    ...p,
  }) as ExplorerFieldDto;

const chieu = (p: Partial<ExplorerFieldDto> = {}): ExplorerFieldDto =>
  ({
    id: 5,
    label: 'Category',
    datasetName: 'Global-Superstore · Orders',
    cubeType: 'string',
    ...p,
  }) as ExplorerFieldDto;

function draftDayDu(p: Partial<VisualDraft> = {}): VisualDraft {
  return { ...emptyVisual({ x: 0, y: 0 }), dimensionId: 5, measureId: 10, ...p };
}

describe('khoá cache — lỗi số 1', () => {
  it('previewConfigOfDraft MANG theo phép gộp', () => {
    const a = previewConfigOfDraft(draftDayDu({ measureAgg: null }));
    const b = previewConfigOfDraft(draftDayDu({ measureAgg: 'avg' }));
    expect(a).not.toEqual(b);
    expect(b?.measureAgg).toBe('avg');
  });

  it('previewConfigOfDto mang theo, và báo cáo CŨ (không có trường) ra null', () => {
    const cu = previewConfigOfDto({ dimensionId: 5, measureId: 10, limit: 20 });
    const moi = previewConfigOfDto({ dimensionId: 5, measureId: 10, limit: 20, measureAgg: 'avg' });
    expect(cu.measureAgg).toBeNull();
    expect(moi.measureAgg).toBe('avg');
  });

  it('ô đang soạn và ô đã lưu quy về CÙNG một khoá', () => {
    // Trang xem dựng khoá từ DTO, trình dựng dựng từ draft. Lệch nhau thì trang
    // xem không dùng lại được số mà trình dựng vừa tính.
    const draft = draftDayDu({ measureAgg: 'avg' });
    const dto = toDto(draft) as ReportVisualDto;
    expect(previewConfigOfDraft(draft)).toEqual(previewConfigOfDto(dto.config));
  });
});

describe('lưu rồi mở lại', () => {
  it('phép gộp sống sót qua toDto -> fromDto', () => {
    const draft = draftDayDu({ measureAgg: 'avg' });
    const dto = toDto(draft) as ReportVisualDto;
    expect(dto.config.measureAgg).toBe('avg');
    expect(fromDto(dto).measureAgg).toBe('avg');
  });

  it('báo cáo lưu TRƯỚC tính năng này đọc ra null, không phải undefined', () => {
    const dto = {
      id: 'v1',
      chartType: 'bar',
      config: { dimensionId: 5, measureId: 10, limit: 20 },
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    } as ReportVisualDto;
    expect(fromDto(dto).measureAgg).toBeNull();
  });
});

describe('nhãn đi theo phép tính — lỗi số 2', () => {
  it('gắn hậu tố ĐÚNG như backend gắn khi có đổi phép', () => {
    const l = fieldLabelsOf(draftDayDu({ measureAgg: 'avg' }), [chieu()], [thuocDo()]);
    expect(l.measure).toBe('Sales (Trung bình)');
  });

  it('KHÔNG gắn hậu tố khi chọn lại đúng phép mô hình đang khai', () => {
    // Backend coi đó là "không đổi" nên không gắn gì; gắn ở đây là hai màn hình
    // nói hai tên cho cùng một ô.
    const l = fieldLabelsOf(draftDayDu({ measureAgg: 'sum' }), [chieu()], [thuocDo()]);
    expect(l.measure).toBe('Sales');
  });

  it('không chọn gì thì nhãn nguyên như cũ', () => {
    const l = fieldLabelsOf(draftDayDu(), [chieu()], [thuocDo()]);
    expect(l.measure).toBe('Sales');
  });

  it('câu mô tả dưới ô Giá trị đọc theo phép đang chọn', () => {
    expect(moTaCua(thuocDo())).toBe('Tổng của Sales');
    expect(moTaCua(thuocDo(), 'avg')).toBe('Trung bình của Sales');
    expect(moTaCua(thuocDo(), null)).toBe('Tổng của Sales');
  });
});

describe('đổi thước đo — lỗi số 3', () => {
  it('thả thước đo khác vào thì XOÁ phép gộp cũ', () => {
    const patch = assignField(draftDayDu({ measureAgg: 'avg' }), 'measure', {
      kind: 'measure',
      id: 99,
    });
    expect(patch).toEqual({ measureId: 99, measureAgg: null });
  });
});

describe('bộ chọn trên màn hình', () => {
  const ve = (draft: VisualDraft, onChange = vi.fn()) => {
    render(
      <VisualPanel
        draft={draft}
        dimensions={[chieu()]}
        measures={[thuocDo()]}
        dragging={null}
        onChange={onChange}
      />,
    );
    return onChange;
  };

  it('hiện đủ các phép mà thước đo nhận, và đang chọn phép của mô hình', () => {
    ve(draftDayDu());
    const o = screen.getByLabelText('Phép tính cho Sales') as HTMLSelectElement;
    expect([...o.options].map((x) => x.textContent)).toEqual([
      'Tổng',
      'Trung bình',
      'Nhỏ nhất',
      'Lớn nhất',
    ]);
    expect(o.value).toBe('sum');
  });

  it('chọn một phép khác thì báo lên trên', async () => {
    const onChange = ve(draftDayDu());
    await userEvent.selectOptions(screen.getByLabelText('Phép tính cho Sales'), 'avg');
    expect(onChange).toHaveBeenCalledWith({ measureAgg: 'avg' });
  });

  it('chọn lại đúng phép của mô hình thì GỠ hẳn, không lưu giá trị trùng', async () => {
    const onChange = ve(draftDayDu({ measureAgg: 'avg' }));
    await userEvent.selectOptions(screen.getByLabelText('Phép tính cho Sales'), 'sum');
    expect(onChange).toHaveBeenCalledWith({ measureAgg: null });
  });

  it('câu mô tả đổi theo phép đang chọn', () => {
    ve(draftDayDu({ measureAgg: 'avg' }));
    expect(screen.getByText('Trung bình của Sales')).toBeInTheDocument();
  });

  it('thước đo đã gộp sẵn (đếm dòng, công thức) KHÔNG hiện ô chọn', () => {
    render(
      <VisualPanel
        draft={draftDayDu({ measureId: 11 })}
        dimensions={[chieu()]}
        measures={[
          thuocDo({
            id: 11,
            label: 'Số dòng',
            agg: 'count',
            availableAggs: [],
            nguon: { kind: 'rows', expr: null },
          }),
        ]}
        dragging={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Phép tính cho/)).not.toBeInTheDocument();
  });

  it('ô Giá trị còn trống thì chưa có gì để chọn', () => {
    ve(draftDayDu({ measureId: null }));
    expect(screen.queryByLabelText(/Phép tính cho/)).not.toBeInTheDocument();
  });
});
