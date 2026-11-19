import { describe, expect, it } from 'vitest';

import {
  banDoGop,
  canhBaoCot,
  khoaNhom,
  nhomCachViet,
  nhomGanGiong,
} from '../src/services/dataset/chatLuong';
import { normalizeCell } from '../src/services/dataset/normalizeCell';

/**
 * Chất lượng dữ liệu ở bước xem trước — vá A2 và C3.
 *
 * ⚠️ Lỗi đã đo khi dùng hệ thống như người thật, trên một tệp bán hàng chữ gõ
 * tay: biểu đồ "doanh thu theo khu vực" hiện NĂM cột cho BA khu vực.
 *
 *     Miền Trung  15.980.000
 *     Miền Nam     6.340.000
 *     Miền Bắc     2.050.000
 *     MIỀN NAM       560.000   <- cùng là Miền Nam
 *     miền bắc           750   <- cùng là Miền Bắc
 *
 * Không có cảnh báo nào, không có cách nào gộp. Bộ này canh cả ba phần của bản
 * vá: nhận ra nhóm, chọn ĐÚNG cách viết đại diện, và không chạm tới những ô
 * không liên quan.
 */

const KHU_VUC = [
  'Miền Nam',
  'Miền Trung',
  'MIỀN NAM',
  'Miền Bắc',
  'miền bắc',
  'Miền Nam',
  'Miền  Nam',
];

describe('khoaNhom', () => {
  it('bỏ khoảng trắng hai đầu, co chuỗi trắng, hạ chữ thường — kể cả chữ có dấu', () => {
    expect(khoaNhom('  MIỀN NAM ')).toBe('miền nam');
    expect(khoaNhom('Miền  Nam')).toBe('miền nam');
    expect(khoaNhom('Miền Nam')).toBe('miền nam');
  });

  it('KHÔNG bỏ dấu tiếng Việt — "Miên" và "Miền" là hai nơi khác nhau', () => {
    expect(khoaNhom('Miên Nam')).not.toBe(khoaNhom('Miền Nam'));
  });
});

describe('nhomCachViet', () => {
  it('chỉ giữ nhóm có TỪ HAI cách viết', () => {
    const nhom = nhomCachViet(KHU_VUC);
    expect([...nhom.keys()].sort()).toEqual(['miền bắc', 'miền nam']);
    // "Miền Trung" chỉ có một cách viết nên không có gì để gộp, và cũng không có
    // gì để cảnh báo.
    expect(nhom.has('miền trung')).toBe(false);
  });

  it('bỏ qua ô trống', () => {
    expect(nhomCachViet(['', '   ', 'Hà Nội']).size).toBe(0);
  });
});

describe('banDoGop — cách viết đại diện là cách NHIỀU NHẤT', () => {
  it('giữ chữ của người dùng, không sinh một dạng máy móc', () => {
    const map = banDoGop(KHU_VUC);
    // "Miền Nam" xuất hiện 3 lần (kể cả bản hai dấu cách đã co lại), "MIỀN NAM"
    // một lần.
    expect(map?.['miền nam']).toBe('Miền Nam');
  });

  it('HOÀ thì chọn dạng viết hoa đầu chữ — đã đo trên tệp thật', () => {
    /*
     * Ca này đến từ một lần chạy e2e đỏ, không phải từ suy đoán. Tệp có `Miền
     * Bắc` và `miền bắc` mỗi bên một lần; thứ tự chữ cái tiếng Việt đưa dạng
     * chữ thường lên trước, nên nhãn biểu đồ thành "miền bắc" trong một tệp mà
     * mọi dòng khác đều viết hoa đầu chữ.
     */
    expect(banDoGop(['Miền Bắc', 'miền bắc'])?.['miền bắc']).toBe('Miền Bắc');
    expect(banDoGop(['HÀ NỘI', 'Hà Nội'])?.['hà nội']).toBe('Hà Nội');
    // VIẾT HOA HẾT vẫn hơn viết thường hết: nó ít nhất còn đúng ở chữ đầu.
    expect(banDoGop(['HÀ NỘI', 'hà nội'])?.['hà nội']).toBe('HÀ NỘI');
  });

  it('ổn định với mọi thứ tự đọc tệp — bản đồ được LƯU', () => {
    // Một lần đọc theo thứ tự này, lần sau theo thứ tự khác, kết quả phải y hệt:
    // bản đồ nằm trong `dataset_columns.value_map` và nhãn biểu đồ dựa vào nó.
    expect(banDoGop(['Hà Nội', 'HÀ NỘI'])).toEqual(banDoGop(['HÀ NỘI', 'Hà Nội']));
    expect(banDoGop(['a', 'A', 'a'])).toEqual(banDoGop(['A', 'a', 'a']));
  });

  it('SỐ ĐẾM vẫn thắng hình thức — dữ liệu nói to hơn thẩm mỹ', () => {
    // Người dùng viết "MIỀN NAM" ở 9 dòng và "Miền Nam" ở 1 dòng thì nhãn của
    // họ là "MIỀN NAM", dù dạng kia đẹp hơn.
    const nhieuHoa = [...Array<string>(9).fill('MIỀN NAM'), 'Miền Nam'];
    expect(banDoGop(nhieuHoa)?.['miền nam']).toBe('MIỀN NAM');
  });

  it('không có nhóm trùng -> null, không phải map rỗng', () => {
    // Map rỗng nghĩa là mọi ô của cột đều phải tra một bảng không bao giờ trả
    // về gì — và `value_map` khi đó chiếm một dòng JSON vô nghĩa trong DB.
    expect(banDoGop(['Hà Nội', 'Đà Nẵng'])).toBeNull();
  });
});

