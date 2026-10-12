import type { DataModelDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { duKienDanhSachMoHinh } from '../src/features/chat/duKienTrang';
import type { Nguon } from '../src/features/chat/nguCanh';
import {
  duKienPhang,
  goiYGan,
  goiYSoSanh,
  soSanhNguon,
  traLoiTrang,
} from '../src/features/chat/traLoi';

/**
 * So GIỮA các mục của một danh sách — "mô hình nào được dùng nhiều nhất".
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Nhánh này chạy TRƯỚC `traLoi`, nên mọi lỗi của nó đều là lỗi cướp câu trả
 * lời: nhận nhầm một câu hỏi về một mục thành câu hỏi về cả danh sách, hoặc
 * chọn nhầm cột rồi trả về một tên có thật cho một câu hỏi khác. Năm chỗ hỏng
 * được canh riêng:
 *
 *   1. argmax thành argmin.
 *   2. Đọc số kiểu `vi-VN` sai — "1.200" mà hiểu thành 1,2 thì nó thua 999.
 *   3. Quên nói là chỉ so trên TRANG ĐANG MỞ, trong khi danh sách có phân trang.
 *   4. Nguồn tóm tắt của trang bị tính thành một mục ngang hàng với các mục thật.
 *   5. Đoán cột khi câu hỏi chưa đủ rõ, thay vì nói là chưa hiểu.
 */

function moHinh(part: Partial<DataModelDto> & { name: string }): DataModelDto {
  return {
    id: 1,
    workspaceId: 1,
    description: null,
    datasetCount: 3,
    measureCount: 2,
    relationshipCount: 2,
    reportCount: 0,
    creatorName: 'Thái',
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    ...part,
  };
}

/** Đúng những gì `DataModelsPage` khai, nên bộ này đi qua cả `duKienTrang`. */
function trangMoHinh(ms: DataModelDto[]): Nguon[] {
  return duKienDanhSachMoHinh(ms, ms.length);
}

describe('soSanhNguon — "mục nào … nhất"', () => {
  it('gọi tên mô hình được nhiều báo cáo dùng nhất', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', reportCount: 2 }),
      moHinh({ name: 'Kho', reportCount: 7 }),
      moHinh({ name: 'Nhân sự', reportCount: 5 }),
    ]);

    const kq = soSanhNguon(n, 'datamodel nào được dùng nhiều nhất');

    expect(kq).not.toBeNull();
    expect(kq?.cau).toContain('Kho');
    expect(kq?.cau).not.toContain('Nhân sự');
    expect(kq?.so).toEqual(['7']);
  });

  /*
   * "ít báo cáo nhất" — tính từ bị danh từ chen vào giữa, nên bảng từ khoá liền
   * nhau của `docYDinh` trượt. Tiếng Việt nói kiểu này là chuyện thường, và
   * trượt về `cao_nhat` thì câu trả lời ngược hẳn ý người hỏi.
   */
  it('đọc được "ít … nhất" khi có danh từ chen vào giữa', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', reportCount: 2 }),
      moHinh({ name: 'Kho', reportCount: 7 }),
    ]);

    const kq = soSanhNguon(n, 'mô hình nào ít báo cáo nhất');

    expect(kq?.cau).toContain('Bán hàng');
    expect(kq?.cau).not.toContain('Kho');
  });

  it('"ít nhất" ra mô hình thấp nhất, không phải cao nhất', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', reportCount: 2 }),
      moHinh({ name: 'Kho', reportCount: 7 }),
    ]);

    expect(soSanhNguon(n, 'mô hình nào được dùng ít nhất')?.cau).toContain('Bán hàng');
  });

  /*
   * `vi-VN` lấy `.` làm dấu hàng nghìn, nên "1.200" đi qua `parseFloat` ra 1,2 —
   * nhỏ hơn 999. Con số sai này không trông như lỗi: nó gọi tên một mô hình có
   * thật, bằng một giá trị có thật đang hiện trên màn hình.
   */
  it('đọc đúng dấu hàng nghìn của vi-VN', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Nhỏ', reportCount: 999 }),
      moHinh({ name: 'To', reportCount: 1200 }),
    ]);

    const kq = soSanhNguon(n, 'mô hình nào được dùng nhiều nhất');

    expect(kq?.cau).toContain('To');
    expect(kq?.so).toEqual(['1.200']);
  });

  it('bằng điểm thì gọi tên cả hai', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', reportCount: 7 }),
      moHinh({ name: 'Kho', reportCount: 7 }),
      moHinh({ name: 'Nhân sự', reportCount: 1 }),
    ]);

    const kq = soSanhNguon(n, 'mô hình nào được dùng nhiều nhất');

    expect(kq?.cau).toContain('Bán hàng và Kho');
    expect(kq?.cau).not.toContain('Nhân sự');
  });

  it('ba mục trở lên bằng nhau thì ngăn bằng dấu phẩy, không phải chuỗi "và"', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Một', reportCount: 7 }),
      moHinh({ name: 'Hai', reportCount: 7 }),
      moHinh({ name: 'Ba', reportCount: 7 }),
      moHinh({ name: 'Bốn', reportCount: 1 }),
    ]);

    expect(soSanhNguon(n, 'mô hình nào được dùng nhiều nhất')?.cau).toContain('Một, Hai và Ba');
  });

  /*
   * Khi MỌI mục bằng nhau thì không mục nào "cao nhất" cả. Đọc tên cả danh sách
   * ra rồi gọi đó là đỉnh vừa dài vừa sai nghĩa.
   */
  it('mọi mục bằng nhau thì nói thẳng là bằng nhau', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', reportCount: 3 }),
      moHinh({ name: 'Kho', reportCount: 3 }),
    ]);

    const kq = soSanhNguon(n, 'mô hình nào được dùng nhiều nhất');

    expect(kq?.cau).toContain('Cả 2 mục đều bằng nhau');
    expect(kq?.cau).not.toContain('Cao nhất');
  });

  /*
   * Chip và câu trả lời phải gọi cùng một mục bằng CÙNG một tên. Trả lời "cao
   * nhất là Global-Superstore" khi trên màn hình có ba chip tên y hệt nhau thì
   * câu đó không chỉ ra được mô hình nào — đúng lỗi đã ghi ở `nhanO.ts`.
   */
  it('tên trùng nhau thì câu trả lời cũng đánh số như chip', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Global-Superstore', reportCount: 1 }),
      moHinh({ name: 'Global-Superstore', reportCount: 9 }),
      moHinh({ name: 'doanh thu', reportCount: 4 }),
    ]);

    expect(soSanhNguon(n, 'mô hình nào được dùng nhiều nhất')?.cau).toContain(
      'Global-Superstore (2)',
    );
  });

  it('luôn nói rõ là chỉ so trên các mục của trang đang mở', () => {
    // `tong` là 40 trong khi trang chỉ hiện 2 — đúng cảnh phân trang.
    const n = duKienDanhSachMoHinh(
      [moHinh({ name: 'Bán hàng', reportCount: 2 }), moHinh({ name: 'Kho', reportCount: 7 })],
      40,
    );

    expect(soSanhNguon(n, 'mô hình nào được dùng nhiều nhất')?.cau).toContain(
      'so trên 2 mục đang hiện trên trang này',
    );
  });

  it('không so được cột toàn chữ', () => {
    const n = trangMoHinh([moHinh({ name: 'Bán hàng' }), moHinh({ name: 'Kho' })]);

    // "Người tạo mô hình X" có ở cả hai mục nhưng giá trị là tên người.
    expect(soSanhNguon(n, 'mô hình nào có người tạo nhiều nhất')).toBeNull();
  });
});

