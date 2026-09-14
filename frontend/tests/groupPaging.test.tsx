import type { ReportDataDto } from '@bi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PageTabs } from '../src/features/reports/PageTabs';
import { ReportChart } from '../src/features/reports/ReportChart';

/**
 * Hai cái nút ‹ › và thanh thẻ trang — §10.12.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "tui muốn nếu dữ liệu quá lớn sẽ có nút bấm qua … để đảm bảo biểu đồ hiển
 *    thị đầy đủ dữ liệu"
 *   "hãy tạo thêm page ở góc trái dưới … nó như là 1 sheet trong excel vậy đó"
 *
 * ⚠️ Mọi ca ở đây dùng `chartType: 'table'`. Không phải để né việc kiểm biểu
 * đồ: `ReportChart` vẽ bảng bằng chính DOM chứ không qua Vega, mà `vega-embed`
 * cần `HTMLCanvasElement.getContext` — thứ jsdom không có. Một ca dựng biểu đồ
 * thật ở đây sẽ đỏ vì môi trường chứ không vì code. Phần spec đã có
 * `chartSpec.test.ts` lo, và hai cái nút thì nằm ngoài spec.
 */

const SO_LIEU = (paging?: { page: number; hasMore: boolean }): ReportDataDto => ({
  rows: [{ label: 'Ha Noi', value: 12 }],
  dimensionLabel: 'Khu vuc',
  measureLabel: 'Doanh thu',
  grouped: false,
  ...(paging === undefined ? {} : { paging }),
});

const truoc = () => screen.queryByRole('button', { name: 'Nhóm trang trước' });
const sau = () => screen.queryByRole('button', { name: 'Nhóm trang sau' });

describe('ReportChart — hai cái nút lật trang nhóm', () => {
  it('cấu hình KHÔNG chia trang thì không có nút nào', () => {
    // Mọi báo cáo lưu trước §10.12 rơi vào nhánh này, nên chúng trông y hệt như
    // trước — không mọc thêm một cặp nút không ai xin.
    render(<ReportChart chartType="table" data={SO_LIEU()} onPage={vi.fn()} />);

    expect(truoc()).toBeNull();
    expect(sau()).toBeNull();
  });

  it('vừa đúng MỘT trang thì cũng không có nút', () => {
    // Hai cái nút đều chết chỉ nói với người dùng rằng có gì đó không dùng
    // được. Chia trang mà dữ liệu vừa đủ một trang là chuyện bình thường.
    render(
      <ReportChart
        chartType="table"
        data={SO_LIEU({ page: 0, hasMore: false })}
        onPage={vi.fn()}
      />,
    );

    expect(truoc()).toBeNull();
  });

  it('trang đầu: ‹ khoá, › mở', () => {
    render(
      <ReportChart chartType="table" data={SO_LIEU({ page: 0, hasMore: true })} onPage={vi.fn()} />,
    );

    expect(screen.getByText('Trang 1')).toBeInTheDocument();
    expect(truoc()).toBeDisabled();
    expect(sau()).toBeEnabled();
  });

  it('trang cuối: › khoá, ‹ mở — và số trang đếm từ 1', () => {
    render(
      <ReportChart
        chartType="table"
        data={SO_LIEU({ page: 3, hasMore: false })}
        onPage={vi.fn()}
      />,
    );

    // `page` trong DTO đếm từ 0 vì nó nhân với `limit` thành `offset`. Người đọc
    // đếm từ 1. Lệch một ở đây là "Trang 0" hiện trên màn hình.
    expect(screen.getByText('Trang 4')).toBeInTheDocument();
    expect(sau()).toBeDisabled();
    expect(truoc()).toBeEnabled();
  });

  it('bấm ‹ › gửi ra số trang MỚI, không phải delta', () => {
    // Gửi delta thì nơi nhận phải tự cộng, và hai chỗ cùng cộng là một chỗ cộng
    // hai lần.
    const onPage = vi.fn();
    render(
      <ReportChart chartType="table" data={SO_LIEU({ page: 2, hasMore: true })} onPage={onPage} />,
    );

    fireEvent.click(sau() as HTMLElement);
    expect(onPage).toHaveBeenLastCalledWith(3);

    fireEvent.click(truoc() as HTMLElement);
    expect(onPage).toHaveBeenLastCalledWith(1);
  });

  it('không có `onPage` thì không bày ra nút — kể cả khi số liệu có `paging`', () => {
    // Chỗ hiển thị nào không lật trang được (một bản in, một ảnh xem trước) vẫn
    // dùng lại được component này mà không mọc ra hai cái nút chết.
    render(<ReportChart chartType="table" data={SO_LIEU({ page: 0, hasMore: true })} />);

    expect(sau()).toBeNull();
  });

  it('trang rỗng VẪN giữ nút lùi — không để người dùng kẹt', () => {
    // Không nên xảy ra (nút › tự khoá khi hết dữ liệu), nhưng nếu dữ liệu đổi
    // giữa hai lần bấm mà nút biến mất theo thì không còn đường nào quay lại.
    const data = { ...SO_LIEU({ page: 4, hasMore: false }), rows: [] };
    render(<ReportChart chartType="table" data={data} onPage={vi.fn()} />);

    expect(screen.getByText(/Không có dòng nào/)).toBeInTheDocument();
    expect(truoc()).toBeEnabled();
  });
});

