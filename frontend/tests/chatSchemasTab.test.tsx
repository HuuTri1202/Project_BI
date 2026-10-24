import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from '../src/features/chat/nguCanh';
import DataModelPage from '../src/pages/tenant/DataModelPage';
import SchemasTab from '../src/pages/tenant/datamodel/SchemasTab';

/**
 * Khung phải trả lời về BẢNG NGƯỜI DÙNG ĐANG MỞ, không phải bảng số 0.
 *
 * ─── Lỗ hổng đo được ────────────────────────────────────────────────────────
 *
 * Tab Schemas cho mở từng bảng ra xem cột. Khung thì khai mọi bảng theo đúng
 * thứ tự trong mô hình, nên chip mặc định luôn là bản tóm tắt và "cột này kiểu
 * gì" được chấm trên bảng đầu danh sách — dù người dùng đang mở bảng thứ năm.
 *
 * Và nó không dừng ở một cái chip sai. `duKienPhang` xếp nguồn ĐANG CHỌN lên
 * đầu rồi backend cắt ở 60 nhãn; một mô hình 8 bảng × 25 cột sinh ra hơn 230
 * dữ kiện, nên từ bảng thứ ba trở đi KHÔNG nhãn nào tới được lớp mô hình. Bảng
 * người dùng đang nhìn là bảng khung mù nhất.
 *
 * ═══ Vì sao dựng cả cây THẬT ═══════════════════════════════════════════════
 *
 * Cùng lý do đã ghi ở `chatKhamPha.test.tsx`: `useKhaiNguCanh` là phép gán đè
 * và effect React chạy từ con lên cha, nên chỗ hỏng nằm ở việc AI được quyền
 * khai — không một bộ test hàm nào thấy được. Và `SchemasTab` ở đây là tab
 * THẬT, vì ca cuối canh đúng hàm dọn của nó.
 */

const COT = (id: number, ten: string) => ({
  id,
  columnName: ten,
  alias: null,
  chType: 'String',
  cubeType: 'string' as const,
  role: 'dimension' as const,
  typeChanged: false,
});

const BANG = (id: number, ten: string) => ({
  id,
  datasetId: id * 10,
  datasetName: ten,
  displayName: null,
  chTable: `ch_${ten}`,
  source: 'file' as const,
  originalFilename: `${ten}.csv`,
  sourceSchema: null,
  sourceTable: null,
  connectionName: null,
  columns: [COT(id * 100 + 1, 'ma'), COT(id * 100 + 2, 'ten')],
});

const MO_HINH = {
  id: 3,
  name: 'Bán hàng',
  workspaceId: 1,
  datasets: [BANG(1, 'Orders'), BANG(2, 'Customers')],
  measures: [],
  relationships: [],
  creatorName: 'Ai đó',
};

/*
 * ⚠️ Mỗi giá trị trả về phải GIỮ NGUYÊN THAM CHIẾU giữa hai lần render.
 *
 * `useMeasures()` trả `[]` dựng tại chỗ thì mảng ấy mới ở mỗi lần render, mà
 * `SchemasTab` có một effect `[data, measures.data]` gọi `setDrafts` — thành
 * một vòng render vô hạn, và bộ test treo chứ không đỏ. Cùng cái bẫy tham
 * chiếu mà `NguCanh` đã phải ghi lại.
 */
const RONG: never[] = [];
const MUTATION = { mutate: vi.fn(), isPending: false };
const SCHEMA = { data: MO_HINH, isPending: false, isError: false, error: null };
const DO_RONG = { data: RONG, isPending: false };
const DS_RONG = { data: { items: RONG }, isPending: false };
const DS_MO_HINH = { data: { items: [MO_HINH] } };

vi.mock('../src/features/datamodels/hooks', () => ({
  useDataModel: () => SCHEMA,
  useDataModels: () => DS_MO_HINH,
  useDeleteDataModel: () => MUTATION,
  useCreateDataModel: () => MUTATION,
  useModelSchema: () => SCHEMA,
  useMeasures: () => DO_RONG,
  useSaveSchema: () => MUTATION,
  useRemoveDataset: () => MUTATION,
  useUpdateModelDataset: () => MUTATION,
  // Hai hộp thoại con của tab cũng gọi hooks từ đúng mô-đun này, và chúng được
  // render ngay cả khi đóng — thiếu một cái là cả cây ném lúc mount.
  useAddDatasets: () => MUTATION,
  useCreateFormulaMeasure: () => MUTATION,
  useCreateRowExprMeasure: () => MUTATION,
  useDeleteMeasure: () => MUTATION,
}));
vi.mock('../src/features/tenant/hooks', () => ({
  useDatasets: () => DS_RONG,
}));
vi.mock('../src/auth/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock('../src/workspace/useWorkspace', () => ({
  useWorkspace: () => ({ current: 1, options: [{ id: 1, name: 'WS' }], select: vi.fn() }),
}));

// jsdom không cài `scrollIntoView`, mà `SearchSelect` trong hộp thoại đổi tên
// bảng gọi nó ngay lúc mount. Không liên quan tới thứ bộ này canh.
Element.prototype.scrollIntoView = vi.fn();

function dung(): { lan: NguCanh[]; roiTab: () => void } {
  const lan: NguCanh[] = [];
  const value: React.ContextType<typeof NguCanhContext> = {
    nguCanh: NGU_CANH_RONG,
    khai: (n: NguCanh) => {
      lan.push(n);
    },
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/datamodels/3']}>
        <NguCanhContext.Provider value={value}>
          <Routes>
            <Route path="/datamodels/:id" element={<DataModelPage />}>
              <Route index element={<SchemasTab />} />
              <Route path="relationship" element={<p>tab quan hệ</p>} />
            </Route>
          </Routes>
        </NguCanhContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Rời tab bằng cách BẤM, không `unmount`: cha phải ở lại để khai lại.
  return { lan, roiTab: () => fireEvent.click(screen.getByText('Relationship')) };
}

const cuoi = (lan: NguCanh[]): NguCanh => lan[lan.length - 1] as NguCanh;

describe('Khung đọc được bảng đang mở ở tab Schemas', () => {
  it('chưa mở bảng nào -> bản tóm tắt mô hình đứng đầu', () => {
    const { lan } = dung();

    expect(cuoi(lan).nguon[0]?.ten).toBe('Mô hình Bán hàng');
  });

  it('mở bảng thứ HAI -> chính nó đứng đầu, trước cả bản tóm tắt', async () => {
    const { lan } = dung();

    fireEvent.click(screen.getByText('Customers'));

    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.ten).toBe('Customers');
    });
    // Bản tóm tắt vẫn còn, chỉ lùi một bậc — không ai mất đáp án.
    expect(cuoi(lan).nguon[1]?.ten).toBe('Mô hình Bán hàng');
    // Và không nhân đôi: `Customers` chỉ xuất hiện MỘT lần.
    expect(cuoi(lan).nguon.filter((n) => n.ten === 'Customers')).toHaveLength(1);
  });

  /*
   * Rời tab mà không dọn thì sang tab Quan hệ, khung vẫn coi một bảng là "thứ
   * đang nhìn" và trả lời câu "cái này" bằng dữ kiện của một bảng không còn
   * trên màn hình.
   */
  it('rời tab -> bảng đang mở thôi đứng đầu', async () => {
    const { lan, roiTab } = dung();

    fireEvent.click(screen.getByText('Customers'));
    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.ten).toBe('Customers');
    });

    roiTab();

    await waitFor(() => {
      expect(cuoi(lan).nguon[0]?.ten).toBe('Mô hình Bán hàng');
    });
  });
});
