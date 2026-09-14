import { DATAMODEL_ERROR_CODES } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelReportPreviewInput } from '../src/features/datamodels/api';
import { useInvalidateDataModel, useModelReportPreview } from '../src/features/datamodels/hooks';
import { dataModelKeys } from '../src/features/datamodels/keys';
import {
  announceModelChanged,
  resetModelChannelForTest,
  syncModelChangesAcrossTabs,
} from '../src/features/datamodels/modelChanges';
import { EditModelLink } from '../src/features/reports/builder/EditModelLink';
import { apiClient } from '../src/services/apiClient';

/**
 * Nút "Sửa mô hình" trong cột Mô hình dữ liệu, và tin báo giữa các tab — §10.19.
 *
 *   "ở phần mục mô hình dữ liệu này nên có nút bấm để đi đến datamodel để
 *    người dùng có thể chỉnh sửa"
 *
 * Nút mở trang mô hình ở TAB MỚI để khung đang dựng không mất. Cái giá của tab
 * mới là hai cache react-query tách rời — nên phần lớn file này kiểm con đường
 * đưa "mô hình vừa đổi" từ tab này sang tab kia, và kiểm rằng nó KHÔNG dội ngược
 * lại thành một vòng lặp.
 *
 * "Tab kia" ở đây là một `BroadcastChannel` thứ hai cùng tên: với trình duyệt,
 * hai đối tượng kênh trong hai tab hay trong cùng một tab là như nhau.
 */

const CHANNEL_NAME = 'bi.datamodels.changed';

let otherTab: BroadcastChannel;
let heardByOtherTab: unknown[];

/** Đợi tin đi qua kênh — `BroadcastChannel` giao tin ở một lượt sự kiện sau. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  resetModelChannelForTest();
  heardByOtherTab = [];
  otherTab = new BroadcastChannel(CHANNEL_NAME);
  otherTab.addEventListener('message', (e) => heardByOtherTab.push((e as MessageEvent).data));
});

afterEach(() => {
  otherTab.close();
  resetModelChannelForTest();
});

describe('Tin "mô hình vừa đổi" giữa các tab', () => {
  it('lưu ở tab này thì tab kia nghe thấy', async () => {
    announceModelChanged();
    await flush();

    expect(heardByOtherTab).toHaveLength(1);
  });

  it('tin nhận từ tab kia làm mới bảng trường, trạng thái Cube VÀ số liệu các ô', async () => {
    const queryClient = new QueryClient();
    const keys = [
      dataModelKeys.fields(83),
      dataModelKeys.explorerStatus(83),
      dataModelKeys.reportPreview(83, { dimensionId: 1 }),
    ];
    for (const key of keys) queryClient.setQueryData(key, { cu: true });
    // Thứ KHÔNG thuộc mô hình không được bị kéo theo.
    queryClient.setQueryData(['reports', 'detail', 29], { cu: true });

    const stop = syncModelChangesAcrossTabs(queryClient);
    otherTab.postMessage({ type: 'changed' });
    await flush();

    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['reports', 'detail', 29])?.isInvalidated).toBe(false);
    stop();
  });

  it('tab NHẬN tin không phát lại — hai tab không đá tin qua lại mãi', async () => {
    const queryClient = new QueryClient();
    const stop = syncModelChangesAcrossTabs(queryClient);

    otherTab.postMessage({ type: 'changed' });
    await flush();

    expect(heardByOtherTab).toHaveLength(0);
    stop();
  });

  it('tab tự lưu KHÔNG tự nhận tin của mình — một lần lưu là một lần dọn cache', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const stop = syncModelChangesAcrossTabs(queryClient);

    announceModelChanged();
    await flush();

    expect(spy).not.toHaveBeenCalled();
    stop();
  });

  it('huỷ nghe thì thôi dọn', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    syncModelChangesAcrossTabs(queryClient)();

    otherTab.postMessage({ type: 'changed' });
    await flush();

    expect(spy).not.toHaveBeenCalled();
  });

  it('MỌI thao tác ghi mô hình phát tin, vì chúng cùng đi qua `useInvalidateDataModel`', async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useInvalidateDataModel(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await result.current();
    await flush();

    expect(heardByOtherTab).toEqual([{ type: 'changed' }]);
  });

  it('tin không mang dữ liệu nào — tab nhận tự hỏi lại server bằng quyền của nó', async () => {
    announceModelChanged();
    await flush();

    expect(heardByOtherTab).toEqual([{ type: 'changed' }]);
  });
});

/**
 * Mô hình bị sửa trên MÁY KHÁC thì không có tin nào qua kênh cả. Câu trả lời
 * 400 `DataModelFieldUnknown` của một ô là bằng chứng duy nhất rằng bảng trường
 * đã cũ — và câu lỗi đi kèm bảo người dùng "chọn trường khác ở cột Mô hình dữ
 * liệu", nên cột đó phải thôi liệt kê đúng cái trường vừa mất.
 */
describe('Ô báo trường không còn → trình dựng tự đọc lại bảng trường', () => {
  function loi400(code: string): AxiosError {
    return new AxiosError('400', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
      data: { error: code, message: 'Thước đo đã chọn không còn trong mô hình.' },
    });
  }

  async function chay(code: string): Promise<{ biDanhDauCu: boolean | undefined }> {
    vi.spyOn(apiClient, 'post').mockRejectedValue(loi400(code));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(dataModelKeys.fields(83), { dimensions: [], measures: [] });

    const { result } = renderHook(
      () =>
        useModelReportPreview(83, {
          chartType: 'bar',
          config: { dimensionId: 1, measureId: 2, limit: 20, seriesDimensionId: null },
        } as ModelReportPreviewInput),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    return { biDanhDauCu: queryClient.getQueryState(dataModelKeys.fields(83))?.isInvalidated };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('mã FIELD_UNKNOWN → bảng trường của mô hình bị đánh dấu cũ để đọc lại', async () => {
    expect((await chay(DATAMODEL_ERROR_CODES.FIELD_UNKNOWN)).biDanhDauCu).toBe(true);
  });

  it('lỗi KHÁC (Cube chưa chạy) không đụng tới bảng trường', async () => {
    expect((await chay(DATAMODEL_ERROR_CODES.CUBE_UNAVAILABLE)).biDanhDauCu).toBe(false);
  });
});

describe('EditModelLink', () => {
  function ve(canEdit: boolean): HTMLAnchorElement {
    render(
      <MemoryRouter>
        <EditModelLink modelId={83} canEdit={canEdit} />
      </MemoryRouter>,
    );
    return screen.getByRole('link');
  }

  it('là một liên kết THẬT tới trang mô hình, mở ở tab mới', () => {
    const link = ve(true);

    expect(link.getAttribute('href')).toBe('/datamodels/83');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('nói trước rằng nó mở tab mới, cả với trình đọc màn hình', () => {
    const link = ve(true);

    expect(link.textContent).toContain('Sửa mô hình');
    expect(link.textContent).toContain('(mở ở tab mới)');
  });

  it('không có quyền sửa thì gọi đúng tên việc làm được: xem', () => {
    const link = ve(false);

    expect(link.textContent).toContain('Xem mô hình');
    expect(link.textContent).not.toContain('Sửa');
  });
});
