import type { ReportDataDto } from '@bi/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as chatApi from '../src/features/chat/api';
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

vi.mock('../src/features/chat/api', () => ({ dienDatLai: vi.fn(), hieuCauHoi: vi.fn() }));

const dienDatLai = vi.mocked(chatApi.dienDatLai);
const hieuCauHoi = vi.mocked(chatApi.hieuCauHoi);

beforeEach(() => {
  /*
   * Mặc định: CHƯA cấu hình mô hình, nên lời gọi hỏng và câu mẫu ở lại.
   *
   * Đó là trạng thái của một máy chưa điền `LLM_API_KEY` — tức là trạng thái mà
   * phần lớn ca ở đây muốn kiểm, và cũng là trạng thái khung phải chạy được
   * trong đó. Ca nào cần bản viết lại thì tự khai `mockResolvedValue`.
   */
  dienDatLai.mockReset();
  dienDatLai.mockRejectedValue(new Error('chưa cấu hình'));

  // Mặc định: mô hình KHÔNG được hỏi — đúng trạng thái máy chưa có khoá, và
  // cũng là trạng thái mà mọi ca về phép so từ khoá muốn kiểm.
  hieuCauHoi.mockReset();
  hieuCauHoi.mockResolvedValue({ chon: null, daHoi: false });
});

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
    // Tiêu đề nói rõ đang đọc gì — đó là cách người dùng biết phạm vi.
    expect(screen.getByText('Đang đọc Kho dữ liệu')).toBeInTheDocument();
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

    const mau = 'Khu vực nào có Doanh thu cao nhất?';
    expect(screen.getByRole('button', { name: mau })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đơn hàng Q4' }));
    expect(screen.queryByRole('button', { name: mau })).toBeNull();
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

describe('Lớp viết lại câu không được làm hỏng câu trả lời', () => {
  it('viết lại THÀNH CÔNG -> khung thay bằng câu mượt hơn', async () => {
    dienDatLai.mockResolvedValue('Miền Nam dẫn đầu với 500 Doanh thu.');
    dung([{ ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() }]);
    fireEvent.click(nutMo());

    hoi('khu vực nào cao nhất');

    // Câu mẫu hiện NGAY, trước khi lời gọi về — người dùng không chờ mạng để
    // đọc một con số máy họ đã tính xong.
    expect(screen.getByText(/Cao nhất là Miền Nam/)).toBeInTheDocument();

    expect(await screen.findByText('Miền Nam dẫn đầu với 500 Doanh thu.')).toBeInTheDocument();
  });

  it('viết lại THẤT BẠI -> câu mẫu ở lại, không có hộp lỗi nào', async () => {
    /*
     * Mất mạng, hết lượt, chưa có khoá — tất cả đi qua đây. Một hộp đỏ ở chỗ
     * này là biến một lớp trang trí thành thứ làm hỏng khung hỏi đáp.
     */
    dienDatLai.mockRejectedValue(new Error('mất mạng'));
    dung([{ ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() }]);
    fireEvent.click(nutMo());

    hoi('khu vực nào cao nhất');

    // `act` bất đồng bộ: nó xả hết microtask RỒI mới áp cập nhật. Một
    // `await Promise.resolve()` trần thì không áp — và khi đó bài test xanh vì
    // React chưa kịp làm gì, chứ không vì code đúng.
    await act(async () => undefined);

    expect(screen.getByText(/Cao nhất là Miền Nam/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bản viết lại VỀ MUỘN vá vào ĐÚNG bong bóng của nó', async () => {
    /*
     * Hỏi câu thứ hai trong lúc câu thứ nhất còn đang bay.
     *
     * Khung giữ cả cuộc trò chuyện, nên cả hai bong bóng đều còn trên màn hình.
     * Vá "tin cuối cùng" sẽ dán câu trả lời của câu MỘT xuống dưới câu hỏi HAI
     * — một câu đúng, cho một câu hỏi khác, ở chỗ không ai nghi ngờ. Nên tin
     * được vá theo `id`, không theo vị trí.
     */
    let giaiPhong: (cau: string) => void = () => undefined;
    dienDatLai
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            giaiPhong = resolve;
          }),
      )
      .mockResolvedValueOnce('Tổng là 800 Doanh thu.');

    dung([{ ten: 'Doanh thu theo Khu vực', duKien: [], bang: bang() }]);
    fireEvent.click(nutMo());

    hoi('khu vực nào cao nhất');
    hoi('tổng doanh thu');
    expect(await screen.findByText('Tổng là 800 Doanh thu.')).toBeInTheDocument();

    // Giờ mới cho câu một về, và XẢ hết để React áp mọi cập nhật còn chờ.
    // Thiếu `act` ở đây thì bài test xanh kể cả khi luật vá sai — đã kiểm bằng
    // đột biến.
    await act(async () => {
      giaiPhong('Miền Nam dẫn đầu với 500 Doanh thu.');
    });

    // Bản viết lại của câu MỘT nằm ở bong bóng của câu một...
    const bong = screen.getAllByText(/Doanh thu\.$/);
    expect(bong[0]).toHaveTextContent('Miền Nam dẫn đầu với 500 Doanh thu.');
    // ...và câu HAI không bị nó đè lên.
    expect(bong[1]).toHaveTextContent('Tổng là 800 Doanh thu.');
  });
});

