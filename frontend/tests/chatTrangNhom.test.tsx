import type { ReportDataDto, ReportDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from '../src/features/chat/nguCanh';
import { CanvasBoard } from '../src/features/reports/builder/CanvasBoard';
import { emptyVisual, type VisualDraft } from '../src/features/reports/builder/visual';
import { ReportViewer } from '../src/features/reports/ReportViewer';
import { useModelReportPreview } from '../src/features/datamodels/hooks';

/**
 * Khung hỏi đáp phải đọc ĐÚNG trang nhóm đang hiện trên ô — §10.12.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "đã sang trang biểu đồ 2 nhưng chat vẫn trả lời của biểu đồ 1"
 *
 * Và đó là loại sai nguy hiểm nhất: một con số CÓ THẬT trả lời cho câu hỏi
 * khác. Màn hình nói cao nhất là 395.000, khung nói 48.000 — cả hai đều là số
 * thật của cùng biểu đồ ấy, chỉ khác trang nhóm.
 *
 * ⚠️ `chartType: 'table'` ở mọi ca: `ReportChart` vẽ bảng bằng DOM, còn biểu đồ
 * thì qua `vega-embed` — thứ cần `HTMLCanvasElement.getContext`, jsdom không
 * có. Cùng lý do đã ghi ở `groupPaging.test.tsx`.
 */

const TRANG_0: ReportDataDto = {
  rows: [{ label: 'Nước suối Lavie 500ml', value: 3500 }],
  dimensionLabel: 'Product Name',
  measureLabel: 'Cost price',
  grouped: false,
  paging: { page: 0, hasMore: true },
};

const TRANG_1: ReportDataDto = {
  rows: [{ label: 'Giấy vệ sinh Bless 10 cuộn', value: 395000 }],
  dimensionLabel: 'Product Name',
  measureLabel: 'Cost price',
  grouped: false,
  paging: { page: 1, hasMore: false },
};

vi.mock('../src/features/datasets/api', () => ({
  fetchReportCanvasData: vi.fn(() =>
    Promise.resolve({ visuals: [{ visualId: 'a', data: TRANG_0 }] }),
  ),
  fetchReportVisualData: vi.fn(() => Promise.resolve(TRANG_1)),
  fetchReportData: vi.fn(() => {
    throw new Error('báo cáo dạng KHUNG không đi qua endpoint một biểu đồ');
  }),
}));

vi.mock('../src/features/datamodels/hooks', () => ({ useModelReportPreview: vi.fn() }));

const BAO_CAO = {
  id: 7,
  name: 'Cost price theo Product Name',
  source: 'datamodel',
  sourceName: 'Bán hàng',
  datamodelId: 3,
  chartType: 'table',
  config: null,
  modelConfig: null,
  canvas: {
    pages: [
      {
        id: 'p1',
        name: 'Trang 1',
        annotations: [],
        visuals: [
          {
            id: 'a',
            chartType: 'table',
            config: { dimensionId: 1, measureId: 2, limit: 20 },
            x: 0,
            y: 0,
            w: 12,
            h: 7,
          },
        ],
      },
    ],
  },
  creatorName: 'Ai đó',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as ReportDto;

/**
 * Bắt lại mọi lần trang `khai` ngữ cảnh.
 *
 * `khai` phải GIỮ NGUYÊN tham chiếu giữa các lần render — nó là dependency của
 * effect trong `useKhaiNguCanh`, nên một hàm mới mỗi lần render là một vòng lặp
 * vô hạn, không phải một ca đỏ dễ đọc.
 */
function batNguCanh(): { lan: NguCanh[]; value: React.ContextType<typeof NguCanhContext> } {
  const lan: NguCanh[] = [];
  return {
    lan,
    value: {
      nguCanh: NGU_CANH_RONG,
      khai: (n: NguCanh) => {
        lan.push(n);
      },
    },
  };
}

describe('ngữ cảnh của khung hỏi đáp theo trang nhóm', () => {
  it('lật sang trang nhóm 2 thì khung đọc số của TRANG 2', async () => {
    const { lan, value } = batNguCanh();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <NguCanhContext.Provider value={value}>
          <ReportViewer report={BAO_CAO} activePageId="p1" onSelectPage={vi.fn()} />
        </NguCanhContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByText('Nước suối Lavie 500ml');
    // Trang nhóm đầu: số tới từ `canvas-data`, ô không khai thêm gì.
    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.bang?.rows[0]?.label).toBe('Nước suối Lavie 500ml');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Nhóm trang sau' }));
    await screen.findByText('Giấy vệ sinh Bless 10 cuộn');

    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.bang?.rows[0]?.label).toBe('Giấy vệ sinh Bless 10 cuộn');
    });
  });

  it('lật NGƯỢC về trang nhóm đầu thì bản khai của ô biến mất', async () => {
    /*
     * Không có ca này thì một bản vá chỉ-ghi-thêm vẫn xanh ở ca trên: ô khai
     * bảng trang 2, không ai dọn, và khung trả lời bằng trang 2 trong lúc màn
     * hình đã về trang 1. Cùng một lỗi, lật ngược chiều.
     */
    const { lan, value } = batNguCanh();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <NguCanhContext.Provider value={value}>
          <ReportViewer report={BAO_CAO} activePageId="p1" onSelectPage={vi.fn()} />
        </NguCanhContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByText('Nước suối Lavie 500ml');
    fireEvent.click(screen.getByRole('button', { name: 'Nhóm trang sau' }));
    await screen.findByText('Giấy vệ sinh Bless 10 cuộn');
    fireEvent.click(screen.getByRole('button', { name: 'Nhóm trang trước' }));
    await screen.findByText('Nước suối Lavie 500ml');

    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.bang?.rows[0]?.label).toBe('Nước suối Lavie 500ml');
    });
  });
});

