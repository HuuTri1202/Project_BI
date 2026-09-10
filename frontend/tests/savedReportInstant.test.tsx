import type { ReportCanvasDataDto, ReportDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelReportPreview } from '../src/features/datamodels/hooks';
import { dataModelKeys } from '../src/features/datamodels/keys';
import { ReportViewer } from '../src/features/reports/ReportViewer';
import { previewConfigOfDto } from '../src/features/reports/builder/visual';
import { snapshotIdOf, writeSnapshot } from '../src/services/querySnapshots';

/**
 * Mở một báo cáo ĐÃ LƯU thì vẽ ngay, không bắt nhìn "Đang tải…".
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "đối với những báo cáo đã lưu thì khi bấm vào hiển thị ngay biểu đồ đã vẽ
 *    trước đó chứ, sao khi tui bấm vào xem biểu đồ thì nó lại hiện đang tính và
 *    chờ khoảng vài giây mới ra biểu đồ"
 *
 * Vài giây đó là Cube biên dịch schema của cả tổ chức: đo được 4.638 ms ở lần
 * đầu sau khi Cube khởi động hoặc sau khi một mô hình đổi, so với 49–175 ms khi
 * đã ấm. Không rút ngắn được ở tầng ứng dụng — nên thay vì bắt người dùng nhìn
 * nó, ta vẽ lại số liệu lần trước rồi làm mới ngầm.
 *
 * Hai ca dưới đây khoá đúng hai nửa của lời hứa đó, và nửa thứ hai quan trọng
 * ngang nửa thứ nhất: vẽ ngay mà không nói gì thì thành nói dối.
 *
 * ⚠️ Request cố ý KHÔNG BAO GIỜ trả lời. Đây là bài kiểm về KHUNG HÌNH ĐẦU
 * TIÊN — thứ người dùng thấy trong lúc chờ — nên để nó treo là cách duy nhất
 * giữ được đúng khoảnh khắc ấy.
 */

vi.mock('../src/features/datasets/api', () => ({
  fetchReportCanvasData: vi.fn(() => new Promise<ReportCanvasDataDto>(() => {})),
  fetchReportData: vi.fn(() => new Promise(() => {})),
  // Trang nhóm 0 không đi qua đường này (hook tắt ở `page === 0`), nhưng mock cả
  // module thì thiếu một hàm là một `TypeError` ở chỗ cách xa nguyên nhân.
  fetchReportVisualData: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../src/features/datamodels/api', () => ({
  previewModelReport: vi.fn(() => new Promise(() => {})),
}));

const CONFIG = { dimensionId: 1264, measureId: 486, limit: 20, seriesDimensionId: null };

const REPORT = {
  id: 29,
  name: 'Quantity theo Category',
  source: 'datamodel',
  sourceName: 'Global-Superstore',
  datamodelId: 83,
  datasetId: null,
  chartType: 'bar',
  config: null,
  modelConfig: CONFIG,
  canvas: {
    pages: [
      {
        id: 'p1',
        name: 'Trang 1',
        visuals: [
          {
            id: 'o1',
            chartType: 'bar',
            config: CONFIG,
            title: 'Ô đã lưu',
            x: 0,
            y: 0,
            w: 12,
            h: 7,
          },
        ],
      },
    ],
  },
} as unknown as ReportDto;

const SO_LIEU = {
  rows: [{ label: 'Technology', value: 4744 }],
  dimensionLabel: 'Category',
  measureLabel: 'Tổng của Quantity',
  grouped: false,
};

function ve(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReportViewer report={REPORT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('ReportViewer — số liệu lần trước', () => {
  it('CHƯA có ảnh chụp thì vẫn là "Đang tải…" — không bịa ra một khung rỗng', () => {
    ve();

    expect(screen.getByText(/Đang tải/)).not.toBeNull();
  });

  it('CÓ ảnh chụp thì ô vẽ ngay ở khung hình đầu tiên', () => {
    writeSnapshot(
      snapshotIdOf(dataModelKeys.reportPreview(83, previewConfigOfDto(CONFIG))),
      SO_LIEU,
    );

    ve();

    expect(screen.queryByText(/Đang tải/)).toBeNull();
    expect(screen.getByText('Ô đã lưu')).not.toBeNull();
  });

  it('và NÓI RA rằng đó là số cũ đang được cập nhật', () => {
    // Không có câu này thì người đọc không phân biệt được số của lúc nào. Với
    // một công cụ báo cáo, đó là khác biệt giữa "nhanh" và "sai".
    writeSnapshot(
      snapshotIdOf(dataModelKeys.reportPreview(83, previewConfigOfDto(CONFIG))),
      SO_LIEU,
    );

    ve();

    expect(screen.getByText(/Số liệu lần trước/)).not.toBeNull();
  });

  it('ảnh chụp của MỘT CẤU HÌNH KHÁC không được dùng', () => {
    // Ca quan trọng nhất khối này. Người dùng sửa biểu đồ rồi mở lại: một cache
    // khoá lỏng sẽ vẽ số của cấu hình cũ dưới tên cấu hình mới — sai mà trông
    // hoàn toàn bình thường.
    writeSnapshot(
      snapshotIdOf(dataModelKeys.reportPreview(83, { ...CONFIG, measureId: 999 })),
      SO_LIEU,
    );

    ve();

    expect(screen.getByText(/Đang tải/)).not.toBeNull();
  });
});

/**
 * Trình dựng đi đường khác — mỗi ô một request tới `/report-preview` — nên nó
 * cần bài kiểm riêng. Đây mới là màn hình người dùng than: bấm tên báo cáo là
 * vào thẳng trình dựng.
 */
describe('useModelReportPreview — ô của trình dựng', () => {
  function boc({ children }: { children: React.ReactNode }): React.ReactElement {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const input = { chartType: 'bar' as const, config: CONFIG };

  it('có ảnh chụp thì `data` có mặt NGAY lần render đầu', () => {
    writeSnapshot(snapshotIdOf(dataModelKeys.reportPreview(83, CONFIG)), SO_LIEU);

    const { result } = renderHook(() => useModelReportPreview(83, input), { wrapper: boc });

    // Không `waitFor`: cả điểm của tính năng này là KHÔNG phải chờ.
    expect(result.current.data).toEqual(SO_LIEU);
    expect(result.current.isPending).toBe(false);
  });

  it('và VẪN hỏi lại — ảnh chụp để vẽ ngay, không phải để khỏi hỏi', () => {
    // Thiếu `initialDataUpdatedAt` thì react-query coi số liệu là vừa tính
    // xong, `staleTime` 30 giây nuốt mất lượt làm mới, và biểu đồ đứng yên ở
    // số của lần trước cho tới khi người dùng tự F5.
    writeSnapshot(snapshotIdOf(dataModelKeys.reportPreview(83, CONFIG)), SO_LIEU);

    const { result } = renderHook(() => useModelReportPreview(83, input), { wrapper: boc });

    // Hai vế phải ĐÚNG CÙNG LÚC. Chỉ kiểm `isFetching` thì ca này vẫn xanh khi
    // ảnh chụp bị bỏ hẳn — lúc đó tất nhiên nó đang nạp, vì nó chẳng có gì.
    expect(result.current.data).toEqual(SO_LIEU);
    expect(result.current.isFetching).toBe(true);
  });

  it('chưa có ảnh chụp thì đúng là đang chờ', () => {
    const { result } = renderHook(() => useModelReportPreview(83, input), { wrapper: boc });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });
});
