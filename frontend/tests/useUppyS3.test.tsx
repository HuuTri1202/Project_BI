import { render, waitFor } from '@testing-library/react';
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
 *
 * ─── Vì sao gọi thẳng `uppy.addFile` chứ không qua giao diện ────────────────
 *
 * Giao diện giờ là `<Dashboard>` của Uppy. Render nó trong jsdom rồi giả lập
 * kéo thả sẽ là kiểm chính Dashboard — thứ Uppy đã tự kiểm. Ca này chỉ quan tâm
 * một điều: instance mà hook giao ra có CÒN SỐNG sau khi StrictMode gắn lại
 * component hay không.
 */

/** Đầu dò: đưa file vào Uppy ngay khi instance sẵn sàng. */
function Probe({ file }: { file: File }): null {
  const { uppy } = useUppyS3(7);

  useEffect(() => {
    if (!uppy) return;
    try {
      uppy.addFile({ name: file.name, type: file.type, data: file });
    } catch {
      // `addFile` NÉM khi file vi phạm `restrictions`. Dashboard bắt lỗi này rồi
      // hiện thông báo ngay trên giao diện; ở đây chỉ cần nuốt nó để đầu dò
      // không làm hỏng cả ca test — thứ đang được kiểm là `createUpload` có
      // được gọi hay không.
    }
  }, [uppy, file]);

  return null;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useUppyS3 dưới StrictMode', () => {
  it('instance vẫn SỐNG và thật sự bắt đầu tải sau khi StrictMode gắn lại', async () => {
    // Nếu Uppy bị destroy ở lần unmount giả lập, hàm này KHÔNG BAO GIỜ được gọi:
    // Uppy nhận file rồi im lặng. Đó chính là lỗi mà ca này canh.
    const createUpload = vi.spyOn(api, 'createUpload').mockResolvedValue({
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

  it('file sai đuôi bị Uppy chặn, KHÔNG tốn một vòng mạng nào', async () => {
    // §7.3 phía client, giờ do `restrictions.allowedFileTypes` của Uppy lo.
    // Kiểm ngay tại chỗ là khác biệt thật giữa "báo lỗi tức thì" và "chờ tải
    // xong 50MB rồi mới biết bị từ chối".
    const createUpload = vi.spyOn(api, 'createUpload');

    const file = new File(['noi dung'], 'tai-lieu.pdf', { type: 'application/pdf' });

    render(
      <StrictMode>
        <Probe file={file} />
      </StrictMode>,
    );

    await new Promise((r) => setTimeout(r, 400));
    expect(createUpload).not.toHaveBeenCalled();
  });
});
