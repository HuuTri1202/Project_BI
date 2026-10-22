import type { ExplorerFieldDto, ExplorerFieldsDto, ReportDataDto } from '@bi/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as chatApi from '../src/features/chat/api';
import * as heThongHook from '../src/features/chat/nguCanhHeThong';
import * as trangThaiHook from '../src/features/chat/trangThai';
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

vi.mock('../src/features/chat/api', () => ({
  dienDatLai: vi.fn(),
  hieuCauHoi: vi.fn(),
  hoiTrenMoHinh: vi.fn(),
}));

/*
 * Lớp xuyên hệ thống bị thay bằng một hàm thường.
 *
 * Nó là HAI lời gọi react-query thật, nên để nguyên thì mọi ca ở đây phải dựng
 * một `QueryClientProvider` và chịu hai request mạng cho những ca chẳng liên
 * quan. Phần hỏi-đáp của nó đã có bộ riêng (`traLoi.test.ts`), hàm thuần,
 * không cần DOM; còn ở đây chỉ cần nói được "khung nhận bao nhiêu nguồn hệ
 * thống" — đúng thứ một mock khai ra được.
 */
vi.mock('../src/features/chat/nguCanhHeThong', () => ({ useNguCanhHeThong: vi.fn() }));

// Nhãn "có mô hình / ngoại tuyến" — một lời gọi react-query, thay bằng hàm
// thường vì phần lớn ca ở đây không nói gì về nó.
vi.mock('../src/features/chat/trangThai', () => ({ useCoMoHinh: vi.fn() }));

const dienDatLai = vi.mocked(chatApi.dienDatLai);
const hieuCauHoi = vi.mocked(chatApi.hieuCauHoi);
const useNguCanhHeThong = vi.mocked(heThongHook.useNguCanhHeThong);
const hoiTrenMoHinh = vi.mocked(chatApi.hoiTrenMoHinh);
const useCoMoHinh = vi.mocked(trangThaiHook.useCoMoHinh);

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

  // Mặc định: KHÔNG có nguồn xuyên hệ thống — đúng trạng thái của một viewer
  // (không có `dataset:read`) và của mọi ca chỉ nói về trang đang mở.
  useNguCanhHeThong.mockReset();
  useNguCanhHeThong.mockReturnValue([]);

  // Mặc định: đường đặt câu hỏi MỚI bị từ chối — đúng trạng thái của `viewer`,
  // người không có `datamodel:read` (migration 26).
  hoiTrenMoHinh.mockReset();
  hoiTrenMoHinh.mockRejectedValue(new Error('403'));

  // Mặc định: CHƯA cấu hình mô hình — đúng trạng thái của một máy mới clone về,
  // và là trạng thái mà khung buộc phải chạy đủ chức năng trong đó.
  useCoMoHinh.mockReset();
  useCoMoHinh.mockReturnValue(false);
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
function TrangGiaLap({
  nguon,
  moHinhId,
  truong,
  veBieuDo,
}: {
  nguon: Nguon[];
  moHinhId?: number;
  truong?: ExplorerFieldsDto;
  veBieuDo?: NguCanh['veBieuDo'];
}): React.ReactElement {
  const nguCanh = useMemo(
    (): NguCanh => ({
      trang: 'Kho dữ liệu',
      nguon,
      ...(moHinhId === undefined ? {} : { moHinhId }),
      ...(truong === undefined ? {} : { truong }),
      ...(veBieuDo === undefined ? {} : { veBieuDo }),
    }),
    [nguon, moHinhId, truong, veBieuDo],
  );
  useKhaiNguCanh(nguCanh);
  return <p>nội dung trang</p>;
}