describe('soSanhNguon — "mục nào chưa …"', () => {
  it('liệt kê đúng những mô hình chưa có quan hệ nào', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', relationshipCount: 0 }),
      moHinh({ name: 'Kho', relationshipCount: 4 }),
      moHinh({ name: 'Nhân sự', relationshipCount: 0 }),
    ]);

    const kq = soSanhNguon(n, 'datamodel nào chưa nối quan hệ');

    expect(kq?.cau).toContain('Bán hàng');
    expect(kq?.cau).toContain('Nhân sự');
    expect(kq?.cau).not.toContain('Kho');
    expect(kq?.so).toEqual(['2']);
  });

  /*
   * Ba cột cùng nói về "bảng"/"quan hệ" nằm cạnh nhau, nên ca này canh chuyện
   * thêm cột thứ ba làm hoà điểm hai cột kia. Hoà là khung trả lời "chưa hiểu"
   * — hỏng cả ba câu thay vì thêm được một.
   */
  it('cột "đã nối đủ chưa" không cướp câu hỏi của hai cột cạnh nó', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Đủ', datasetCount: 3, relationshipCount: 2 }),
      moHinh({ name: 'Thiếu', datasetCount: 4, relationshipCount: 1 }),
      moHinh({ name: 'Trống', datasetCount: 2, relationshipCount: 0 }),
    ]);

    // Mỗi câu phải rơi vào ĐÚNG cột của nó.
    expect(soSanhNguon(n, 'mô hình nào chưa nối đủ')?.cau).toContain('Mô hình đã nối đủ chưa');
    expect(soSanhNguon(n, 'mô hình nào chưa nối quan hệ')?.cau).toContain('Số quan hệ của mô hình');
    expect(soSanhNguon(n, 'mô hình nào nhiều bảng nhất')?.cau).toContain('Số bảng trong mô hình');
  });

  it('nói thẳng khi không mô hình nào thiếu', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', relationshipCount: 2 }),
      moHinh({ name: 'Kho', relationshipCount: 4 }),
    ]);

    expect(soSanhNguon(n, 'mô hình nào chưa nối quan hệ')?.cau).toContain('Không mục nào');
  });

  /*
   * `dk` BỎ HẲN dữ kiện có giá trị rỗng, nên mô hình không mô tả thì không có
   * dòng "Mô tả của mô hình X" nào cả. Thiếu hẳn dữ kiện cũng là "chưa có".
   */
  it('dữ kiện vắng mặt cũng tính là chưa có', () => {
    const n = trangMoHinh([
      moHinh({ name: 'Bán hàng', description: 'Doanh thu theo vùng' }),
      moHinh({ name: 'Kho', description: 'Tồn kho' }),
      moHinh({ name: 'Nhân sự', description: null }),
    ]);

    const kq = soSanhNguon(n, 'mô hình nào chưa có mô tả');

    expect(kq?.cau).toContain('Nhân sự');
    expect(kq?.cau).not.toContain('Bán hàng');
  });
});

