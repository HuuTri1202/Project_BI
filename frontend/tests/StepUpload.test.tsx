import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepUpload } from '../src/features/datasets/wizard/StepUpload';
import type { UploadState } from '../src/features/datasets/wizard/useUppyS3';

/**
 * Bước 1 của wizard không được nói hai điều trái ngược cùng lúc.
 *
 * ─── Ảnh chụp màn hình của người dùng ───────────────────────────────────────
 *
 * Một file .xlsx hợp lệ bị bước phân tích từ chối, và màn hình hiện ĐỒNG THỜI:
 *
 *     ✓  Đã tải lên xong. Bấm Tiếp tục để chọn dữ liệu.
 *     ✗  File Excel hỏng hoặc được bảo vệ bằng mật khẩu.
 *
 * Cả hai câu đều đúng trong phạm vi của mình — tải lên THẬT SỰ xong, và bước sau
 * THẬT SỰ hỏng — nên không có `if` nào ở một chỗ nhìn ra mâu thuẫn. Nó chỉ lộ ra
 * khi hai component render cạnh nhau.
 *
 * `uppy={null}` là có chủ đích: nhánh đó vẽ khung chờ thay cho Dashboard, nên ca
 * test kiểm đúng phần thuộc về ta mà không phải dựng cả Uppy lên.
 */

const XONG: UploadState = { status: 'done', filename: 'bao-cao.xlsx', datasetId: 7 };

const MOI_BAM = /Đã tải lên xong/;

describe('StepUpload — lời mời bấm "Tiếp tục"', () => {
  it('hiện khi file đã lên và chưa ai từ chối nó', () => {
    render(<StepUpload uppy={null} state={XONG} rejected={false} />);

    expect(screen.queryByText(MOI_BAM)).not.toBeNull();
  });

  it('BIẾN MẤT khi bước sau đã từ chối file', () => {
    render(<StepUpload uppy={null} state={XONG} rejected />);

    // Người dùng vừa bấm đúng cái nút mà dòng này bảo họ bấm, và nó hỏng. Mời
    // lại là mời lặp lại một việc chắc chắn hỏng; câu nói rõ vì sao do wizard
    // render ngay bên dưới.
    expect(screen.queryByText(MOI_BAM)).toBeNull();
  });

  it('chưa tải xong thì không hiện, dù `rejected` thế nào', () => {
    const dangTai: UploadState = { status: 'uploading', filename: 'bao-cao.xlsx', progress: 40 };

    render(<StepUpload uppy={null} state={dangTai} rejected={false} />);

    expect(screen.queryByText(MOI_BAM)).toBeNull();
  });
});
