import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/features/datasets/api';
import { useUppyS3 } from '../src/features/datasets/wizard/useUppyS3';

/**
 * Test hồi quy cho MỘT lỗi cụ thể — §7.2.
 *
 * ─── Lỗi đã xảy ra ──────────────────────────────────────────────────────────
 *
 * Bản đầu của `useUppyS3` dựng Uppy một lần rồi cất vào `useRef`, và dọn bằng
 * `useEffect(() => () => uppy.destroy(), [])`. StrictMode ở chế độ dev chạy
 * mount -> unmount -> mount, nên:
 *
 *   mount    tạo Uppy A, cất vào ref
 *   unmount  cleanup chạy -> A.destroy()
 *   mount    ref VẪN giữ A (ref sống qua remount) -> dùng một Uppy đã chết
 *
 * Uppy đã destroy vẫn nhận file mà KHÔNG ném lỗi và KHÔNG tải gì. Triệu chứng:
 * thanh tiến trình đứng ở 0% mãi mãi, không một request nào rời trình duyệt,
 * không một dòng nào trong console. Người dùng chỉ thấy "không có gì xảy ra".
 *
 * ─── Vì sao bọc StrictMode là điểm mấu chốt ─────────────────────────────────
 *
 * Bỏ `<StrictMode>` ra khỏi ca này thì nó XANH kể cả với code hỏng, vì effect
 * chỉ chạy một lần. Đó chính là lý do lỗi lọt qua mọi thứ khác và chỉ lộ ra khi
 * mở trình duyệt: `main.tsx` bọc cả ứng dụng trong StrictMode.
 */

/** Đầu dò: gọi `addFile` ngay khi hook sẵn sàng, y như người dùng chọn file. */
function Probe({ file }: { file: File }): null {
  const { state, addFile } = useUppyS3(7);

  useEffect(() => {
    if (state.status === 'idle') addFile(file);
  }, [state.status, addFile, file]);

  return null;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useUppyS3 dưới StrictMode', () => {
  it('vẫn thật sự bắt đầu tải sau khi StrictMode gắn lại component', async () => {
    // Nếu Uppy bị destroy ở lần unmount giả lập, hàm này KHÔNG BAO GIỜ được gọi:
    // Uppy nhận file rồi im lặng. Đó chính là lỗi mà ca này canh.
    const createUpload = vi
      .spyOn(api, 'createUpload')
      .mockResolvedValue({
        datasetId: 42,
        uploadUrl: 'http://localhost:9000/bi-datasets/t1/w7/abc.csv',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });

    const file = new File(['a,b\n1,2'], 'so-lieu.csv', { type: 'text/csv' });

    render(
      <StrictMode>
        <Probe file={file} />
      </StrictMode>,
    );

    // `autoProceed` lên lịch việc tải sau 4ms, rồi Uppy gọi
    // `getUploadParameters` -> `api.createUpload`.
    await waitFor(() => expect(createUpload).toHaveBeenCalled(), { timeout: 3000 });

    expect(createUpload).toHaveBeenCalledWith({
      workspaceId: 7,
      filename: 'so-lieu.csv',
      fileSize: file.size,
    });
  });

  it('file sai đuôi bị chặn ở client, KHÔNG tốn một vòng mạng nào', async () => {
    // §7.3 phía client. Kiểm ngay tại chỗ là khác biệt thật giữa "báo lỗi tức
    // thì" và "chờ tải xong 50MB rồi mới biết bị từ chối".
    const createUpload = vi.spyOn(api, 'createUpload');

    const file = new File(['noi dung'], 'tai-lieu.pdf', { type: 'application/pdf' });

    render(
      <StrictMode>
        <Probe file={file} />
      </StrictMode>,
    );

    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(createUpload).not.toHaveBeenCalled();
  });
});
