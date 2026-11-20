import type { DatasetDetailDto } from '@bi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/features/datasets/api';
import { CapNhatDuLieu } from '../src/features/datasets/CapNhatDuLieu';

/**
 * Hộp "Cập nhật dữ liệu bằng tệp mới" — §B2.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Bước ĐỐI CHIẾU CỘT, và chỉ nó. Thay dữ liệu là thao tác không có đường lùi:
 * tệp cũ đã bị thay, bảng kho đã bị ghi đè, và mô hình với báo cáo thì trỏ tới
 * cột theo TÊN. Backend cũng chặn tệp thiếu cột (`kiemCapNhat`), nhưng chặn ở
 * đó nghĩa là người dùng chờ xong một lần tải tệp 50MB để nhận một câu 400.
 */

vi.mock('../src/features/datasets/api', () => ({
  xinChoCapNhat: vi.fn(),
  dayTepLen: vi.fn(),
  analyzeDataset: vi.fn(),
  commitDatasets: vi.fn(),
}));

const xinChoCapNhat = vi.mocked(api.xinChoCapNhat);
const dayTepLen = vi.mocked(api.dayTepLen);
const analyzeDataset = vi.mocked(api.analyzeDataset);
const commitDatasets = vi.mocked(api.commitDatasets);

const COT = ['Mã đơn', 'Ngày bán', 'Chi nhánh', 'Thành tiền'];

function bo(part: Partial<DatasetDetailDto> = {}): DatasetDetailDto {
  return {
    id: 7,
    name: 'don-hang',
    source: 'file',
    sheetName: 'Sheet1',
    columns: COT.map((name, i) => ({ name, ordinal: i })),
    ...part,
  } as unknown as DatasetDetailDto;
}

/** Kết quả phân tích giả, chỉ đủ phần `CapNhatDuLieu` đọc. */
function phanTich(cot: string[], sheets = ['Sheet1']): unknown {
  return {
    sheets: sheets.map((name) => ({
      name,
      columns: cot.map((sourceName, columnIndex) => ({ sourceName, columnIndex })),
    })),
  };
}

async function chonTep(cot: string[], sheets?: string[]): Promise<void> {
  analyzeDataset.mockResolvedValue(phanTich(cot, sheets) as never);
  render(<CapNhatDuLieu dataset={bo()} onXong={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật dữ liệu' }));

  const input = screen.getByLabelText('Chọn tệp mới');
  fireEvent.change(input, {
    target: { files: [new File(['a,b'], 'thang-11.csv', { type: 'text/csv' })] },
  });
  await waitFor(() => expect(analyzeDataset).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  xinChoCapNhat.mockResolvedValue({ datasetId: 7, uploadUrl: 'https://s3/x', expiresAt: '' });
  dayTepLen.mockResolvedValue(undefined);
  commitDatasets.mockResolvedValue([]);
});

describe('CapNhatDuLieu', () => {
  it('bộ dữ liệu từ CSDL thì không có nút — nó không có tệp để thay', () => {
    const { container } = render(
      <CapNhatDuLieu dataset={bo({ source: 'connection' })} onXong={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('đủ cột thì cho thay, và nói ra là đủ', async () => {
    await chonTep(COT);

    expect(await screen.findByText(/Đủ 4 cột đang dùng/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thay dữ liệu' })).toBeEnabled();
  });

  it('THÊM cột vẫn cho thay, và kể tên cột mới', async () => {
    await chonTep([...COT, 'Khuyến mãi']);

    expect(await screen.findByText(/Khuyến mãi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thay dữ liệu' })).toBeEnabled();
  });

  /*
   * Ca quan trọng nhất: nút phải KHOÁ, và câu cảnh báo phải GỌI TÊN cột đã mất.
   * "Tệp không hợp lệ" ở đây là một câu không ai sửa được.
   */
  it('THIẾU cột thì khoá nút và gọi tên cột đã mất', async () => {
    await chonTep(['Mã đơn', 'Ngày bán']);

    expect(await screen.findByRole('alert')).toHaveTextContent('Chi nhánh');
    expect(screen.getByRole('alert')).toHaveTextContent('Thành tiền');
    expect(screen.getByRole('button', { name: 'Thay dữ liệu' })).toBeDisabled();
  });

  it('bấm Thay thì gửi đúng một sheet kèm cờ cập nhật', async () => {
    await chonTep(COT);
    fireEvent.click(await screen.findByRole('button', { name: 'Thay dữ liệu' }));

    await waitFor(() =>
      expect(commitDatasets).toHaveBeenCalledWith(7, {
        name: 'don-hang',
        sheets: ['Sheet1'],
        capNhat: true,
      }),
    );
  });

  /*
   * Tệp tháng sau gần như luôn giữ nguyên tên sheet. Đoán đúng ở đây tiết kiệm
   * một cú bấm mà không giấu lựa chọn nào — ô chọn vẫn hiện đủ các sheet.
   */
  it('nhiều sheet thì chọn sẵn sheet đang dùng', async () => {
    await chonTep(COT, ['Tháng 10', 'Sheet1', 'Ghi chú']);

    await waitFor(() => expect(screen.getByLabelText('Sheet')).toHaveValue('Sheet1'));
  });
});
