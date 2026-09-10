import { CANVAS_ROW_HEIGHT, type ReportCanvasDataDto, type ReportPageDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasView } from '../src/features/reports/CanvasView';

/*
 * Từ §10.11 mỗi ô tự hỏi trang nhóm tiếp theo của mình, nên component cần một
 * `QueryClient`. Request bị chặn hẳn: mọi ca ở đây đứng ở trang nhóm 0, nơi số
 * liệu đến từ `data` chứ không từ một lượt gọi — một hàm ném lỗi ở đây là cách
 * chắc chắn nhất bắt được nếu điều đó thôi đúng.
 */
vi.mock('../src/features/datasets/api', () => ({
  fetchReportVisualData: vi.fn(() => {
    throw new Error('trang nhóm 0 KHÔNG được gọi API');
  }),
}));

/**
 * Khung ở chế độ XEM dựng ra đúng thứ nó hứa — §10.10.
 *
 * ═══ Vì sao ca này cần chạy trong DOM thật ══════════════════════════════════
 *
 * `canvasVisual.test.ts` đã khoá phép TÍNH bố cục. Ca ở đây khoá thứ khác: việc
 * ghép số liệu vào đúng ô, và việc một ô hỏng không kéo theo ô khác. Hai chuyện
 * đó chỉ lộ ra khi component thật sự render.
 *
 * ⚠️ Cố ý KHÔNG có ca nào vẽ biểu đồ thành công. `ReportChart` nạp `vega-embed`
 * và cần `HTMLCanvasElement.getContext`, thứ jsdom không có — một ca như vậy sẽ
 * đỏ vì môi trường chứ không vì code. Phần đó đã được kiểm bằng
 * `chartSpec.test.ts` (biên dịch spec) và bằng tay trên dữ liệu thật.
 */

const page: ReportPageDto = {
  id: 'p1',
  name: 'Trang 1',
  visuals: [
    {
      id: 'a',
      chartType: 'bar',
      config: { dimensionId: 1, measureId: 2, limit: 10 },
      x: 0,
      y: 0,
      w: 4,
      h: 7,
    },
    {
      id: 'b',
      chartType: 'pie',
      config: { dimensionId: 3, measureId: 2, limit: 5 },
      title: 'Tên riêng của ô B',
      x: 4,
      y: 0,
      w: 8,
      h: 7,
    },
    {
      id: 'c',
      chartType: 'table',
      config: { dimensionId: 1, measureId: 2, limit: 10 },
      x: 0,
      y: 7,
      w: 12,
      h: 5,
    },
  ],
};

/** Bọc trong `QueryClientProvider` — xem ghi chú ở `vi.mock` trên đầu file. */
function ve(node: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('CanvasView', () => {
  it('đặt từng ô đúng cột và hàng đã lưu', () => {
    const { container } = ve(<CanvasView page={page} reportId={7} data={undefined} />);
    const cells = container.querySelectorAll('section');

    expect(cells).toHaveLength(3);
    // Grid đếm đường kẻ từ 1: ô ở cột 4 phải ra `5 / span 8`.
    expect((cells[1] as HTMLElement).style.gridColumn).toBe('5 / span 8');
    expect((cells[2] as HTMLElement).style.gridRow).toBe('8 / span 5');
  });

  it('chiều cao lưới tính theo ô THẤP NHẤT', () => {
    const { container } = ve(<CanvasView page={page} reportId={7} data={undefined} />);
    const grid = container.firstElementChild as HTMLElement;

    // Ô cuối kết thúc ở hàng 12, nên khung phải cao 12 hàng — không phải sàn 8.
    expect(grid.style.minHeight).toBe(`${12 * CANVAS_ROW_HEIGHT}px`);
  });

  it('chưa có số liệu: tên riêng hiện ngay, tên tự sinh thì chưa', () => {
    // Tên tự sinh cần nhãn từ số liệu ("Doanh thu theo Khu vực"), nhưng tên
    // riêng thì không — hiện được sớm thì hiện.
    ve(<CanvasView page={page} reportId={7} data={undefined} />);

    expect(screen.getByText('Tên riêng của ô B')).toBeInTheDocument();
    // Chỉ ô B có tiêu đề; hai ô kia để trống chứ không lặp lại chữ "Đang tải…"
    // vốn đã nằm trong thân ô.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(screen.getAllByText('Đang tải…')).toHaveLength(3);
  });

  it('MỘT ô hỏng chỉ làm hỏng chính nó', () => {
    // Đây là lý do backend dùng `Promise.allSettled` và trả `error` theo TỪNG ô.
    // Một ô trỏ vào thước đo vừa bị xoá không được phép làm trắng cả trang.
    const data: ReportCanvasDataDto = {
      visuals: [
        { visualId: 'a', data: null, error: 'Thước đo không còn trong mô hình.' },
        { visualId: 'b', data: null, error: 'Lỗi khác.' },
        { visualId: 'c', data: null, error: 'Lỗi thứ ba.' },
      ],
    };
    const { container } = ve(<CanvasView page={page} reportId={7} data={data} />);

    expect(screen.getByText('Thước đo không còn trong mô hình.')).toBeInTheDocument();
    // Ba ô vẫn còn TRÊN KHUNG, mỗi ô mang câu lỗi của riêng nó — không có ô nào
    // biến mất, và không có hộp lỗi nào phủ lên cả khung.
    expect(container.querySelectorAll('section')).toHaveLength(3);
    expect(screen.getByText('Lỗi khác.')).toBeInTheDocument();
    expect(screen.getByText('Lỗi thứ ba.')).toBeInTheDocument();
  });

  it('ghép số liệu theo visualId, KHÔNG theo thứ tự mảng', () => {
    // Backend trả về đúng thứ tự đã nhận, nhưng dựa vào điều đó là dựa vào một
    // chi tiết cài đặt. Đảo thứ tự ở đây chứng minh việc ghép không dùng chỉ số.
    const data: ReportCanvasDataDto = {
      visuals: [
        { visualId: 'c', data: null, error: 'Lỗi của ô C' },
        { visualId: 'a', data: null, error: 'Lỗi của ô A' },
        { visualId: 'b', data: null, error: 'Lỗi của ô B' },
      ],
    };
    const { container } = ve(<CanvasView page={page} reportId={7} data={data} />);
    const cells = container.querySelectorAll('section');

    // Ô đầu tiên trên khung là 'a', nên nó phải mang câu lỗi của 'a'.
    expect(cells[0]?.textContent).toContain('Lỗi của ô A');
    expect(cells[2]?.textContent).toContain('Lỗi của ô C');
  });

  it('ô có trong bố cục nhưng vắng trong câu trả lời thì NÓI RA', () => {
    // Không nên xảy ra. Xảy ra rồi mà để một khung trắng thì không ai lần được.
    const data: ReportCanvasDataDto = { visuals: [{ visualId: 'a', data: null, error: 'x' }] };
    ve(<CanvasView page={page} reportId={7} data={data} />);

    expect(screen.getAllByText('Không có số liệu trả về cho ô này.')).toHaveLength(2);
  });
});
