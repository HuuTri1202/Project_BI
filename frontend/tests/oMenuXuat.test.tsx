import type { ReportDataDto } from '@bi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasBoard } from '../src/features/reports/builder/CanvasBoard';
import { emptyVisual, type VisualDraft } from '../src/features/reports/builder/visual';
import * as xuat from '../src/features/reports/export/xuatMotO';
import { useModelReportPreview } from '../src/features/datamodels/hooks';

/**
 * Menu "⋮" trên đầu mỗi ô trong trình dựng — §10.23.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Nút ✕ cũ xoá ngay khi bấm. Giờ nó nằm trong một menu cùng với ba mục xuất, và
 * hai chỗ hỏng được canh ở đây:
 *
 *   1. Xoá phải vẫn xoá. Một thao tác huỷ hoại bị chuyển chỗ mà không ai kiểm
 *      lại là cách mất nó êm ru nhất.
 *   2. Xuất một ô chưa có số liệu. Menu mở được từ lúc ô còn trống, và để bấm
 *      được thì tệp tải về là một khung trắng — không báo lỗi, không nói gì.
 */

vi.mock('../src/features/datamodels/hooks', () => ({
  useModelReportPreview: vi.fn(),
}));

vi.mock('../src/features/reports/export/xuatMotO', () => ({
  xuatMotO: vi.fn(() => Promise.resolve()),
}));

const SO_LIEU: ReportDataDto = {
  rows: [{ label: 'Furniture', value: 742000 }],
  dimensionLabel: 'Nhóm',
  measureLabel: 'Doanh thu',
  grouped: false,
} as ReportDataDto;

/** Ô đã đủ trường — `blockerOf` trả `null`, nên ô thật sự hỏi số liệu. */
function draft(): VisualDraft {
  return {
    ...emptyVisual({ x: 0, y: 0 }),
    id: 'o1',
    chartType: 'table',
    dimensionId: 5,
    measureId: 10,
  };
}

const onRemove = vi.fn();

function ve(data: ReportDataDto | undefined, tenBaoCao = 'Báo cáo quý IV'): void {
  vi.mocked(useModelReportPreview).mockReturnValue({
    data,
    isError: false,
    error: null,
    isFetching: false,
  } as ReturnType<typeof useModelReportPreview>);

  render(
    <CanvasBoard
      drafts={[draft()]}
      annotations={[]}
      selectedId={null}
      editingId={null}
      modelId={7}
      tenBaoCao={tenBaoCao}
      labelOf={() => 'Doanh thu theo Nhóm'}
      onSelect={vi.fn()}
      onChange={vi.fn()}
      onRemove={onRemove}
      onChangeAnnotation={vi.fn()}
      onRemoveAnnotation={vi.fn()}
      onEditText={vi.fn()}
    />,
  );
}

const moMenu = (): void =>
  fireEvent.click(screen.getByRole('button', { name: 'Thao tác trên ô Doanh thu theo Nhóm' }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('menu thay cho nút ✕', () => {
  it('không còn nút ✕ trần trên đầu ô', () => {
    ve(SO_LIEU);
    expect(screen.queryByRole('button', { name: /^Xoá ô/ })).toBeNull();
  });

  it('menu có ba mục xuất rồi mới tới Xoá ô', () => {
    ve(SO_LIEU);
    moMenu();

    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Xuất ảnh PNG',
      'Xuất tệp PDF',
      'Xuất bảng tính Excel',
      'Xoá ô',
    ]);
  });

  it('nút ⋮ và tay nắm co giãn KHÔNG lọt vào ảnh xuất', () => {
    ve(SO_LIEU);
    const o = screen.getByRole('region', { name: /Ô biểu đồ/ });

    // `chupCacVung` lọc theo đúng thuộc tính này. Thiếu nó thì ảnh một biểu đồ
    // mang theo cái nút menu và cái tay nắm — hai thứ của trình dựng.
    const menu = screen.getByRole('button', { name: /^Thao tác trên ô/ });
    expect(menu.closest('[data-khong-xuat]')).not.toBeNull();
    expect(o.querySelector('.cursor-nwse-resize')).toHaveAttribute('data-khong-xuat');
  });

  it('Xoá ô vẫn xoá', () => {
    ve(SO_LIEU);
    moMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xoá ô' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('xuất một ô', () => {
  it('gửi đi đúng kiểu, đúng tên, đúng số liệu ô đang vẽ, và CHÍNH thẻ của ô', async () => {
    ve(SO_LIEU);
    moMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xuất bảng tính Excel' }));

    await waitFor(() => expect(xuat.xuatMotO).toHaveBeenCalled());
    const [arg] = vi.mocked(xuat.xuatMotO).mock.calls[0] ?? [];
    expect(arg?.kieu).toBe('excel');
    expect(arg?.ten).toBe('Doanh thu theo Nhóm');
    expect(arg?.tenBaoCao).toBe('Báo cáo quý IV');
    expect(arg?.data).toBe(SO_LIEU);
    // Thẻ phải là chính ô đó, không phải cả khung: ảnh sẽ chứa đúng một biểu đồ.
    expect(arg?.el).toBe(screen.getByRole('region', { name: /Ô biểu đồ/ }));
  });

  it('ô chưa có số liệu: mục xuất bị khoá, và nói vì sao', () => {
    ve(undefined);
    moMenu();

    const png = screen.getByRole('menuitem', { name: 'Xuất ảnh PNG' });
    expect(png).toBeDisabled();
    expect(png).toHaveAttribute('title', 'Biểu đồ chưa có số liệu để xuất.');
    // Xoá thì vẫn xoá được — ô trống là thứ người ta muốn xoá nhất.
    expect(screen.getByRole('menuitem', { name: 'Xoá ô' })).toBeEnabled();
  });

  it('lỗi khi xuất thì nói ra chứ không im lặng', async () => {
    const { LoiXuat } = await import('../src/features/reports/export/chupBaoCao');
    vi.mocked(xuat.xuatMotO).mockRejectedValueOnce(new LoiXuat('Báo cáo vẫn chưa vẽ xong.'));
    ve(SO_LIEU);
    moMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xuất ảnh PNG' }));

    const bao = await screen.findByRole('alert');
    expect(bao.textContent).toContain('Chưa xuất được biểu đồ');
    expect(bao.textContent).toContain('Báo cáo vẫn chưa vẽ xong.');

    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lỗi ngoài dự kiến: câu chung cho người dùng, chi tiết vào console', async () => {
    const loi = new TypeError('domToCanvas failed');
    vi.mocked(xuat.xuatMotO).mockRejectedValueOnce(loi);
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {});
    ve(SO_LIEU);
    moMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xuất tệp PDF' }));

    const bao = await screen.findByRole('alert');
    expect(bao.textContent).toContain('Không xuất được biểu đồ');
    expect(bao.textContent).not.toContain('domToCanvas');
    expect(console_).toHaveBeenCalledWith(loi);
    console_.mockRestore();
  });
});