describe('PageTabs — thanh thẻ trang', () => {
  const PAGES = [
    { id: 'p1', name: 'Tổng quan' },
    { id: 'p2', name: 'Chi tiết' },
  ];

  it('chỉ đọc: đổi trang được, KHÔNG thêm/xoá được', () => {
    const onSelect = vi.fn();
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Chi tiết' }));
    expect(onSelect).toHaveBeenCalledWith('p2');

    expect(screen.queryByRole('button', { name: 'Thêm trang' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xoá trang/ })).toBeNull();
  });

  it('nút xoá CHỈ ở thẻ đang mở', () => {
    // Một dãy thẻ mỗi cái mang một dấu ✕ là một dãy dày đặc nút phá huỷ nằm
    // cạnh nút chuyển trang.
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={vi.fn()} edit={edit()} />);

    expect(screen.getByRole('button', { name: 'Xoá trang Tổng quan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá trang Chi tiết' })).toBeNull();
  });

  it('trang CUỐI CÙNG không xoá được', () => {
    // Một báo cáo không còn trang nào thì không còn gì để bấm vào.
    render(<PageTabs pages={[PAGES[0]!]} activeId="p1" onSelect={vi.fn()} edit={edit()} />);

    expect(screen.queryByRole('button', { name: /Xoá trang/ })).toBeNull();
  });

  it('bấm đúp để đổi tên, Enter để lưu', () => {
    const ops = edit();
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={vi.fn()} edit={ops} />);

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Tổng quan' }));
    const input = screen.getByLabelText('Đổi tên trang Tổng quan');
    fireEvent.change(input, { target: { value: 'Doanh thu' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(ops.onRename).toHaveBeenCalledWith('p1', 'Doanh thu');
  });

  it('tên rỗng GIỮ NGUYÊN tên cũ thay vì lưu một chuỗi trống', () => {
    // Người dùng hay xoá trắng ô rồi bấm ra ngoài khi đổi ý, và một cái thẻ
    // không chữ thì không biết mình đang bấm vào đâu.
    const ops = edit();
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={vi.fn()} edit={ops} />);

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Tổng quan' }));
    const input = screen.getByLabelText('Đổi tên trang Tổng quan');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(ops.onRename).not.toHaveBeenCalled();
  });

  it('Escape BỎ hẳn thay đổi', () => {
    const ops = edit();
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={vi.fn()} edit={ops} />);

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Tổng quan' }));
    const input = screen.getByLabelText('Đổi tên trang Tổng quan');
    fireEvent.change(input, { target: { value: 'Đổi ý rồi' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(ops.onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'Tổng quan' })).toBeInTheDocument();
  });

  it('mũi tên trái/phải đi vòng qua các thẻ', () => {
    // Một thanh chỉ bấm được bằng chuột là một thanh mà người dùng bàn phím
    // không sang được trang hai — mất một nửa báo cáo, không phải một phím tắt.
    const onSelect = vi.fn();
    render(<PageTabs pages={PAGES} activeId="p1" onSelect={onSelect} />);

    const tab = screen.getByRole('tab', { name: 'Tổng quan' });
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('p2');

    // Từ thẻ đầu bấm sang TRÁI thì vòng về thẻ cuối.
    fireEvent.keyDown(tab, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('p2');
  });

  it('chỉ thẻ ĐANG MỞ nằm trong thứ tự Tab', () => {
    // Hành vi chuẩn của một `tablist`, và nó giữ cho một báo cáo mười trang
    // không nuốt mười nhịp Tab.
    render(<PageTabs pages={PAGES} activeId="p2" onSelect={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Chi tiết' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute('tabindex', '-1');
  });
});

function edit() {
  return { onAdd: vi.fn(), onRename: vi.fn(), onRemove: vi.fn() };
}