const cuoi = (lan: NguCanh[]): NguCanh => lan[lan.length - 1] as NguCanh;

describe('trình dựng: ô báo lên trang nhóm nó đang xem', () => {
  /*
   * Trình dựng có CÙNG lỗi, khác đường đi: khung hỏi đáp ở đó trả lời về ô đang
   * chọn, và trang dựng lại lời gọi số liệu của ô bằng `page: 0` đóng cứng.
   *
   * Ca này canh phần ô phải nói ra. Việc trang dùng lại con số ấy thì
   * `useModelReportPreview` lo — cùng tham số là cùng mục cache, không thêm một
   * vòng mạng nào. Đó là lý do ô báo SỐ TRANG chứ không báo bảng.
   */
  it('bấm › thì trang nghe được số trang MỚI của đúng ô đó', () => {
    vi.mocked(useModelReportPreview).mockReturnValue({
      data: { ...TRANG_0, rows: [{ label: 'Furniture', value: 742000 }] },
      isError: false,
      error: null,
      isFetching: false,
    } as ReturnType<typeof useModelReportPreview>);

    const o: VisualDraft = {
      ...emptyVisual({ x: 0, y: 0 }),
      id: 'o1',
      chartType: 'table',
      dimensionId: 5,
      measureId: 10,
    };
    const onGroupPage = vi.fn();

    render(
      <CanvasBoard
        drafts={[o]}
        annotations={[]}
        selectedId="o1"
        editingId={null}
        modelId={7}
        tenBaoCao="Báo cáo quý IV"
        labelOf={() => 'Cost price theo Product Name'}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onChangeAnnotation={vi.fn()}
        onRemoveAnnotation={vi.fn()}
        onEditText={vi.fn()}
        onGroupPage={onGroupPage}
      />,
    );

    // Lần đầu ô khai trang 0 — trang phải biết cả lúc KHÔNG lật, nếu không thì
    // đổi ô đang chọn là đọc trang nhóm của ô trước.
    expect(onGroupPage).toHaveBeenCalledWith('o1', 0);

    fireEvent.click(screen.getByRole('button', { name: 'Nhóm trang sau' }));
    expect(onGroupPage).toHaveBeenLastCalledWith('o1', 1);
  });
});
