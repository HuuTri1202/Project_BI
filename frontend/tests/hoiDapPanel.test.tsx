import type { ReportDataDto } from '@bi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { NguCanhProvider } from '../src/features/chat/NguCanhProvider';
import { useKhaiNguCanh, type NguCanh, type Nguon } from '../src/features/chat/nguCanh';
import { THUOC_TINH_KHONG_XUAT } from '../src/services/danhDauXuat';

/**
 * Khung hỏi đáp nổi.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Phần tính toán đã có bộ riêng (`traLoi.test.ts`). Ở đây chỉ còn bốn thứ, và
 * cả bốn đều là cách khung có thể nói một điều không đúng:
 *
 *   1. Khung hiện ra trên trang chưa khai gì → nó mời người dùng hỏi rồi trả
 *      lời "không biết" cho mọi câu.
 *   2. Đổi chip mà câu trả lời cũ nằm lại → người đọc gán con số của nguồn này
 *      cho nguồn kia.
 *   3. Thiếu `data-khong-xuat` → khung chat dán vào mọi tệp PDF xuất ra.
 *   4. Câu chưa hiểu mà không nói rõ phạm vi → người dùng tưởng hệ thống không
 *      có dữ liệu đó, trong khi chỉ là khung không đọc tới trang đó.
 */

function bang(): ReportDataDto {
  return {
    rows: [
      { label: 'Miền Bắc', value: 300 },
      { label: 'Miền Nam', value: 500 },
    ],
    dimensionLabel: 'Khu vực',
    measureLabel: 'Doanh thu',
    grouped: false,
  };
}

/** Một trang giả lập: khai ngữ cảnh rồi thôi, đúng như trang thật làm. */
function TrangGiaLap({ nguon }: { nguon: Nguon[] }): React.ReactElement {
  const nguCanh = useMemo((): NguCanh => ({ trang: 'Kho dữ liệu', nguon }), [nguon]);
  useKhaiNguCanh(nguCanh);
  return <p>nội dung trang</p>;
}

function dung(nguon: Nguon[]): void {
  render(
    <MemoryRouter>
      <NguCanhProvider>
        <TrangGiaLap nguon={nguon} />
      </NguCanhProvider>
    </MemoryRouter>,
  );
}

const nutMo = (): HTMLElement =>
  screen.getByRole('button', { name: 'Mở khung hỏi đáp về dữ liệu đang xem' });

function hoi(cau: string): void {
  fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: cau } });
  fireEvent.click(screen.getByRole('button', { name: 'Hỏi' }));
}

describe('Khung chỉ hiện khi trang có gì để hỏi', () => {
  it('trang chưa khai nguồn nào -> KHÔNG có nút nào', () => {
    // Một khung mở ra để trả lời "tôi không biết gì về trang này" thì tệ hơn là
    // không có khung.
    dung([]);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('có nguồn -> hiện nút, bấm thì mở khung', () => {
    dung([{ ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] }]);

    fireEvent.click(nutMo());
    expect(screen.getByLabelText('Hỏi đáp về dữ liệu đang xem')).toBeInTheDocument();
    // Tiêu đề nói rõ đang hỏi về đâu — đó là cách người dùng biết phạm vi.
    expect(screen.getByText('Hỏi về Kho dữ liệu')).toBeInTheDocument();
  });
});

describe('Trả lời bằng dữ liệu đã khai', () => {
  it('tra cứu một dữ kiện', () => {
    dung([{ ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] }]);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');

    expect(screen.getByText(/12\.431/)).toBeInTheDocument();
  });

  it('câu chưa hiểu thì nói rõ PHẠM VI, không nói là không có dữ liệu', () => {
    /*
     * Khác biệt quan trọng: "tôi chỉ trả lời bằng số liệu trên trang này" khác
     * hẳn "hệ thống không có số liệu đó". Câu thứ hai sai, và nó khiến người
     * dùng bỏ đi tìm chỗ khác thay vì mở đúng trang.
     */
    dung([{ ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] }]);
    fireEvent.click(nutMo());

    hoi('thời tiết hôm nay thế nào');

    expect(screen.getByRole('status')).toHaveTextContent('chưa hiểu');
    expect(screen.getByRole('status')).toHaveTextContent('Kho dữ liệu');
  });
});

describe('Đổi nguồn', () => {
  const haiNguon: Nguon[] = [
    { ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() },
    { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
  ];

  it('một nguồn thì KHÔNG vẽ dãy chip', () => {
    // Một dãy chip có đúng một chip chỉ chiếm chỗ mà không nói thêm gì.
    dung([haiNguon[0]!]);
    fireEvent.click(nutMo());

    expect(screen.queryByRole('button', { name: 'Doanh thu theo Khu vực' })).toBeNull();
  });

  it('đổi chip thì XOÁ câu trả lời cũ', () => {
    /*
     * Ca quan trọng nhất của file. Câu trả lời cũ nói về nguồn KHÁC; để nó nằm
     * lại dưới một chip vừa đổi là mời người đọc gán nó cho nguồn mới — và con
     * số đó có thật, định dạng đúng, nên không có gì báo là đã nhầm.
     */
    dung(haiNguon);
    fireEvent.click(nutMo());

    hoi('khu vực nào cao nhất');
    expect(screen.getByText(/Miền Nam/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đơn hàng Q4' }));

    expect(screen.queryByText(/Miền Nam/)).toBeNull();
    expect(screen.getByText('Thử hỏi:')).toBeInTheDocument();
  });

  it('câu mẫu sinh theo NGUỒN đang chọn, không phải một danh sách cố định', () => {
    // Gợi ý "Khu vực nào cao nhất?" trên một nguồn không có biểu đồ là dạy người
    // dùng hỏi những câu chắc chắn nhận về "chưa hiểu".
    dung(haiNguon);
    fireEvent.click(nutMo());

    expect(screen.getByRole('button', { name: 'Khu vực nào cao nhất?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đơn hàng Q4' }));
    expect(screen.queryByRole('button', { name: 'Khu vực nào cao nhất?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Số dòng của Đơn hàng Q4?' })).toBeInTheDocument();
  });
});

describe('Không lọt vào ảnh xuất', () => {
  it('cả nút và khung đều mang data-khong-xuat', () => {
    // Trang báo cáo xuất được PNG/PDF và việc chụp quét cả vùng. Thiếu dấu này
    // thì mọi tệp xuất ra có một khung chat dán ở góc.
    dung([{ ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() }]);

    expect(nutMo()).toHaveAttribute(THUOC_TINH_KHONG_XUAT);

    fireEvent.click(nutMo());
    expect(screen.getByLabelText('Hỏi đáp về dữ liệu đang xem')).toHaveAttribute(
      THUOC_TINH_KHONG_XUAT,
    );
  });
});
