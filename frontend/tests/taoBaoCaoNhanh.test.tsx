import { AxiosError } from 'axios';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaoBaoCaoNhanh, type BoChoBaoCao } from '../src/features/datasets/taoBaoCaoNhanh';

/**
 * "Tạo báo cáo" ngay từ một bộ dữ liệu đã có — vá B2.
 *
 * Hành trình e2e `bao-cao-tu-bo.spec.ts` canh đường đi THẬT (menu dòng → mô
 * hình ngầm → trình dựng). Bộ này canh hai nhánh mà e2e không dựng được rẻ:
 * bộ dữ liệu CHƯA nạp vào kho phân tích, và lỗi từ máy chủ.
 *
 * Nhánh "chưa nạp" quan trọng hơn vẻ ngoài của nó: `POST /datamodels` trả 409
 * `DatasetNotLoaded` ở đó, và dội mã lỗi của tầng dưới lên mặt người dùng thì
 * họ không biết phải làm gì. Chốt trước ở client để câu thông báo nói đúng việc
 * cần làm.
 */

const taoMoHinh = vi.fn();
const dieuHuong = vi.fn();

vi.mock('../src/features/datamodels/api', () => ({
  createDataModel: (input: unknown) => taoMoHinh(input) as unknown,
}));

vi.mock('react-router-dom', async () => {
  const thuc = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...thuc, useNavigate: () => dieuHuong };
});

const BO: BoChoBaoCao = { id: 7, name: 'ban-hang', workspaceId: 2, loadStatus: 'loaded' };

function Thu({ bo }: { bo: BoChoBaoCao }): React.ReactElement {
  const t = useTaoBaoCaoNhanh();
  return (
    <MemoryRouter>
      <button type="button" onClick={() => t.chay(bo)}>
        Tạo báo cáo
      </button>
      {t.loi !== null && <p role="alert">{t.loi}</p>}
    </MemoryRouter>
  );
}

beforeEach(() => {
  taoMoHinh.mockReset();
  dieuHuong.mockReset();
});

describe('bộ dữ liệu đã nạp', () => {
  it('dựng mô hình trên ĐÚNG bộ đó rồi vào trình dựng', async () => {
    taoMoHinh.mockResolvedValue({ id: 42 });
    render(<Thu bo={BO} />);

    await userEvent.click(screen.getByRole('button'));

    // `workspaceId` gửi TƯỜNG MINH: nhánh dự phòng của backend chọn workspace
    // đầu tiên theo tên, nên mô hình sẽ rơi vào workspace khác và biến mất ngay
    // sau khi tạo.
    expect(taoMoHinh).toHaveBeenCalledWith({
      workspaceId: 2,
      name: 'ban-hang',
      datasetIds: [7],
    });
    expect(dieuHuong).toHaveBeenCalledWith('/datamodels/42/report/new');
  });
});

describe('bộ dữ liệu CHƯA nạp vào kho phân tích', () => {
  it('không gọi API, và nói đúng việc cần làm', async () => {
    render(<Thu bo={{ ...BO, loadStatus: 'idle' }} />);

    await userEvent.click(screen.getByRole('button'));

    expect(taoMoHinh).not.toHaveBeenCalled();
    expect(dieuHuong).not.toHaveBeenCalled();
    const loi = screen.getByRole('alert').textContent ?? '';
    // Nói trạng thái hiện tại bằng đúng chữ người dùng thấy ở cột trạng thái…
    expect(loi).toContain('Chưa nạp');
    // …và nói nút cần bấm, chứ không chỉ nói là chưa được.
    expect(loi).toContain('Nạp vào kho phân tích');
  });

  it('đang nạp thì cũng chặn, với cùng một câu', async () => {
    render(<Thu bo={{ ...BO, loadStatus: 'running' }} />);
    await userEvent.click(screen.getByRole('button'));

    expect(taoMoHinh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Đang nạp');
  });
});

describe('máy chủ từ chối', () => {
  it('hiện câu lỗi của máy chủ, không điều hướng', async () => {
    // `AxiosError` THẬT, không phải một object trông giống: `getApiError` hỏi
    // `axios.isAxiosError` và coi mọi thứ khác là bug ở frontend — đo được bằng
    // chính lần chạy đầu của ca này, nó trả về "Giao diện gặp lỗi khi xử lý dữ
    // liệu" thay vì câu của máy chủ.
    taoMoHinh.mockRejectedValue(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 409,
        data: { error: 'LimitReached', message: 'Gói Miễn phí cho tối đa 1 mô hình.' },
      } as never),
    );
    render(<Thu bo={BO} />);

    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('alert').textContent).toContain('Gói Miễn phí');
    expect(dieuHuong).not.toHaveBeenCalled();
  });
});
