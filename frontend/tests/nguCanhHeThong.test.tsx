import type { DataModelDto, DatasetDto, PageResult } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as moHinhApi from '../src/features/datamodels/api';
import { useNguCanhHeThong } from '../src/features/chat/nguCanhHeThong';
import * as tenantApi from '../src/features/tenant/api';

/**
 * Lớp dữ kiện XUYÊN HỆ THỐNG của khung hỏi đáp.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Phần trả lời đã có bộ riêng (`traLoi.test.ts`, hàm thuần). Ở đây chỉ còn bốn
 * thứ, và cả bốn đều là cách lớp này có thể làm câu trả lời nói sai:
 *
 *   1. Gọi mạng khi khung còn ĐÓNG — hai request trên mọi lần tải mọi trang,
 *      cho một khung mà phần lớn lượt ghé không ai mở.
 *   2. Gửi `workspaceId` — câu trả lời thành "trong workspace này" trong khi nó
 *      tự nhận là của cả tổ chức.
 *   3. Sai thứ tự nguồn. `traLoiHeThong` và `luaChonHeThong` đọc nguồn ĐẦU
 *      TIÊN như bản tóm tắt; để một bộ dữ liệu lọt lên đầu là "có bao nhiêu bộ
 *      dữ liệu" trả lời bằng số dòng của một bộ nào đó.
 *   4. Giữ lại bản tóm tắt của `duKienDanhSachMoHinh` — nhãn của nó nói "trong
 *      workspace này", mà truy vấn ở đây là của cả tổ chức.
 */

vi.mock('../src/features/tenant/api', () => ({ fetchDatasets: vi.fn() }));
vi.mock('../src/features/datamodels/api', () => ({ fetchDataModels: vi.fn() }));

const fetchDatasets = vi.mocked(tenantApi.fetchDatasets);
const fetchDataModels = vi.mocked(moHinhApi.fetchDataModels);

function trang<T>(items: T[], total = items.length): PageResult<T> {
  return { items, page: 1, pageSize: 200, total, totalPages: 1 };
}

const BO_DU_LIEU = {
  id: 1,
  name: 'Orders',
  source: 'file',
  rowCount: 1200,
  columnCount: 8,
  truncated: false,
  status: 'ready',
  loadStatus: 'loaded',
  loadedRowCount: 1200,
  datamodelCount: 2,
  fileSizeBytes: 2048,
  originalFilename: 'orders.csv',
  sheetName: null,
  sourceSchema: null,
  sourceTable: null,
  connectionName: null,
} as unknown as DatasetDto;

const MO_HINH = {
  id: 7,
  name: 'Bán hàng',
  datasetCount: 3,
  measureCount: 2,
  relationshipCount: 2,
  reportCount: 4,
  description: null,
  creatorName: 'Thái',
  updatedAt: '2026-01-02T03:04:05.000Z',
} as unknown as DataModelDto;

function chay(dangMo: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useNguCanhHeThong(dangMo), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  fetchDatasets.mockReset();
  fetchDataModels.mockReset();
  fetchDatasets.mockResolvedValue(trang([BO_DU_LIEU], 12));
  fetchDataModels.mockResolvedValue(trang([MO_HINH], 3));
});

describe('Chỉ gọi mạng khi khung ĐANG MỞ', () => {
  it('khung đóng: không request nào, không nguồn nào', () => {
    const { result } = chay(false);

    expect(fetchDatasets).not.toHaveBeenCalled();
    expect(fetchDataModels).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('khung mở: gọi hai endpoint, và KHÔNG gửi workspaceId', async () => {
    chay(true);

    await waitFor(() => {
      expect(fetchDatasets).toHaveBeenCalled();
    });
    /*
     * ⚠️ Cả hai schema hiểu `workspaceId` vắng mặt là CẢ TỔ CHỨC. Gửi nó lên
     * là câu trả lời chỉ còn phạm vi một workspace, trong khi nhãn và câu chữ
     * vẫn nói "toàn bộ tổ chức" — nói sai phạm vi, bằng những con số có thật.
     */
    expect(fetchDatasets.mock.calls[0]?.[0]).not.toHaveProperty('workspaceId');
    expect(fetchDataModels.mock.calls[0]?.[0]).not.toHaveProperty('workspaceId');
  });
});

describe('Hình dạng danh sách dựng ra', () => {
  it('bản tóm tắt đứng ĐẦU, mang tổng của cả tổ chức', async () => {
    const { result } = chay(true);

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(1);
    });

    const tomTat = result.current[0];
    expect(tomTat?.ten).toBe('Tổng quan toàn tổ chức');
    // `total`, không phải `items.length`: trang đầu chỉ có một bộ, tổ chức có 12.
    expect(tomTat?.duKien).toEqual([
      { nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: '12' },
      { nhan: 'Số mô hình dữ liệu trong toàn bộ tổ chức', gia: '3' },
    ]);
  });

  it('từng bộ dữ liệu và từng mô hình thành một nguồn hỏi được', async () => {
    const { result } = chay(true);

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(1);
    });

    const ten = result.current.map((n) => n.ten);
    expect(ten).toContain('Orders');
    expect(ten).toContain('Bán hàng');
  });

  /*
   * ⚠️ `duKienDanhSachMoHinh` tự thêm một nguồn tóm tắt với nhãn "Số mô hình dữ
   * liệu trong workspace này". Giữ lại là hai bản tóm tắt nói hai phạm vi khác
   * nhau trong cùng một danh sách — và `chonThuocTinh` không phân biệt được.
   */
  it('KHÔNG giữ bản tóm tắt theo workspace của hàm chuyển đổi kia', async () => {
    const { result } = chay(true);

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(1);
    });

    const moiNhan = result.current.flatMap((n) => n.duKien.map((d) => d.nhan));
    expect(moiNhan.some((n) => n.includes('workspace này'))).toBe(false);
    expect(result.current.map((n) => n.ten)).not.toContain('Danh sách mô hình dữ liệu');
  });

  /*
   * Một viewer CỐ Ý không có `dataset:read`/`datamodel:read` (migration 26), nên
   * hai lời gọi này trả 403. Khung khi đó không được có nguồn hệ thống nào —
   * đó chính là lớp quyền, và nó tới miễn phí vì không có đường nào khác.
   */
  it('cả hai lời gọi hỏng (viewer bị 403) thì không có nguồn nào', async () => {
    fetchDatasets.mockRejectedValue(new Error('403'));
    fetchDataModels.mockRejectedValue(new Error('403'));
    const { result } = chay(true);

    await waitFor(() => {
      expect(fetchDatasets).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });

  it('một lời gọi hỏng thì vẫn trả lời bằng cái còn lại', async () => {
    fetchDataModels.mockRejectedValue(new Error('403'));
    const { result } = chay(true);

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(1);
    });

    expect(result.current[0]?.duKien).toEqual([
      { nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: '12' },
    ]);
    expect(result.current.map((n) => n.ten)).toContain('Orders');
  });
});