function dung(
  nguon: Nguon[],
  moHinhId?: number,
  truong?: ExplorerFieldsDto,
  veBieuDo?: NguCanh['veBieuDo'],
): { doiMoHinh: (id: number) => void } {
  const { rerender } = render(
    <MemoryRouter>
      <NguCanhProvider>
        <TrangGiaLap nguon={nguon} moHinhId={moHinhId} truong={truong} veBieuDo={veBieuDo} />
      </NguCanhProvider>
    </MemoryRouter>,
  );
  return {
    doiMoHinh: (id: number) =>
      rerender(
        <MemoryRouter>
          <NguCanhProvider>
            <TrangGiaLap nguon={nguon} moHinhId={id} />
          </NguCanhProvider>
        </MemoryRouter>,
      ),
  };
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

  it('câu chưa hiểu thì nói rõ PHẠM VI, không nói là không có dữ liệu', async () => {
    /*
     * Khác biệt quan trọng: "tôi chỉ trả lời bằng số liệu trên trang này" khác
     * hẳn "hệ thống không có số liệu đó". Câu thứ hai sai, và nó khiến người
     * dùng bỏ đi tìm chỗ khác thay vì mở đúng trang.
     */
    dung([{ ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] }]);
    fireEvent.click(nutMo());

    hoi('thời tiết hôm nay thế nào');

    // Chờ ba chấm nhường chỗ: "chưa hiểu" chỉ được nói ra SAU khi mọi lớp mô
    // hình đã chạy xong — trước đó khung chưa biết nó hiểu hay không.
    await screen.findByText(/Tôi chưa hiểu câu này/);
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
  it('câu chưa hiểu kèm gợi ý bấm được, lấy từ dữ kiện gần nhất', async () => {
    dung([
      { ten: 'Đơn hàng', duKien: [{ nhan: 'Số dòng của bảng Đơn hàng', gia: '120' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số cột của bảng Khách hàng', gia: '8' }] },
    ]);
    fireEvent.click(nutMo());

    // Chip đang chọn là "Đơn hàng", và nó không có dữ kiện nào về cột — nên
    // `traLoi` cố ý không đoán, còn gợi ý thì phải với sang nguồn bên cạnh.
    hoi('cột thì sao');

    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    const goiY = screen.getByRole('button', { name: 'Số cột của bảng Khách hàng?' });

    // Bấm vào là nó điền thẳng vào ô nhập — không phải chép tay lại.
    fireEvent.click(goiY);
    expect(screen.getByLabelText('Câu hỏi')).toHaveValue('Số cột của bảng Khách hàng?');
  });

  it('không có dữ kiện nào gần thì vẫn gợi ý câu mẫu của nguồn đang chọn', async () => {
    dung([{ ten: 'Đơn hàng', duKien: [{ nhan: 'Số dòng của Đơn hàng', gia: '120' }] }]);
    fireEvent.click(nutMo());

    // "zzz" không trùng từ nào với dữ kiện nào.
    hoi('zzz qqq');

    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
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
   * Mấy ca ở đây cần một câu mà phép so từ khoá THẬT SỰ trượt.
   *
   * ⚠️ "nặng bao nhiêu" từng là câu đó, và giờ KHÔNG còn: bảng đồng nghĩa của
   * `chuanHoa` nối "nặng" về "dung lượng", nên lớp ngoại tuyến tự trả lời được.
   * Đổi câu thử chứ không đổi code — lớp ngoại tuyến thông minh thêm là điều
   * đáng mừng, chỉ có cái minh hoạ của mấy ca này là phải đi tìm chỗ khác.
   *
   * "cái kia ra sao" không trùng từ nào với nhãn nào, và nó cũng không nằm
   * trong bảng đồng nghĩa — vì nó không có nghĩa gì cả, đúng thứ cần ở đây.
   */
  it('bong bóng "chưa hiểu" tự nâng cấp thành câu trả lời', async () => {
    hieuCauHoi.mockResolvedValue({ chon: 1, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái kia ra sao');

    /*
     * Trong lúc chờ: BA CHẤM, không phải "tôi chưa hiểu".
     *
     * Trước đây khung hiện thẳng "chưa hiểu" rồi vài trăm mili giây sau mới
     * thay bằng câu trả lời — người dùng đọc được cả hai, và cái đầu là một
     * lời nói dối ngắn: khung chưa đọc xong thì chưa biết nó hiểu hay không.
     */
    expect(screen.getByLabelText('Đang soạn câu trả lời')).toBeInTheDocument();
    expect(screen.queryByText(/Tôi chưa hiểu câu này/)).toBeNull();

    expect(await screen.findByText('Dung lượng của Đơn hàng Q4: 4,2 MB.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Đang soạn câu trả lời')).toBeNull();
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

    hoi('cái kia ra sao');

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
    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    expect(screen.queryByText(/đã đọc hết số liệu/)).not.toBeInTheDocument();
  });

  it('gọi hỏng thì bong bóng "chưa hiểu" vẫn ở đó', async () => {
    hieuCauHoi.mockRejectedValue(new Error('mất mạng'));
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái kia ra sao');
    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
  });
});

describe('Trả lời xuyên hệ thống', () => {
  /** Đúng hình dạng `useNguCanhHeThong` dựng ra: tóm tắt trước, từng mục sau. */
  const toanToChuc: Nguon[] = [
    {
      ten: 'Tổng quan toàn tổ chức',
      duKien: [{ nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: '12' }],
    },
    { ten: 'Bán hàng', duKien: [{ nhan: 'Số bảng trong mô hình Bán hàng', gia: '5' }] },
    { ten: 'Kho vận', duKien: [{ nhan: 'Số bảng trong mô hình Kho vận', gia: '9' }] },
  ];

  const trangMotNguon: Nguon[] = [
    { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
  ];

  it('trả lời được câu mà trang đang mở không giữ số liệu', async () => {
    useNguCanhHeThong.mockReturnValue(toanToChuc);
    dung(trangMotNguon);
    fireEvent.click(nutMo());

    hoi('có bao nhiêu bộ dữ liệu');

    expect(await screen.findByText(/12/)).toBeInTheDocument();
    // Phải nói ra là nó đọc ở đâu: danh sách này KHÔNG ở trên màn hình, nên
    // người đọc không có gì để đối chiếu.
    expect(screen.getByText(/không phải trên trang đang mở/)).toBeInTheDocument();
  });

  /*
   * ⚠️ TRANG trước, HỆ THỐNG sau. Đảo thứ tự là một câu hỏi về thứ đang hiện
   * trên màn hình được trả lời bằng một con số của workspace khác — đúng số,
   * sai chỗ, và không có cách nào thấy bằng mắt.
   */
  it('trang đang mở LUÔN được trả lời trước danh sách hệ thống', () => {
    useNguCanhHeThong.mockReturnValue([
      {
        ten: 'Tổng quan toàn tổ chức',
        duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '999' }],
      },
    ]);
    dung(trangMotNguon);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');

    expect(screen.getByText(/12\.431/)).toBeInTheDocument();
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it('phạm vi rộng hơn được nói ra ở tiêu đề và ở câu chưa hiểu', async () => {
    useNguCanhHeThong.mockReturnValue(toanToChuc);
    dung(trangMotNguon);
    fireEvent.click(nutMo());

    expect(screen.getByText(/Đang đọc Kho dữ liệu \+ toàn tổ chức/)).toBeInTheDocument();

    hoi('hôm nay trời thế nào');
    expect(
      await screen.findByText(/cộng danh sách bộ dữ liệu và mô hình của tổ chức/),
    ).toBeInTheDocument();
  });

  /*
   * Một viewer không có `dataset:read` nên hai lời gọi kia trả 403 và danh sách
   * hệ thống rỗng. Khung không được hứa thứ nó không với tới.
   */
  it('không kéo được danh sách hệ thống thì KHÔNG hứa gì về nó', () => {
    useNguCanhHeThong.mockReturnValue([]);
    dung(trangMotNguon);
    fireEvent.click(nutMo());

    expect(screen.getByText('Đang đọc Kho dữ liệu')).toBeInTheDocument();

    hoi('hôm nay trời thế nào');
    expect(screen.queryByText(/mô hình của tổ chức/)).toBeNull();
  });

  /*
   * Mô hình phải được thấy cả mấy câu xuyên hệ thống, không chỉ nhãn của trang
   * — nếu không thì đúng những câu mà không trang nào trả lời được lại là
   * những câu nó không bao giờ chọn tới.
   */
  it('danh sách gửi cho mô hình có cả câu xuyên hệ thống, trang xếp TRƯỚC', async () => {
    useNguCanhHeThong.mockReturnValue(toanToChuc);
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    dung(trangMotNguon);
    fireEvent.click(nutMo());

    hoi('cái này nặng cỡ nào');
    await screen.findByText(/đã đọc hết số liệu/);

    const nhan = hieuCauHoi.mock.calls[0]?.[0].nhan ?? [];
    expect(nhan[0]).toBe('Số dòng của Đơn hàng Q4');
    expect(nhan).toContain('Số bộ dữ liệu trong toàn bộ tổ chức');
  });
});

/*
 * ⚠️ Đường mô hình-chọn-nhãn cũng phải đi qua lớp viết lại.
 *
 * Trước đây chỉ đường so-từ-khoá đi qua, nên đúng những câu hỏi KHÓ NHẤT —
 * những câu phải nhờ mô hình mới hiểu được — lại nhận về câu khô nhất: một
 * nhãn, một dấu hai chấm, một con số.
 */
describe('Câu trả lời được viết thành CHỮ, ở cả hai đường', () => {
  const trang: Nguon[] = [
    {
      ten: 'Đơn hàng Q4',
      duKien: [{ nhan: 'Dung lượng của Đơn hàng Q4', gia: '4,2 MB' }],
    },
  ];

  it('mô hình chọn nhãn xong thì câu đó vẫn được nhờ viết lại', async () => {
    /*
     * ⚠️ Câu hỏi phải là câu mà phép so từ khoá TRƯỢT, nếu không ca này xanh vì
     * lý do khác hẳn tên nó: lớp ngoại tuyến trả lời ngay ở đường thứ nhất, và
     * `dienDatLai` vẫn được gọi với đúng câu đó — nên cả hai `expect` dưới đây
     * đều đúng mà đường mô hình chưa từng chạy.
     *
     * `chon: 0` vì nguồn ở khối này chỉ khai ĐÚNG MỘT dữ kiện, và nguồn không
     * có biểu đồ nên danh sách lựa chọn chính là `duKien` theo thứ tự khai.
     */
    hieuCauHoi.mockResolvedValue({ chon: 0, daHoi: true });
    dienDatLai.mockResolvedValue('Tệp của Đơn hàng Q4 nặng 4,2 MB.');
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái kia ra sao');

    expect(await screen.findByText('Tệp của Đơn hàng Q4 nặng 4,2 MB.')).toBeInTheDocument();
    // Con số gửi đi để backend đối chiếu phải là con số của chính câu đó.
    expect(dienDatLai).toHaveBeenCalledWith(
      expect.objectContaining({ cau: 'Dung lượng của Đơn hàng Q4: 4,2 MB.', so: ['4,2 MB'] }),
    );
  });
});

/*
 * ĐƯỜNG CUỐI: mô hình tự đặt một câu hỏi MỚI trên mô hình dữ liệu.
 *
 * ═══ Bốn thứ được canh ở đây ═══════════════════════════════════════════════
 *
 *   1. Nó chỉ chạy khi trang khai `moHinhId`. Trang Kho dữ liệu hay Hồ sơ
 *      không có mô hình nào.
 *   2. Nó chỉ chạy SAU KHI mọi đường rẻ hơn đã trượt — mỗi lần gọi là một lượt
 *      gọi mô hình cộng một lượt quét ClickHouse.
 *   3. Câu trả lời LUÔN kèm "Tôi hiểu:". Đây là đường duy nhất mà con số được
 *      tính bởi một truy vấn do mô hình dựng, nên là đường duy nhất mà một câu
 *      trả lời sai không tự lộ ra.
 *   4. Bị 403 (viewer) thì bong bóng "chưa hiểu" ở lại, không có hộp lỗi nào.
 */
describe('Đặt câu hỏi MỚI trên mô hình dữ liệu', () => {
  const trang: Nguon[] = [
    { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
  ];

  it('trả lời được câu mà không trang nào có sẵn số liệu', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    hoiTrenMoHinh.mockResolvedValue({
      cau: 'Khu vực: Doanh thu 1.200.000.',
      so: ['1.200.000'],
      hieuLa: 'Doanh thu theo Khu vực, lọc Khu vực bằng Miền Bắc',
      daHoi: true,
    });
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc theo khu vực');

    expect(await screen.findByText(/1\.200\.000/)).toBeInTheDocument();
    // Lượt ĐẦU không có bộ nhớ nào để mang theo.
    expect(hoiTrenMoHinh).toHaveBeenCalledWith(7, 'doanh thu miền bắc theo khu vực', undefined);
  });

  /*
   * ⚠️ Ca quan trọng nhất của khối này. Không có dòng "Tôi hiểu:" thì người đọc
   * không có cách nào đối chiếu "máy hiểu gì" với "tôi hỏi gì" — và một truy
   * vấn sai trường vẫn cho ra một con số đẹp.
   */
  it('câu trả lời LUÔN kèm dòng "Tôi hiểu:"', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    hoiTrenMoHinh.mockResolvedValue({
      cau: 'Khu vực: Doanh thu 1.200.000.',
      so: ['1.200.000'],
      hieuLa: 'Doanh thu theo Khu vực, lọc Khu vực bằng Miền Bắc',
      daHoi: true,
    });
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc');

    expect(await screen.findByText(/Tôi hiểu:/)).toBeInTheDocument();
    expect(screen.getByText(/lọc Khu vực bằng Miền Bắc/)).toBeInTheDocument();
  });

  it('trang KHÔNG có mô hình, câu hỏi cũng không gọi tên mô hình nào — không gọi tới nó', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc theo khu vực');
    await screen.findByText(/đã đọc hết số liệu/);

    expect(hoiTrenMoHinh).not.toHaveBeenCalled();
  });

  /*
   * ĐỨNG Ở MỘT TRANG KHÔNG CÓ MÔ HÌNH, GỌI TÊN MỘT MÔ HÌNH.
   *
   * Trước đó chỉ ba màn khai `moHinhId` (trang mô hình, trang dựng báo cáo, trang
   * xem báo cáo), nên đứng ở Kho dữ liệu hỏi một câu số liệu thật là bế tắc —
   * trong khi danh sách mô hình đang nằm sẵn trong tay khung.
   */
  it('gọi tên một mô hình thì hỏi được từ trang BẤT KỲ', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    useNguCanhHeThong.mockReturnValue([
      { ten: 'Tổng quan toàn tổ chức', duKien: [] },
      { ten: 'Bán hàng', duKien: [], moHinhId: 7 },
    ]);
    hoiTrenMoHinh.mockResolvedValue({
      cau: 'Khu vực: Doanh thu 1.200.000.',
      so: ['1.200.000'],
      hieuLa: 'Doanh thu theo Khu vực',
      daHoi: true,
    });

    // `dung(trang)` — KHÔNG truyền `moHinhId`, đúng như trang Kho dữ liệu.
    dung(trang);
    fireEvent.click(nutMo());

    hoi('doanh thu theo khu vực trên Bán hàng');

    expect(await screen.findByText(/1\.200\.000/)).toBeInTheDocument();
    expect(hoiTrenMoHinh).toHaveBeenCalledWith(
      7,
      'doanh thu theo khu vực trên Bán hàng',
      undefined,
    );
  });

  /*
   * Mỗi lần gọi là một lượt gọi mô hình CỘNG một lượt quét ClickHouse. Gọi nó
   * cho một câu mà máy đã tự trả lời được là tiêu tiền và tiêu thời gian của
   * người dùng cho đúng con số họ đã có.
   */
  it('KHÔNG gọi khi phép so ngoại tuyến đã trả lời được', () => {
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');

    expect(screen.getByText(/12\.431/)).toBeInTheDocument();
    expect(hoiTrenMoHinh).not.toHaveBeenCalled();
  });

  it('bị 403 (viewer) thì bong bóng "chưa hiểu" ở lại, không có hộp lỗi', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    // `hoiTrenMoHinh` đã `mockRejectedValue` ở `beforeEach` — đúng trạng thái
    // của một viewer không có `datamodel:read`.
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc theo khu vực');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
  });

  it('mô hình không dựng được truy vấn nào thì giữ nguyên "chưa hiểu"', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    hoiTrenMoHinh.mockResolvedValue({ cau: null, so: [], hieuLa: null, daHoi: true });
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('hôm nay trời thế nào');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
  });
});

/*
 * BỘ NHỚ HỘI THOẠI — "còn tháng 4 thì sao".
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Thứ được nhớ là CÁI FORM của lượt trước, không phải đoạn chat: một lượt hỏi
 * tiếp gần như luôn là "form cũ, sửa một ô", nên bộ nhớ có kích thước không
 * đổi. Ba chỗ có thể sai:
 *
 *   1. Không nhớ gì -> mọi lượt hỏi tiếp thành một câu hỏi độc lập, và "còn
 *      tháng 4 thì sao" không có nghĩa gì cả.
 *   2. Nhớ QUÁ lâu. Khung không bị tháo khi đổi trang, nên một form của mô
 *      hình số 7 có thể theo người dùng sang mô hình số 9 — nơi id trường của
 *      nó trỏ vào những trường không còn tồn tại.
 *   3. Nhớ một lượt KHÔNG ra câu trả lời: hỏi tiếp trên một form không chạy
 *      được là dẫn cuộc trò chuyện đi vào chỗ đã tắc.
 */
describe('Bộ nhớ hội thoại', () => {
  const trang: Nguon[] = [
    { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
  ];
  const FORM = { dimensionIds: [11], measureIds: [21] };

  function traLoiDuoc(cau: string): void {
    hoiTrenMoHinh.mockResolvedValue({
      cau,
      so: [],
      hieuLa: 'Doanh thu theo Khu vực',
      daHoi: true,
      truyVan: FORM,
    });
  }

  it('lượt sau mang theo câu hỏi VÀ form của lượt trước', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    traLoiDuoc('Khu vực: Doanh thu 1.200.000.');
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc');
    await screen.findByText(/1\.200\.000/);

    traLoiDuoc('Khu vực: Doanh thu 980.000.');
    hoi('còn tháng 4 thì sao');
    await screen.findByText(/980\.000/);

    expect(hoiTrenMoHinh).toHaveBeenLastCalledWith(7, 'còn tháng 4 thì sao', {
      cauHoi: 'doanh thu miền bắc',
      truyVan: FORM,
    });
  });

  /*
   * ⚠️ Id trường của hai mô hình không liên quan gì nhau. Backend sẽ chặn (id
   * lạ -> bỏ cả form), nên hậu quả chỉ là một câu "chưa hiểu" vô cớ — nhưng đó
   * vẫn là một câu sai, nên quên ở đây rẻ hơn.
   */
  it('đổi sang mô hình khác thì KHÔNG mang form cũ theo', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    traLoiDuoc('Khu vực: Doanh thu 1.200.000.');
    const { doiMoHinh } = dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc');
    await screen.findByText(/1\.200\.000/);

    doiMoHinh(9);
    hoi('còn tháng 4 thì sao');
    await act(async () => {
      await Promise.resolve();
    });

    expect(hoiTrenMoHinh).toHaveBeenLastCalledWith(9, 'còn tháng 4 thì sao', undefined);
  });

  it('lượt không ra câu trả lời thì không được nhớ', async () => {
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    hoiTrenMoHinh.mockResolvedValue({
      cau: null,
      so: [],
      hieuLa: null,
      daHoi: true,
      truyVan: null,
    });
    dung(trang, 7);
    fireEvent.click(nutMo());

    hoi('hôm nay trời thế nào');
    await act(async () => {
      await Promise.resolve();
    });

    traLoiDuoc('Khu vực: Doanh thu 1.200.000.');
    hoi('còn tháng 4 thì sao');
    await screen.findByText(/1\.200\.000/);

    expect(hoiTrenMoHinh).toHaveBeenLastCalledWith(7, 'còn tháng 4 thì sao', undefined);
  });

  it('đổi chip nguồn thì quên lượt trước', async () => {
    const hai: Nguon[] = [
      ...trang,
      { ten: 'Đơn hàng Q3', duKien: [{ nhan: 'Số dòng của Đơn hàng Q3', gia: '9.000' }] },
    ];
    hieuCauHoi.mockResolvedValue({ chon: null, daHoi: true });
    traLoiDuoc('Khu vực: Doanh thu 1.200.000.');
    dung(hai, 7);
    fireEvent.click(nutMo());

    hoi('doanh thu miền bắc');
    await screen.findByText(/1\.200\.000/);

    fireEvent.click(screen.getByRole('button', { name: 'Đơn hàng Q3' }));
    hoi('còn tháng 4 thì sao');
    await act(async () => {
      await Promise.resolve();
    });

    expect(hoiTrenMoHinh).toHaveBeenLastCalledWith(7, 'còn tháng 4 thì sao', undefined);
  });
});

/*
 * BA TRẠNG THÁI của lớp mô hình, và cách người dùng đọc ra chúng.
 *
 * ═══ Vì sao chuyện này phải nhìn thấy được ═════════════════════════════════
 *
 * Khung CỐ Ý không bao giờ hỏng vì lớp mô hình — chưa có khoá, hết lượt, mất
 * mạng đều ra cùng một kết quả là câu mẫu. Hệ quả: cùng một câu hỏi cho hai
 * câu trả lời rất khác nhau tuỳ trạng thái, mà người dùng không có gì để biết
 * mình đang ở trạng thái nào. Họ sẽ kết luận là khung lúc được lúc không.
 *
 *   1. CHƯA CẤU HÌNH   -> nhãn "ngoại tuyến", và không câu nào có dấu mô hình.
 *   2. ĐÃ CẤU HÌNH     -> nhãn "có mô hình".
 *   3. ĐÃ CẤU HÌNH NHƯNG ĐANG KHÔNG GỌI ĐƯỢC (hết lượt, mất mạng) -> nhãn vẫn
 *      "có mô hình", nhưng câu trả lời KHÔNG còn dấu. Đó là chỗ duy nhất đọc
 *      được trạng thái thật, vì nhãn chỉ nói về cấu hình.
 */
describe('Nhìn ra khung đang có mô hình hay đang ngoại tuyến', () => {
  const trang: Nguon[] = [
    { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
  ];

  it('chưa cấu hình: nhãn nói "ngoại tuyến"', () => {
    useCoMoHinh.mockReturnValue(false);
    dung(trang);
    fireEvent.click(nutMo());

    expect(screen.getByText('ngoại tuyến')).toBeInTheDocument();
    expect(screen.queryByText('có mô hình')).toBeNull();
  });

  it('đã cấu hình: nhãn nói "có mô hình"', () => {
    useCoMoHinh.mockReturnValue(true);
    dung(trang);
    fireEvent.click(nutMo());

    expect(screen.getByText('có mô hình')).toBeInTheDocument();
  });

  /*
   * ⚠️ Dấu chỉ được hiện khi mô hình THẬT SỰ đổi câu. Backend trả lại nguyên
   * câu mẫu khi chưa cấu hình, khi gọi hỏng, VÀ khi luật đối chiếu số bỏ câu
   * mô hình viết — cả ba đều không phải "mô hình đã viết lại", và đánh dấu
   * chúng là nói rằng mô hình đang chạy trong khi nó không.
   */
  it('câu mẫu KHÔNG bị đánh dấu là do mô hình viết', async () => {
    dienDatLai.mockResolvedValue('Số dòng của Đơn hàng Q4: 12.431.');
    dung(trang);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/12\.431/)).toBeInTheDocument();
    expect(screen.queryByText(/mô hình viết lại/)).toBeNull();
  });

  it('mô hình đổi câu thì câu đó mang dấu', async () => {
    dienDatLai.mockResolvedValue('Đơn hàng Q4 có 12.431 dòng.');
    dung(trang);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');

    expect(await screen.findByText('Đơn hàng Q4 có 12.431 dòng.')).toBeInTheDocument();
    expect(screen.getByText(/mô hình viết lại/)).toBeInTheDocument();
  });

  it('mô hình CHỌN mục thì nói rõ là nó chọn, không phải nó viết', async () => {
    hieuCauHoi.mockResolvedValue({ chon: 0, daHoi: true });
    dung(trang);
    fireEvent.click(nutMo());

    hoi('cái kia ra sao');

    expect(await screen.findByText(/mô hình chọn mục/)).toBeInTheDocument();
  });

  /*
   * Trạng thái (3): nhãn vẫn "có mô hình" vì cấu hình không đổi, nhưng câu trả
   * lời không mang dấu nào — đúng thứ người dùng cần thấy khi hết lượt.
   */
  it('đã cấu hình mà gọi hỏng: nhãn vẫn bật, nhưng câu không mang dấu', async () => {
    useCoMoHinh.mockReturnValue(true);
    dienDatLai.mockRejectedValue(new Error('429 hết lượt'));
    dung(trang);
    fireEvent.click(nutMo());

    hoi('đơn hàng q4 có bao nhiêu dòng');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('có mô hình')).toBeInTheDocument();
    expect(screen.getByText(/12\.431/)).toBeInTheDocument();
    expect(screen.queryByText(/mô hình/)).not.toHaveTextContent('viết lại');
  });
});