describe('soSanhNguon — ba cửa phải qua hết', () => {
  const n = trangMoHinh([
    moHinh({ name: 'Bán hàng', reportCount: 2 }),
    moHinh({ name: 'Kho', reportCount: 7 }),
  ]);

  it('không có chữ "nào" thì đây không phải câu hỏi về cả danh sách', () => {
    expect(soSanhNguon(n, 'mô hình Kho được dùng nhiều nhất')).toBeNull();
  });

  it('không có ý định so sánh thì bỏ qua', () => {
    expect(soSanhNguon(n, 'mô hình Kho sửa lần cuối lúc nào')).toBeNull();
  });

  it('câu hỏi không nhắc cột nào thì nói chưa hiểu', () => {
    expect(soSanhNguon(n, 'cái nào xịn nhất')).toBeNull();
  });

  /*
   * Hai cột cùng điểm nghĩa là câu hỏi chưa nói rõ nó hỏi cột nào. Chọn cột
   * đứng trước sẽ ra một tên mục CÓ THẬT, kèm một con số CÓ THẬT — trả lời cho
   * một câu hỏi khác, và không có dấu hiệu nào để nhận ra.
   */
  it('hai cột bằng điểm thì nói chưa hiểu, không chọn bừa', () => {
    const trang: Nguon[] = [
      {
        ten: 'Đơn hàng',
        duKien: [
          { nhan: 'Số cột của bảng Đơn hàng', gia: '12' },
          { nhan: 'Số dòng của bảng Đơn hàng', gia: '900' },
        ],
      },
      {
        ten: 'Khách hàng',
        duKien: [
          { nhan: 'Số cột của bảng Khách hàng', gia: '5' },
          { nhan: 'Số dòng của bảng Khách hàng', gia: '40' },
        ],
      },
    ];

    expect(soSanhNguon(trang, 'bảng nào có số nhiều nhất')).toBeNull();
  });

  it('một mục thì không có gì để so', () => {
    expect(soSanhNguon(trangMoHinh([moHinh({ name: 'Kho' })]), 'mô hình nào nhiều bảng nhất')).toBe(
      null,
    );
  });

  /*
   * Nguồn tóm tắt của trang chi tiết mô hình mang nhãn nhắc đúng tên của chính
   * nó ("Mô hình X dựng từ tệp nào"), nên nó trông y hệt một mục. Thứ loại nó
   * ra là luật "cột phải có mặt ở từ hai mục": không bảng nào khác có cột đó.
   */
  it('nguồn tóm tắt không bị tính thành một mục', () => {
    const trang: Nguon[] = [
      {
        ten: 'Mô hình Bán hàng',
        duKien: [{ nhan: 'Mô hình Bán hàng dựng từ tệp nào', gia: 'donhang.csv' }],
      },
      { ten: 'Đơn hàng', duKien: [{ nhan: 'Số cột của bảng Đơn hàng', gia: '12' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số cột của bảng Khách hàng', gia: '5' }] },
    ];

    const kq = soSanhNguon(trang, 'bảng nào nhiều cột nhất');

    expect(kq?.cau).toContain('Đơn hàng');
    expect(kq?.cau).toContain('so trên 2 mục đang hiện trên trang này');
  });
});

describe('traLoiTrang', () => {
  const n = trangMoHinh([
    moHinh({ name: 'Bán hàng', datasetCount: 9, relationshipCount: 0 }),
    moHinh({ name: 'Kho', datasetCount: 3, relationshipCount: 4 }),
  ]);
  /** Chip đang chọn là "Kho" — nguồn 0 là bản tóm tắt cả danh sách. */
  const chonKho = n[2] ?? n[0]!;

  /*
   * Đang chọn chip "Kho" mà hỏi về cả danh sách. `traLoi` một mình tìm thấy
   * ngay "Mô hình Kho đã nối đủ các bảng chưa: đã nối đủ" và trả lời bằng câu
   * đó — một câu ĐÚNG về Kho, cho một câu hỏi về mô hình NÀO. Người đọc không
   * có cách nào thấy là mình vừa bị trả lời nhầm câu hỏi.
   */
  it('câu hỏi về cả danh sách thắng nguồn đang chọn', () => {
    expect(traLoiTrang(n, chonKho, 'mô hình nào chưa nối quan hệ')?.cau).toContain('Bán hàng');
  });

  /*
   * Ca trên còn hoà điểm nên `traLoi` tự trả `null`; ca này thì không. Nguồn
   * đang chọn có đúng MỘT dữ kiện khớp, nên đảo thứ tự là nó trả lời ngay bằng
   * con số của chính nó — câu trả lời sai mà đọc vào thấy hoàn toàn hợp lý.
   */
  it('nguồn đang chọn không cướp được câu hỏi về cả danh sách', () => {
    const trang: Nguon[] = [
      { ten: 'Đơn hàng', duKien: [{ nhan: 'Số lỗi của bảng Đơn hàng', gia: '0' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số lỗi của bảng Khách hàng', gia: '5' }] },
    ];
    const chonThap = trang[0]!;

    expect(traLoiTrang(trang, chonThap, 'bảng nào nhiều lỗi nhất')?.cau).toContain(
      'Cao nhất là Khách hàng',
    );
  });

  /*
   * Câu hỏi về cả danh sách MÀ có nhắc tên một mục. Bước "theo tên" chạy trước
   * là nó tìm thấy "Số báo cáo đang dùng mô hình Kho: 7" — đúng số, đúng mô
   * hình được hỏi tới, nhưng vẫn là câu trả lời cho một câu hỏi khác: người
   * dùng đang hỏi SO giữa hai mô hình.
   */
  it('nhắc tên một mục không biến câu hỏi so sánh thành câu hỏi tra cứu', () => {
    const trang: Nguon[] = [
      { ten: 'Đơn hàng', duKien: [{ nhan: 'Số lỗi của bảng Đơn hàng', gia: '2' }] },
      { ten: 'Khách hàng', duKien: [{ nhan: 'Số lỗi của bảng Khách hàng', gia: '9' }] },
    ];

    expect(
      traLoiTrang(trang, trang[0]!, 'bảng nào nhiều lỗi nhất, Đơn hàng hay Khách hàng'),
    ).toMatchObject({ cau: expect.stringContaining('Cao nhất là Khách hàng') });
  });

  /*
   * Chip mặc định là bản tóm tắt cả trang. Không có bước "theo tên" thì câu này
   * được chấm trên dữ kiện của bản tóm tắt và thắng bằng "Số mô hình dữ liệu
   * trong workspace này" — một con số có thật, về một thứ khác hẳn.
   */
  it('câu hỏi gọi thẳng tên một mục được trả lời theo mục đó', () => {
    const tomTat = n[0]!;

    expect(traLoiTrang(n, tomTat, 'số bảng trong mô hình Bán hàng')?.cau).toContain('9');
  });

  it('tên dài trùm tên ngắn thì lấy tên dài', () => {
    const hai = trangMoHinh([
      moHinh({ name: 'Kho', datasetCount: 2 }),
      moHinh({ name: 'Kho tổng', datasetCount: 11 }),
    ]);

    expect(traLoiTrang(hai, hai[0]!, 'số bảng trong mô hình Kho tổng')?.cau).toContain('11');
  });

  it('câu hỏi về đúng nguồn đang chọn vẫn chạy như cũ', () => {
    expect(traLoiTrang(n, chonKho, 'số bảng trong mô hình Kho')?.cau).toContain('3');
  });
});

describe('goiYSoSanh', () => {
  /*
   * Cột chữ phải bị bỏ qua KỂ CẢ khi nó đứng đầu. Gợi ý "Mục nào có 'Người phụ
   * trách' cao nhất?" là dạy người dùng hỏi một câu mà khung chắc chắn trả lời
   * "tôi chưa hiểu" — hỏng niềm tin nhanh hơn là không gợi ý gì.
   */
  it('bỏ qua cột toàn chữ dù nó đứng trước cột số', () => {
    const trang: Nguon[] = [
      {
        ten: 'Đơn hàng',
        duKien: [
          { nhan: 'Người phụ trách bảng Đơn hàng', gia: 'Thái' },
          { nhan: 'Số dòng của bảng Đơn hàng', gia: '10' },
        ],
      },
      {
        ten: 'Khách hàng',
        duKien: [
          { nhan: 'Người phụ trách bảng Khách hàng', gia: 'Lan' },
          { nhan: 'Số dòng của bảng Khách hàng', gia: '20' },
        ],
      },
    ];

    expect(goiYSoSanh(trang)).toEqual(['Mục nào có "Số dòng của bảng" cao nhất?']);
  });

  it('gợi ý đúng khuôn trên trang danh sách thật', () => {
    const mau = goiYSoSanh(trangMoHinh([moHinh({ name: 'Bán hàng' }), moHinh({ name: 'Kho' })]));

    expect(mau.length).toBeGreaterThan(0);
    expect(mau.every((q) => q.includes('cao nhất?'))).toBe(true);
  });

  it('trang chỉ có biểu đồ thì không gợi ý gì', () => {
    expect(goiYSoSanh([{ ten: 'Doanh thu theo vùng', duKien: [] }])).toEqual([]);
  });
});

describe('goiYGan — lối ra của "tôi chưa hiểu"', () => {
  const trang: Nguon[] = [
    {
      ten: 'Đơn hàng',
      duKien: [
        { nhan: 'Số dòng của bảng Đơn hàng', gia: '120' },
        { nhan: 'Ngày cập nhật bảng Đơn hàng', gia: '01/02/2026' },
      ],
    },
    { ten: 'Khách hàng', duKien: [{ nhan: 'Số dòng của bảng Khách hàng', gia: '40' }] },
  ];

  it('xếp theo số từ trùng, dữ kiện trùng nhiều nhất lên đầu', () => {
    const mau = goiYGan(trang, trang[0]!, 'cập nhật lúc nào');

    expect(mau[0]).toBe('Ngày cập nhật bảng Đơn hàng?');
  });

  /*
   * Bằng điểm thì gợi ý phải nói về thứ người dùng ĐANG XEM. Gợi ý một dữ kiện
   * của mục khác, cùng điểm, là đẩy họ đi khỏi chỗ họ đang đứng.
   */
  it('bằng điểm thì ưu tiên nguồn đang chọn', () => {
    const chonKhach = trang[1]!;

    expect(goiYGan(trang, chonKhach, 'dòng')[0]).toBe('Số dòng của bảng Khách hàng?');
    expect(goiYGan(trang, trang[0]!, 'dòng')[0]).toBe('Số dòng của bảng Đơn hàng?');
  });

  it('gợi ý nhiều nhất ba câu', () => {
    expect(
      goiYGan(trang, trang[0]!, 'bảng đơn hàng khách hàng dòng ngày').length,
    ).toBeLessThanOrEqual(3);
  });

  it('không trùng từ nào thì không gợi ý gì — để khung rơi về câu mẫu', () => {
    expect(goiYGan(trang, trang[0]!, 'zzz qqq')).toEqual([]);
    expect(goiYGan(trang, trang[0]!, '')).toEqual([]);
  });
});

describe('duKienPhang — danh sách nhãn gửi cho mô hình chọn', () => {
  const trang: Nguon[] = [
    {
      ten: 'Global-Superstore',
      duKien: [
        { nhan: 'Số bảng trong mô hình Global-Superstore', gia: '4' },
        { nhan: 'Người tạo mô hình Global-Superstore', gia: 'Thái' },
      ],
    },
    { ten: 'doanh thu', duKien: [{ nhan: 'Số bảng trong mô hình doanh thu', gia: '9' }] },
  ];

  /*
   * Backend chỉ lấy 60 nhãn đầu. Trang chi tiết một mô hình nhiều bảng sinh ra
   * hàng trăm dữ kiện, nên thứ tự này quyết định 60 nhãn đó là của thứ người
   * dùng ĐANG NHÌN hay của một mục nào đó ở cuối danh sách.
   */
  it('dữ kiện của nguồn đang chọn xếp trước', () => {
    const chonDoanhThu = trang[1]!;

    expect(duKienPhang(trang, chonDoanhThu)[0]?.nhan).toBe('Số bảng trong mô hình doanh thu');
    expect(duKienPhang(trang, trang[0]!)[0]?.nhan).toBe('Số bảng trong mô hình Global-Superstore');
  });

  /*
   * Hai mục trùng TÊN thì nhãn dữ kiện cũng trùng từng chữ, mà giá trị thì
   * khác. Mô hình chọn một nhãn, nên hai dòng giống hệt nhau là một lựa chọn
   * tung đồng xu. Giữ cái của nguồn đang chọn là cách duy nhất đoán có cơ sở.
   */
  it('nhãn trùng thì giữ cái của nguồn đang chọn', () => {
    const haiTrung: Nguon[] = [
      { ten: 'Kho', duKien: [{ nhan: 'Số bảng trong mô hình Kho', gia: '4' }] },
      { ten: 'Kho', duKien: [{ nhan: 'Số bảng trong mô hình Kho', gia: '9' }] },
    ];

    expect(duKienPhang(haiTrung, haiTrung[1]!)).toEqual([
      { nhan: 'Số bảng trong mô hình Kho', gia: '9' },
    ]);
  });
});