describe('canhBaoCot', () => {
  it('cột chữ có nhóm trùng -> cảnh báo kèm ví dụ THẬT và số nhóm', () => {
    const [canhBao, ...con] = canhBaoCot('Khu vực', 0, KHU_VUC, 'text');
    expect(con).toHaveLength(0);
    expect(canhBao?.loai).toBe('hoa-thuong');
    expect(canhBao?.soNhom).toBe(2);
    expect(canhBao?.sourceName).toBe('Khu vực');
    // Ví dụ phải là chữ trong tệp, không phải câu chung chung: không có nó thì
    // người dùng không biết đi tìm chỗ nào.
    expect(canhBao?.viDu).toContain('Miền Nam');
    expect(canhBao?.viDu).toContain('MIỀN NAM');
  });

  it('cột chữ sạch -> không cảnh báo gì', () => {
    expect(canhBaoCot('Khu vực', 0, ['Hà Nội', 'Đà Nẵng'], 'text')).toEqual([]);
  });

  it('ô mơ hồ sắp bị đọc thành thập phân -> cảnh báo kèm CON SỐ sẽ vào kho', () => {
    // Chính ví dụ của C3 trong báo cáo QA. `1,250,000` là bằng chứng kiểu Anh,
    // nên cả cột đọc theo kiểu Anh, nên `750.000` vào kho thành 750 — có thể
    // đúng, có thể là 750 nghìn. Hệ thống không đoán hộ; nó nói ra con số.
    const [canhBao] = canhBaoCot('Doanh thu', 2, ['1,250,000', '980000', '750.000'], 'number');
    expect(canhBao?.loai).toBe('so-mo-ho');
    expect(canhBao?.viDu).toEqual(['750.000']);
    expect(canhBao?.docThanh).toBe('750');
  });

  it('cột KHÔNG có bằng chứng nào, chỉ có ô mơ hồ -> vẫn cảnh báo', () => {
    // Ca 50/50 thật đã đo trên `Global-Superstore`: không nhân lên 1000 lần là
    // lựa chọn đúng, nhưng im lặng về nó thì không.
    const [canhBao] = canhBaoCot('Gia', 1, ['750.000', '15.000'], 'number');
    expect(canhBao?.loai).toBe('so-mo-ho');
    expect(canhBao?.docThanh).toBe('750');
  });

  it('cột kết luận được là kiểu VIỆT -> im lặng, không còn gì để quyết', () => {
    // `1.250.000` là bằng chứng không mơ hồ, nên `750.000` đã vào kho thành
    // 750.000 — đúng ý người dùng, nên một cảnh báo ở đây chỉ là tiếng ồn.
    expect(canhBaoCot('Doanh thu', 2, ['1.250.000', '750.000'], 'number')).toEqual([]);
  });

  it('cột số KHÔNG có ô mơ hồ nào -> im lặng', () => {
    expect(canhBaoCot('So luong', 0, ['12', '1,250,000', '0.5'], 'number')).toEqual([]);
  });

  it('KHÔNG soi hoa/thường trên cột số và cột ngày', () => {
    // `1.000` và `1,000` không phải hai "cách viết" cần gộp — đó là việc của
    // `number_format`, và trả lời ở hai nơi là hai câu trả lời khác nhau.
    expect(canhBaoCot('So', 0, ['1', '1'], 'number')).toEqual([]);
    expect(canhBaoCot('Ngay', 0, ['01/02/2026', '01/02/2026'], 'date')).toEqual([]);
  });
});