/*
 * HỎI TIẾP ở lớp NGOẠI TUYẾN — không phải gõ lại từ đầu.
 *
 * ⚠️ Lỗi người dùng gặp thật: hỏi "nhóm hàng nào có số lượng cao nhất" rồi hỏi
 * tiếp "ở miền nào", và khung trả lời "Có 3 khu vực là Miền Bắc, Miền Nam và
 * Miền Trung" — nó quên sạch lượt vừa rồi.
 *
 * Phần hiểu câu đã có bộ riêng (`danhGia.test.ts`, hàm thuần). Ở đây chỉ canh
 * đúng việc NỐI DÂY: khung có nhớ câu vừa hỏi và có quên đúng lúc không.
 */
describe('Hỏi tiếp trên số liệu đang xem', () => {
  function cotChong(): Nguon[] {
    const o = (label: string, series: string, value: number) => ({ label, series, value });
    return [
      {
        ten: 'Số lượng theo Khu vực',
        duKien: [],
        bang: {
          rows: [
            o('Miền Bắc', 'Gia dụng', 100),
            o('Miền Bắc', 'Điện tử', 80),
            o('Miền Nam', 'Gia dụng', 102),
            o('Miền Nam', 'Điện tử', 95),
            o('Miền Trung', 'Gia dụng', 100),
            o('Miền Trung', 'Điện tử', 115),
          ],
          dimensionLabel: 'Khu vực',
          measureLabel: 'Số lượng',
          seriesLabel: 'Nhóm hàng',
          grouped: false,
        },
      },
    ];
  }

  it('câu hỏi tiếp được trả lời bằng ngữ cảnh của lượt trước', () => {
    dung(cotChong());
    fireEvent.click(nutMo());

    hoi('nhóm hàng nào có số lượng cao nhất');
    expect(screen.getByText(/Gia dụng/)).toBeInTheDocument();

    // "Ở miền nào" một mình không có nghĩa gì — nó chỉ sống nhờ lượt trước.
    hoi('ở miền nào');
    expect(screen.getByText(/Miền Trung/)).toBeInTheDocument();
  });

  /*
   * ⚠️ Đổi chip XOÁ cuộc trò chuyện, nên câu hỏi cũ không còn trên màn hình.
   * Giữ nó lại làm ngữ cảnh nghĩa là câu trả lời tiếp theo được lái bởi một
   * câu người dùng KHÔNG CÒN NHÌN THẤY — đúng thứ mà cả thiết kế này dựng lên
   * để chặn.
   *
   * Ca này cố ý dựng sao cho bộ nhớ cũ THẬT SỰ đổi câu trả lời: "còn bao nhiêu
   * dòng" một mình không khớp dữ kiện nào của chip mới, nhưng nối với câu cũ
   * thì `nguonTheoTen` tìm thấy "Đơn hàng Q4" và trả về 12.431.
   */
  it('đổi chip nguồn thì quên lượt trước', async () => {
    dung([
      { ten: 'Đơn hàng Q4', duKien: [{ nhan: 'Số dòng của Đơn hàng Q4', gia: '12.431' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số cột của Khách hàng', gia: '8' }] },
    ]);
    fireEvent.click(nutMo());

    hoi('Đơn hàng Q4 có bao nhiêu dòng');
    expect(screen.getByText(/12\.431/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));

    hoi('còn bao nhiêu dòng');
    await screen.findByText(/Tôi chưa hiểu câu này/);
    expect(screen.queryByText(/12\.431/)).toBeNull();
  });
});

/**
 * Hai biểu đồ trên một trang — khung phải hỏi NGƯỢC, không được đoán.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "nếu trên trang có 2 báo cáo thì làm thế nào để biết người dùng muốn hỏi
 *    báo cáo nào … chatbot hỏi ngược lại user đang muốn hỏi biểu đồ nào"
 *
 * Phần LUẬT (khi nào mơ hồ) đã có `traLoi.test.ts` canh. Ở đây canh đúng hai
 * thứ chỉ lộ ra trong DOM: cú bấm có HỎI LUÔN không, và dãy chip có đi theo
 * không — chip là chỗ duy nhất trên màn hình nói ra khung đang đọc ô nào.
 */
describe('Hỏi lại khi không rõ người dùng hỏi mục nào', () => {
  const bang = (nhan: string, gia: number): ReportDataDto => ({
    rows: [{ label: nhan, value: gia }],
    dimensionLabel: 'Sản phẩm',
    measureLabel: 'Doanh thu',
    grouped: false,
  });

  const hai = (): Nguon[] => [
    { ten: 'Doanh thu theo Sản phẩm', duKien: [], bang: bang('Bánh', 100) },
    { ten: 'Chi phí theo Sản phẩm', duKien: [], bang: bang('Kẹo', 900) },
  ];

  it('hỏi ngược, và bấm một mục là trả lời LUÔN bằng số của mục đó', async () => {
    dung(hai());
    fireEvent.click(nutMo());

    hoi('cao nhất là gì');

    expect(await screen.findByText(/Bạn muốn hỏi mục nào/)).toBeInTheDocument();
    // Chưa trả lời gì cả — đoán một trong hai rồi mới hỏi là đã kịp nói sai.
    expect(screen.queryByText(/Bánh/)).toBeNull();
    expect(screen.queryByText(/Kẹo/)).toBeNull();

    /*
     * Nút của mục thứ hai. `getAllBy` vì dãy chip trên đầu cũng có một nút
     * cùng tên — và đó chính là chỗ dễ nhầm: lấy nhầm cái chip thì ca này xanh
     * mà không kiểm được gì, vì bấm chip cũng đổi nguồn.
     */
    const nut = screen.getAllByRole('button', { name: 'Chi phí theo Sản phẩm' });
    fireEvent.click(nut[nut.length - 1] as HTMLElement);

    // Bấm là có câu trả lời ngay, không phải điền vào ô nhập rồi gửi lần nữa.
    expect(await screen.findByText(/Kẹo/)).toBeInTheDocument();
    expect(screen.queryByText(/Bánh/)).toBeNull();
    expect(screen.getByLabelText('Câu hỏi')).toHaveValue('');
  });

  it('chip đi theo lựa chọn vừa bấm', async () => {
    // Một câu trả lời về ô số 2 nằm dưới một chip đang sáng ở ô số 1 là mời
    // người đọc gán nhầm nó.
    dung(hai());
    fireEvent.click(nutMo());
    hoi('cao nhất là gì');
    await screen.findByText(/Bạn muốn hỏi mục nào/);

    const nut = screen.getAllByRole('button', { name: 'Chi phí theo Sản phẩm' });
    fireEvent.click(nut[nut.length - 1] as HTMLElement);
    await screen.findByText(/Kẹo/);

    const chip = screen.getAllByRole('button', { name: 'Chi phí theo Sản phẩm' })[0];
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('đã chọn rồi thì câu sau KHÔNG hỏi lại nữa', async () => {
    /*
     * Hỏi lại ở mọi câu thì phiền hơn hẳn đoán sai thỉnh thoảng — và một khung
     * phiền sẽ bị tắt, lúc đó chẳng còn gì bảo vệ ai. Một lựa chọn là đủ cho
     * cả cuộc trò chuyện; đổi ý thì bấm chip.
     */
    dung(hai());
    fireEvent.click(nutMo());
    hoi('cao nhất là gì');
    await screen.findByText(/Bạn muốn hỏi mục nào/);

    const nut = screen.getAllByRole('button', { name: 'Chi phí theo Sản phẩm' });
    fireEvent.click(nut[nut.length - 1] as HTMLElement);
    await screen.findByText(/Kẹo/);

    hoi('thấp nhất là gì');

    await screen.findAllByText(/Kẹo/);
    // Câu hỏi ngược của lượt TRƯỚC vẫn nằm trong cuộc trò chuyện — đúng như
    // mọi tin nhắn khác. Thứ không được phép xuất hiện là một cái THỨ HAI.
    expect(screen.getAllByText(/Bạn muốn hỏi mục nào/)).toHaveLength(1);
  });

  it('bấm chip trước rồi hỏi thì cũng không hỏi lại', async () => {
    dung(hai());
    fireEvent.click(nutMo());
    fireEvent.click(screen.getByRole('button', { name: 'Chi phí theo Sản phẩm' }));

    hoi('cao nhất là gì');

    expect(await screen.findByText(/Kẹo/)).toBeInTheDocument();
    expect(screen.queryByText(/Bạn muốn hỏi mục nào/)).toBeNull();
  });
});

/**
 * Trình dựng: "tui muốn xem doanh thu theo khu vực" ra một HƯỚNG DẪN.
 *
 * Phần luật đã có `goiYBieuDo.test.ts` canh, hàm thuần, không cần DOM. Ở đây
 * canh đúng hai chuyện của khung: nhánh này có ĐỨNG TRƯỚC mấy lớp đi tìm con số
 * không, và nó có TẮT HẲN ở trang không có ba cái ô để kéo vào không.
 */
describe('Gợi ý dựng biểu đồ ở trình dựng', () => {
  const f = (x: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
    ({ id: 1, label: 'X', datasetName: 'Đơn hàng', cubeType: 'string', ...x }) as ExplorerFieldDto;

  const TRUONG: ExplorerFieldsDto = {
    dimensions: [f({ id: 1, label: 'Khu vực', datasetName: 'Khách hàng' })],
    measures: [f({ id: 10, label: 'Doanh thu', cubeType: 'number' })],
  };

  const NGUON: Nguon[] = [
    { ten: 'Mô hình Bán hàng', duKien: [{ nhan: 'Số bảng trong mô hình Bán hàng', gia: '3' }] },
  ];

  it('trả về hướng dẫn kéo trường, không phải một con số', async () => {
    dung(NGUON, 7, TRUONG);
    fireEvent.click(nutMo());

    hoi('tui muốn xem doanh thu theo khu vực');

    expect(await screen.findByText(/ô Chiều dữ liệu/)).toBeInTheDocument();
    expect(screen.getByText(/Biểu đồ cột/)).toBeInTheDocument();
    /*
     * Đường đặt câu hỏi MỚI trên mô hình KHÔNG được chạy. Nó sẽ trả về một con
     * số thật — cho một câu hỏi người dùng không hỏi — và tốn một lượt gọi mô
     * hình cộng một lượt quét ClickHouse để làm việc đó.
     */
    expect(hoiTrenMoHinh).not.toHaveBeenCalled();
  });

  it('trang KHÔNG khai trường thì nhánh này không tồn tại', async () => {
    // Ngoài trình dựng thì không có ô nào để kéo vào, nên một câu hướng dẫn ở
    // đó chỉ bảo người dùng đi tìm thứ không có trên màn hình.
    dung(NGUON, 7);
    fireEvent.click(nutMo());

    hoi('tui muốn xem doanh thu theo khu vực');

    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    expect(screen.queryByText(/ô Chiều dữ liệu/)).toBeNull();
  });
});

/**
 * Dãy biểu đồ dựng sẵn — "đề xuất ngay", không qua câu chữ.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "có cách nào tốt hơn … chứ ko dựa vào chat bằng câu chữ của khách hàng vì
 *    nó rất rộng"
 *   "kết hợp cả 2 cái, nếu người dùng yêu cầu gợi ý thì chatbot gợi ý, người
 *    dùng yêu cầu vẽ biểu đồ thì vẽ cho người dùng luôn"
 *
 * Phép xếp hạng đã có `goiYBieuDo.test.ts` canh. Ở đây canh ba thứ chỉ lộ ra
 * trong DOM: hai nút có làm HAI việc khác nhau không, cú bấm "Vẽ" có mang đúng
 * mã trường xuống trang không, và nút "Vẽ" có BIẾN MẤT ở trang không ghi được
 * không.
 */
describe('Dãy biểu đồ dựng sẵn ở trình dựng', () => {
  const f = (x: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
    ({ id: 1, label: 'X', datasetName: 'Đơn hàng', cubeType: 'string', ...x }) as ExplorerFieldDto;

  const TRUONG: ExplorerFieldsDto = {
    dimensions: [f({ id: 1, label: 'Khu vực' })],
    measures: [f({ id: 10, label: 'Doanh thu', cubeType: 'number' })],
  };

  const NGUON: Nguon[] = [
    { ten: 'Mô hình Bán hàng', duKien: [{ nhan: 'Số bảng trong mô hình Bán hàng', gia: '3' }] },
  ];

  it('màn chào bày sẵn biểu đồ, mỗi cái hai nút', () => {
    dung(NGUON, 7, TRUONG, vi.fn());
    fireEvent.click(nutMo());

    expect(screen.getByText('Doanh thu theo Khu vực')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gợi ý' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vẽ' })).toBeInTheDocument();
  });

  it('"Gợi ý" NÓI cách kéo và KHÔNG đụng vào trang', async () => {
    const ve = vi.fn();
    dung(NGUON, 7, TRUONG, ve);
    fireEvent.click(nutMo());

    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }));

    expect(await screen.findByText(/ô Chiều dữ liệu/)).toBeInTheDocument();
    expect(ve).not.toHaveBeenCalled();
  });

  it('"Vẽ" gửi đúng mã trường xuống trang, và nói ra đường lùi', async () => {
    const ve = vi.fn();
    dung(NGUON, 7, TRUONG, ve);
    fireEvent.click(nutMo());

    fireEvent.click(screen.getByRole('button', { name: 'Vẽ' }));

    // Mã TRƯỜNG, không phải tên: trang điền vào ô bằng id, và hai trường trùng
    // tên là chuyện có thật.
    expect(ve).toHaveBeenCalledWith({ chieuId: 1, thuocDoId: 10, loai: 'bar' });
    // Đây là thao tác DUY NHẤT trong khung đụng vào trang, nên người dùng phải
    // biết đường lùi ngay lúc nó vừa xảy ra.
    expect(await screen.findByText(/Ctrl\+Z/)).toBeInTheDocument();
  });

  it('trang không ghi được thì KHÔNG bày nút "Vẽ"', () => {
    // Một nút bấm vào không thấy gì đổi đọc ra như một nút hỏng.
    dung(NGUON, 7, TRUONG);
    fireEvent.click(nutMo());

    expect(screen.getByRole('button', { name: 'Gợi ý' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vẽ' })).toBeNull();
  });

  it('câu không hiểu ở trình dựng thì bày dãy biểu đồ, không bày câu mẫu', async () => {
    // Đúng lúc người dùng vừa gõ một câu khung không hiểu là lúc một danh sách
    // bấm được có giá trị nhất.
    dung(NGUON, 7, TRUONG, vi.fn());
    fireEvent.click(nutMo());

    hoi('zzz qqq');

    expect(await screen.findByText(/Tôi chưa hiểu câu này/)).toBeInTheDocument();
    expect(screen.getByText(/Hay dựng thẳng một trong mấy cái này/)).toBeInTheDocument();
  });
});

/**
 * Đường VẼ có HAI lớp đỡ phía sau phép so từ khoá.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "ko dựa vào chat bằng câu chữ của khách hàng vì nó rất rộng"
 *
 * Đo được là 10/30. Nguyên nhân sâu nhất không phải phép so yếu, mà là cả
 * đường vẽ phụ thuộc vào một DANH SÁCH TỪ Ý ĐỊNH viết tay — thứ không bao giờ
 * đóng lại được. Hai lớp đỡ dưới đây gỡ đúng chỗ đó.
 */
describe('Hai lớp đỡ của đường vẽ', () => {
  const f = (x: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
    ({ id: 1, label: 'X', datasetName: 'Đơn hàng', cubeType: 'string', ...x }) as ExplorerFieldDto;

  const TRUONG: ExplorerFieldsDto = {
    dimensions: [f({ id: 1, label: 'Khu vực' })],
    measures: [f({ id: 10, label: 'Doanh thu', cubeType: 'number' })],
  };

  const NGUON: Nguon[] = [
    { ten: 'Mô hình Bán hàng', duKien: [{ nhan: 'Số bảng trong mô hình Bán hàng', gia: '3' }] },
  ];

  it('KHÔNG có chữ ý định: số liệu thử trước, rồi mới tới vẽ — và MIỄN PHÍ', async () => {
    /*
     * "doanh thu theo khu vực" không có chữ nào trong `TU_Y_DINH`. Bản trước
     * trượt hẳn; giờ nó rơi xuống chỗ dự phòng sau khi đường số liệu trượt, và
     * chạy xong trước khi lớp mô hình kịp được gọi.
     */
    dung(NGUON, 7, TRUONG, vi.fn());
    fireEvent.click(nutMo());

    hoi('doanh thu theo khu vực');

    expect(await screen.findByText(/ô Chiều dữ liệu/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vẽ' })).toBeInTheDocument();
    expect(hieuCauHoi).not.toHaveBeenCalled();
  });

  it('so từ khoá trượt hẳn: mô hình CHỌN một cặp, và cặp đó vẫn bấm "Vẽ" được', async () => {
    /*
     * "theo vùng" gọi trường bằng một cái tên KHÔNG có trên nhãn, nên không
     * phép so chuỗi nào với tới. Đây đúng là chỗ của lớp mô hình — và nó vẫn
     * chỉ được CHỌN MỘT CHỈ SỐ trong danh sách khung dựng, không tự viết ra gì.
     */
    hieuCauHoi.mockResolvedValue({ chon: 0, daHoi: true });
    dung(NGUON, 7, TRUONG, vi.fn());
    fireEvent.click(nutMo());

    hoi('tui cần số liệu theo vùng miền');

    expect(await screen.findByText(/ô Chiều dữ liệu/)).toBeInTheDocument();

    // Cặp vẽ phải đứng ĐẦU danh sách: backend chỉ lấy 60 nhãn, mà `duKienMoHinh`
    // một mình đã đẩy ra hàng trăm.
    const nhan = hieuCauHoi.mock.calls[0]?.[0].nhan ?? [];
    expect(nhan[0]).toBe('Vẽ biểu đồ: Doanh thu theo Khu vực');

    // Và nó giữ được đúng cú bấm mà cả tính năng sinh ra để có.
    expect(screen.getByRole('button', { name: 'Vẽ' })).toBeInTheDocument();
  });
});

describe('Hoà điểm ở đường vẽ thì hỏi lại', () => {
  const f = (x: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
    ({ id: 1, label: 'X', datasetName: 'Đơn hàng', cubeType: 'string', ...x }) as ExplorerFieldDto;

  it('hai thước đo cùng điểm -> hỏi "cái nào", và mỗi cái vẫn bấm Vẽ được', async () => {
    // Khung đã biết chiều là "Khu vực"; thứ còn thiếu chỉ là một cú bấm.
    const TRUONG: ExplorerFieldsDto = {
      dimensions: [f({ id: 1, label: 'Khu vực' })],
      measures: [
        f({ id: 10, label: 'Doanh thu gộp', cubeType: 'number' }),
        f({ id: 11, label: 'Doanh thu thuần', cubeType: 'number' }),
      ],
    };
    dung([{ ten: 'Mô hình Bán hàng', duKien: [] }], 7, TRUONG, vi.fn());
    fireEvent.click(nutMo());

    hoi('tui muốn xem doanh thu theo khu vực');

    expect(await screen.findByText(/khớp với 2 cặp trường/)).toBeInTheDocument();
    expect(screen.getByText('Doanh thu gộp theo Khu vực')).toBeInTheDocument();
    expect(screen.getByText('Doanh thu thuần theo Khu vực')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Vẽ' })).toHaveLength(2);
  });
});
