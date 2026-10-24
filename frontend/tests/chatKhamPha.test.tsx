import type { ExplorerResultDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from '../src/features/chat/nguCanh';
import DataModelPage from '../src/pages/tenant/DataModelPage';
import ExplorerTab from '../src/pages/tenant/datamodel/ExplorerTab';

/**
 * Khung hỏi đáp phải trả lời được về BẢNG KẾT QUẢ ở tab Khám phá.
 *
 * ─── Lỗ hổng đo được ────────────────────────────────────────────────────────
 *
 * Người dùng kéo chiều, kéo thước đo, bấm Chạy, nhìn một bảng đầy số rồi hỏi
 * "cao nhất là gì" — và nhận về "chưa hiểu". Trang mô hình khai rất kỹ CẤU
 * TRÚC (bảng, cột, kiểu, quan hệ) nhưng không khai một con số nào của kết quả.
 * Thứ người ta đang nhìn thẳng vào lại là thứ khung mù nhất.
 *
 * ═══ Vì sao ca này dựng cả CÂY THẬT, không test riêng hàm ══════════════════
 *
 * Chỗ hỏng không nằm trong `duKienKhamPha` — nó nằm ở việc AI được quyền khai.
 * `useKhaiNguCanh` là phép gán đè, mà effect React chạy từ con lên cha; một
 * bản vá cho tab tự khai sẽ bị trang cha xoá ngay lần mount đầu, và không bộ
 * test hàm nào thấy được điều đó.
 *
 * Và nó dựng `ExplorerTab` THẬT chứ không phải một tab giả lập: ca cuối canh
 * hàm DỌN của chính tab ấy. Lần đầu viết bộ này tui dùng tab giả lập, và đột
 * biến "bỏ hàm dọn" sống sót — bài kiểm chỉ soi lại đúng cái tab tui vừa tự
 * viết trong bài kiểm.
 */

const MO_HINH = {
  id: 3,
  name: 'Bán hàng',
  workspaceId: 1,
  datasets: [],
  measures: [],
  relationships: [],
  creatorName: 'Ai đó',
};

/** Kết quả mà `useRunQuery` giả lập trả về — mỗi ca đặt lại qua `dung`. */
let ketQuaHienTai: ExplorerResultDto | undefined;

// Giả lập THEO MÔ-ĐUN, và phải đủ mọi hook mà cả cây gọi tới: trang này kéo
// theo `CreateDataModelModal`, `CreateReportMenu` và cả `ExplorerTab`.
vi.mock('../src/features/datamodels/hooks', () => ({
  useDataModel: () => ({ data: MO_HINH, isPending: false, isError: false, error: null }),
  useDataModels: () => ({ data: { items: [MO_HINH] } }),
  useDeleteDataModel: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateDataModel: () => ({ mutate: vi.fn(), isPending: false }),
  useExplorerStatus: () => ({ data: { cubeReady: true } }),
  useExplorerFields: () => ({
    data: { dimensions: [], measures: [] },
    isPending: false,
    isError: false,
  }),
  useRunQuery: () => ({
    data: ketQuaHienTai,
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
  useQuerySql: () => ({ data: undefined, isPending: false, isError: false, error: null }),
}));
vi.mock('../src/auth/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock('../src/workspace/useWorkspace', () => ({
  useWorkspace: () => ({ current: 1, options: [{ id: 1, name: 'WS' }], select: vi.fn() }),
}));

const KET_QUA: ExplorerResultDto = {
  columns: [
    { id: 1, label: 'Khu vực', kind: 'dimension' },
    // `mota` có mặt thì nó mới là tên đúng — xem `duKienKhamPha`.
    { id: 2, label: 'Total amount', kind: 'measure', mota: 'Tổng của Total amount' },
  ],
  rows: [
    ['Miền Bắc', 300],
    ['Miền Nam', 500],
  ],
  truncated: false,
};

function dung(kq: ExplorerResultDto | null): { lan: NguCanh[]; roiTab: () => void } {
  ketQuaHienTai = kq ?? undefined;
  const lan: NguCanh[] = [];
  const value: React.ContextType<typeof NguCanhContext> = {
    nguCanh: NGU_CANH_RONG,
    khai: (n: NguCanh) => {
      lan.push(n);
    },
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/datamodels/3/explorer']}>
        <NguCanhContext.Provider value={value}>
          <Routes>
            <Route path="/datamodels/:id" element={<DataModelPage />}>
              <Route index element={<p>tab lược đồ</p>} />
              <Route path="explorer" element={<ExplorerTab />} />
            </Route>
          </Routes>
        </NguCanhContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  /*
   * Rời tab bằng cách BẤM sang tab khác, không phải `unmount` cả cây.
   *
   * `unmount()` gỡ luôn trang cha, nên hàm dọn của tab gọi `ghiKetQua(null)`
   * vào một component đang biến mất — cha không render lại, không khai lại, và
   * bài kiểm xanh dù hàm dọn có bị gỡ. Bấm sang tab khác mới đúng chuyện thật:
   * cha ở lại, chỉ tab đổi.
   */
  void unmount;
  return { lan, roiTab: () => fireEvent.click(screen.getByText('Schemas')) };
}

const cuoi = (lan: NguCanh[]): NguCanh => lan[lan.length - 1] as NguCanh;
const coKetQua = (n: NguCanh): boolean => n.nguon.some((x) => x.ten === 'Kết quả Khám phá');

describe('Khung đọc được bảng kết quả ở tab Khám phá', () => {
  it('bảng vừa chạy trở thành một nguồn, đứng TRƯỚC cấu trúc mô hình', async () => {
    const { lan } = dung(KET_QUA);
    await waitFor(() => {
      expect(coKetQua(cuoi(lan))).toBe(true);
    });

    const nguon = cuoi(lan).nguon;
    expect(nguon[0]?.ten).toBe('Kết quả Khám phá');
    expect(nguon[0]?.bangTho?.dong).toEqual([
      ['Miền Bắc', 300],
      ['Miền Nam', 500],
    ]);
  });

  /*
   * ⚠️ Thước đo gieo sẵn TRÙNG TÊN với cột nó gộp, nên "Total amount" vừa có
   * nghĩa là tiền của MỘT đơn vừa có nghĩa là tổng tiền cả nhóm. Bảng trên màn
   * hình đã gỡ nhập nhằng đó bằng `mota`; khung mà dùng `label` trơn là dựng
   * lại đúng chỗ nhập nhằng ấy.
   */
  it('tên cột lấy từ `mota` khi có, không lấy `label` trơn', async () => {
    const { lan } = dung(KET_QUA);
    await waitFor(() => {
      expect(coKetQua(cuoi(lan))).toBe(true);
    });

    expect(cuoi(lan).nguon[0]?.bangTho?.cot).toEqual(['Khu vực', 'Tổng của Total amount']);
  });

  it('chưa chạy gì thì KHÔNG có nguồn kết quả nào', async () => {
    const { lan } = dung(null);
    await waitFor(() => {
      expect(lan.length).toBeGreaterThan(0);
    });

    expect(coKetQua(cuoi(lan))).toBe(false);
  });

  /*
   * ⚠️ Ca canh HÀM DỌN của `ExplorerTab`. Để lại bảng cũ sau khi rời tab nghĩa
   * là khung trả lời bằng một kết quả KHÔNG CÒN trên màn hình — đúng loại sai
   * mà cả tính năng này dựng lên để chặn, và là loại không ai thấy bằng mắt.
   */
  it('rời tab thì bản khai kết quả BIẾN MẤT', async () => {
    const { lan, roiTab } = dung(KET_QUA);
    await waitFor(() => {
      expect(coKetQua(cuoi(lan))).toBe(true);
    });

    roiTab();

    await waitFor(() => {
      expect(coKetQua(cuoi(lan))).toBe(false);
    });
  });
});