describe('nhomGanGiong — chỉ khác DẤU', () => {
  /*
   * Phần còn lại của mong muốn D1. Chỉ CẢNH BÁO, không gộp: bỏ dấu là phép biến
   * đổi MẤT thông tin, nên không có cách nào biết dạng nào mới là dạng người
   * dùng muốn — và "Miền" với "Miên" có thể là hai thứ khác nhau thật.
   */
  it('nhận ra hai nhóm chỉ khác dấu', () => {
    const nhom = nhomGanGiong(['Miền Nam', 'Mien Nam', 'Miền Bắc']);
    expect(nhom).toHaveLength(1);
    expect(nhom[0]?.slice().sort()).toEqual(['Mien Nam', 'Miền Nam']);
  });

  it('đọc được cả chữ Đ — nó là chữ CÁI riêng trong Unicode, không phải d + dấu', () => {
    // Thiếu dòng `đ -> d` thì ca này đỏ: hai chuỗi vẫn khác khoá nên không cặp
    // nào được báo.
    expect(nhomGanGiong(['Đà Nẵng', 'Da Nang'])).toHaveLength(1);
  });

  it('khác chữ hoa thường thì KHÔNG tính là gần giống', () => {
    // `MIỀN NAM` và `Miền Nam` là CÙNG một nhóm và đã có đường xử lý riêng
    // (`banDoGop`). Báo thêm ở đây là hai cảnh báo cho một chuyện.
    expect(nhomGanGiong(['MIỀN NAM', 'Miền Nam'])).toEqual([]);
  });

  it('cột sạch thì im lặng', () => {
    expect(nhomGanGiong(['Hà Nội', 'Đà Nẵng', 'Cần Thơ'])).toEqual([]);
  });

  it('canhBaoCot trả CẢ HAI loại khi cột vướng cả hai', () => {
    const ra = canhBaoCot('Khu vực', 0, ['Miền Nam', 'MIỀN NAM', 'Mien Nam'], 'text');
    expect(
      ra
        .map((c) => c.loai)
        .slice()
        .sort(),
    ).toEqual(['gan-giong', 'hoa-thuong']);
  });
});

describe('normalizeCell áp bản đồ gộp', () => {
  const map = { 'miền nam': 'Miền Nam', 'miền bắc': 'Miền Bắc' };

  it('mọi cách viết của nhóm về cùng một nhãn', () => {
    expect(normalizeCell('MIỀN NAM', 'text', { valueMap: map })).toBe('Miền Nam');
    expect(normalizeCell('  miền nam  ', 'text', { valueMap: map })).toBe('Miền Nam');
    expect(normalizeCell('Miền  Nam', 'text', { valueMap: map })).toBe('Miền Nam');
  });

  it('cách viết KHÔNG có trong mẫu vẫn gộp đúng', () => {
    // Mẫu chỉ 200 dòng đầu, nên `mIỀn NaM` ở dòng 5.000 chưa từng được thấy.
    // Khoá tra là dạng đã hạ chữ, nên nhóm của nó vẫn được nhận ra.
    expect(normalizeCell('mIỀn NaM', 'text', { valueMap: map })).toBe('Miền Nam');
  });

  it('ô ngoài mọi nhóm giữ nguyên TỪNG KÝ TỰ', () => {
    // Kể cả khoảng trắng kép: bản đồ chỉ nói về nhóm đã thật sự có hai cách
    // viết, sửa ô khác là biến đổi dữ liệu người dùng không đồng ý.
    expect(normalizeCell('Tây  Nguyên', 'text', { valueMap: map })).toBe('Tây  Nguyên');
  });

  it('không có bản đồ -> hành vi y như trước bản vá', () => {
    expect(normalizeCell('MIỀN NAM', 'text')).toBe('MIỀN NAM');
    expect(normalizeCell('MIỀN NAM', 'text', { valueMap: null })).toBe('MIỀN NAM');
  });

  it('bản đồ KHÔNG chạm tới cột số, ngày, đúng-sai', () => {
    expect(normalizeCell('750.000', 'number', { numberFormat: 'vn', valueMap: map })).toBe(750000);
    expect(normalizeCell('01/02/2026', 'date', { valueMap: map })).toBe('01/02/2026');
  });
});
