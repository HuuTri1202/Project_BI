import type { ReportDto, TenantRole } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../src/auth/authContext';
import ReportViewPage from '../src/pages/tenant/ReportViewPage';

/**
 * Trang XEM báo cáo và cái nút dẫn sang trình dựng — §10.13.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Người dùng xin đúng hai điều:
 *
 *     "khi bấm vào báo cáo sẽ hiển thị 1 trang xem tổng quan như này trước,
 *      nhưng với những role có quyền thì sẽ có nút edit"
 *
 * Nên hai điều đó là hai thứ phải khoá lại: trang mở ra được cho MỌI vai trò,
 * và nút "Chỉnh sửa" chỉ có mặt khi nó thật sự dẫn tới một trình dựng dùng
 * được. Đây KHÔNG phải bảo mật — chặn thật nằm ở `authorize('report','modify')`
 * phía backend; ở đây chỉ canh chuyện đừng bày ra một cái nút dẫn tới 403 hoặc
 * tới một trang chỉ hiện lỗi.
 *
 * ═══ Vì sao báo cáo trong ca này CHƯA có biểu đồ ════════════════════════════
 *
 * `chartType: null` + `canvas: null` là trạng thái "chưa dựng biểu đồ", và
 * `ReportViewer` ở đó KHÔNG gọi endpoint số liệu nào. Nhờ vậy ca này đo đúng
 * phần nó muốn đo — thanh công cụ — mà không phải giả lập Cube, và cũng không
 * đụng `vega-embed` (thứ cần `HTMLCanvasElement.getContext`, jsdom không có).
 */

vi.mock('../src/features/datasets/api', () => ({
  fetchReport: vi.fn((id: number) => Promise.resolve(baoCao({ id }))),
  // Ba hàm số liệu phải TỒN TẠI (hook nào cũng import chúng) nhưng không được
  // gọi: một báo cáo chưa có biểu đồ thì không có gì để hỏi.
  fetchReportData: vi.fn(() => {
    throw new Error('báo cáo chưa có biểu đồ thì KHÔNG được hỏi số liệu');
  }),
  fetchReportCanvasData: vi.fn(() => {
    throw new Error('báo cáo chưa có biểu đồ thì KHÔNG được hỏi số liệu');
  }),
  fetchReportVisualData: vi.fn(() => {
    throw new Error('báo cáo chưa có biểu đồ thì KHÔNG được hỏi số liệu');
  }),
}));

let mau: Partial<ReportDto> = {};

function baoCao(overrides: Partial<ReportDto> = {}): ReportDto {
  return {
    id: 7,
    name: 'Doanh thu quý IV',
    source: 'datamodel',
    sourceName: 'Bán hàng',
    datamodelId: 3,
    chartType: null,
    config: null,
    modelConfig: null,
    canvas: null,
    creatorName: 'Ai đó',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...mau,
    ...overrides,
  } as ReportDto;
}

async function mo(role: TenantRole, report: Partial<ReportDto> = {}): Promise<void> {
  mau = report;

  const auth = {
    status: 'authenticated',
    user: { id: 1, email: 'a@b.com', fullName: 'A', platformRole: 'user' },
    tenant: null,
    role,
    memberships: [],
    login: async () => ({}) as never,
    logout: async () => undefined,
    markPasswordChanged: () => undefined,
  } as unknown as AuthContextValue;

  // `retry: false`: `GET /v1/permissions` không có ai trả lời trong jsdom, và
  // `usePermissions` cố ý rơi về `matrixForRole(role)` — đúng bảng mà mục
  // sidebar và cổng route cũng đọc. Ba lần thử lại chỉ làm ca này chậm đi.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/reports/7']}>
          <Routes>
            <Route path="/reports/:reportId" element={<ReportViewPage />} />
            <Route path="/reports/:reportId/edit" element={<p>TRINH DUNG</p>} />
            <Route path="/reports" element={<p>DANH SACH</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );

  await screen.findByTitle('Doanh thu quý IV');
}

const nutSua = (): HTMLElement | null => screen.queryByRole('button', { name: 'Chỉnh sửa' });

describe('ReportViewPage — trang xem, và nút vào trình dựng', () => {
  it('viewer MỞ ĐƯỢC báo cáo nhưng không thấy nút Chỉnh sửa', async () => {
    // Mục Báo cáo là mục nội dung DUY NHẤT của viewer. Trang này mà gác quyền
    // thì cả mục ấy thành một danh sách không mở được gì.
    await mo('viewer');

    expect(screen.getByText('Doanh thu quý IV')).toBeInTheDocument();
    expect(nutSua()).toBeNull();
  });

  it('admin thấy nút, và bấm là sang trình dựng', async () => {
    await mo('admin');

    const nut = nutSua();
    expect(nut).toBeInTheDocument();

    nut?.click();
    expect(await screen.findByText('TRINH DUNG')).toBeInTheDocument();
  });

  it('creator cũng thấy nút — họ là người dựng báo cáo', async () => {
    await mo('creator');
    expect(nutSua()).toBeInTheDocument();
  });

  it('báo cáo dựng trên BỘ DỮ LIỆU: không có nút, và NÓI vì sao', async () => {
    // Trình dựng đọc cấu hình dạng ID trường của một mô hình, còn báo cáo §7.6
    // mang cấu hình dạng tên cột — admin cũng không sửa được nó ở đây. Một nút
    // vắng mặt không lời giải thích đọc ra như mất quyền.
    await mo('admin', { source: 'dataset', datamodelId: null });

    expect(nutSua()).toBeNull();
    expect(screen.getByText(/Dựng trên bộ dữ liệu/)).toBeInTheDocument();
  });

  it('viewer mở báo cáo trên bộ dữ liệu thì KHÔNG bị giải thích thừa', async () => {
    // Câu "chỉ xem" chỉ có nghĩa với người vốn sửa được. Nói với viewer là nói
    // về một khả năng họ chưa từng có.
    await mo('viewer', { source: 'dataset', datamodelId: null });

    expect(nutSua()).toBeNull();
    expect(screen.queryByText(/Dựng trên bộ dữ liệu/)).toBeNull();
  });

  it.each(['admin', 'creator', 'viewer'] as const)(
    '%s thấy nút Xuất — xuất ảnh chỉ cần quyền xem',
    async (role) => {
      // Xuất là chụp lại đúng thứ đang được xem, trong trình duyệt; không có con
      // số nào mà `report:read` chưa trả về. Nên không vai trò nào bị giấu nút.
      await mo(role, {
        chartType: 'bar',
        canvas: { pages: [{ id: 'p1', name: 'Trang 1', visuals: [], annotations: [] }] },
      });
      expect(screen.getByRole('button', { name: /Xuất/ })).toBeInTheDocument();
    },
  );

  it('báo cáo CHƯA có biểu đồ thì không có nút Xuất — không có gì để xuất', async () => {
    await mo('admin');
    expect(screen.queryByRole('button', { name: /Xuất/ })).toBeNull();
  });

  it('mũi tên ← luôn có mặt, và nói đúng nó đi đâu', async () => {
    // Trang đứng NGOÀI khung sidebar, nên đây là đường về duy nhất.
    await mo('viewer');

    const ra = screen.getByRole('button', { name: 'Quay lại danh sách báo cáo' });
    ra.click();
    expect(await screen.findByText('DANH SACH')).toBeInTheDocument();
  });
});