describe('Chưa hiểu thì phải mở ra đường đi tiếp', () => {
  /*
   * Một câu "tôi chưa hiểu" trơ trọi là ngõ cụt: người dùng không biết mình gõ
   * sai ở đâu, thử thêm một câu nữa cũng chưa hiểu, rồi đóng khung lại. Thứ
   * chặn chuyện đó là mấy câu BẤM ĐƯỢC lấy từ chính dữ kiện trang đang giữ.
   */
  it('câu chưa hiểu kèm gợi ý bấm được, lấy từ dữ kiện gần nhất', () => {
    dung([
      { ten: 'Đơn hàng', duKien: [{ nhan: 'Số dòng của bảng Đơn hàng', gia: '120' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số cột của bảng Khách hàng', gia: '8' }] },
    ]);
    fireEvent.click(nutMo());

    // Chip đang chọn là "Đơn hàng", và nó không có dữ kiện nào về cột — nên
    // `traLoi` cố ý không đoán, còn gợi ý thì phải với sang nguồn bên cạnh.
    hoi('cột thì sao');

    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    const goiY = screen.getByRole('button', { name: 'Số cột của bảng Khách hàng?' });

    // Bấm vào là nó điền thẳng vào ô nhập — không phải chép tay lại.
    fireEvent.click(goiY);
    expect(screen.getByLabelText('Câu hỏi')).toHaveValue('Số cột của bảng Khách hàng?');
  });

  it('không có dữ kiện nào gần thì vẫn gợi ý câu mẫu của nguồn đang chọn', () => {
    dung([{ ten: 'Đơn hàng', duKien: [{ nhan: 'Số dòng của Đơn hàng', gia: '120' }] }]);
    fireEvent.click(nutMo());

    // "zzz" không trùng từ nào với dữ kiện nào.
    hoi('zzz qqq');

    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Số dòng của Đơn hàng?' })).toBeInTheDocument();
  });
});

describe('Chip chọn nguồn', () => {
  /*
   * Tên nguồn KHÔNG duy nhất — ba mô hình cùng tên "Global-Superstore" trong
   * một workspace là chuyện có thật. Hai chip giống nhau từng chữ thì người
   * dùng không chỉ ra được mình đang hỏi cái nào, và React còn gộp chúng làm
   * một vì khoá trùng.
   */
  it('tên nguồn trùng nhau thì chip được đánh số', () => {
    dung([
      { ten: 'Global-Superstore', duKien: [{ nhan: 'Số bảng trong mô hình A', gia: '4' }] },
      { ten: 'Global-Superstore', duKien: [{ nhan: 'Số bảng trong mô hình B', gia: '2' }] },
      { ten: 'doanh thu', duKien: [{ nhan: 'Số bảng trong mô hình C', gia: '9' }] },
    ]);
    fireEvent.click(nutMo());

    expect(screen.getByRole('button', { name: 'Global-Superstore (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Global-Superstore (2)' })).toBeInTheDocument();
    // Tên không trùng thì KHÔNG đánh số — thêm "(1)" vào một chip đứng một mình
    // chỉ làm người đọc đi tìm cái "(2)" không có.
    expect(screen.getByRole('button', { name: 'doanh thu' })).toBeInTheDocument();
  });

  /*
   * Chip thứ hai phải chọn được RIÊNG. Khoá trùng làm React coi hai chip là một
   * phần tử, và câu trả lời nói về mô hình kia bằng những con số có thật.
   */
  it('chip trùng tên vẫn trỏ tới đúng nguồn của nó', () => {
    dung([
      { ten: 'Global-Superstore', duKien: [{ nhan: 'Số bảng trong mô hình này', gia: '4' }] },
      { ten: 'Global-Superstore', duKien: [{ nhan: 'Số bảng trong mô hình này', gia: '2' }] },
    ]);
    fireEvent.click(nutMo());

    fireEvent.click(screen.getByRole('button', { name: 'Global-Superstore (2)' }));
    hoi('số bảng trong mô hình này');

    expect(screen.getByText('Số bảng trong mô hình này: 2.')).toBeInTheDocument();
  });
});

describe('Mô hình chọn nhãn khi phép so từ khoá trượt', () => {
  const trang: Nguon[] = [
    {
      ten: 'Đơn hàng Q4',
      duKien: [
        { nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431', luuY: 'tệp đã bị cắt khi tải lên' },
        { nhan: 'Dung lượng của Đơn hàng Q4', gia: '4,2 MB' },
      ],
    },
  ];

  /*
   * "nặng bao nhiêu" không trùng từ nào với "Dung lượng của Đơn hàng Q4", nên
   * phép so từ khoá trượt — đúng cảnh lớp này sinh ra để xử.
   */
  it('bong bóng "chưa hiểu" tự nâng cấp thành câu trả lời', async () => {
    hieuCauHoi.mockResolvedValue({ chon: 1, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái này nặng bao nhiêu');
    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();

    expect(await screen.findByText('Dung lượng của Đơn hàng Q4: 4,2 MB.')).toBeInTheDocument();
    expect(screen.queryByText(/Tôi chưa hiểu câu này/)).not.toBeInTheDocument();
  });

  /*
   * ⚠️ Mô hình chỉ CHỌN được nhãn. Câu chữ và con số vẫn do `traLoiTheoDuKien`
   * dựng — kể cả `luuY`, điều kiện của con số. Mất `luuY` ở nhánh này là con số
   * mất điều kiện của nó đúng ở chỗ không ai nghĩ là phải kiểm.
   */
  it('câu dựng ra vẫn mang điều kiện của con số', async () => {
    hieuCauHoi.mockResolvedValue({ chon: 0, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái này to cỡ nào');

    expect(
      await screen.findByText('Số dòng của Đơn hàng Q4: 12.431. — tệp đã bị cắt khi tải lên'),
    ).toBeInTheDocument();
  });

  it('chỉ gửi NHÃN lên, không gửi giá trị nào', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái này nặng bao nhiêu');

    const than = JSON.stringify(hieuCauHoi.mock.calls[0]?.[0]);
    expect(than).toContain('Dung lượng của Đơn hàng Q4');
    expect(than).not.toContain('4,2 MB');
    expect(than).not.toContain('12.431');
  });

  /*
   * "Đã đọc hết và không có" là một câu KHÁC HẲN "tôi chưa hiểu câu này": một
   * câu nói trang này không có số liệu đó, câu kia nói người dùng gõ sai.
   */
  it('mô hình đọc hết mà không có thì nói đúng câu đó', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('giá cổ phiếu hôm nay');

    expect(await screen.findByText(/đã đọc hết số liệu/)).toBeInTheDocument();
  });

  it('máy chưa cấu hình mô hình thì giữ nguyên câu "chưa hiểu"', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: false });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('giá cổ phiếu hôm nay');
    await act(async () => {
      await Promise.resolve();
    });

    // Chưa ai đọc gì cả, nên không được khẳng định là đã đọc hết.
    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    expect(screen.queryByText(/đã đọc hết số liệu/)).not.toBeInTheDocument();
  });

  it('gọi hỏng thì bong bóng "chưa hiểu" vẫn ở đó', async () => {
    hieuCauHoi.mockRejectedValue(new Error('mất mạng'));
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái này nặng bao nhiêu');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
  });
});
