import { describe, expect, it } from 'vitest';

import {
  ORDER_CODE_LENGTH,
  isOrderCode,
  newOrderCode,
} from '../src/services/billing/orderCode';
import { daHetHan, hanThanhToan, tinhChuKy } from '../src/services/billing/period';
import { timMaDon } from '../src/services/billing/webhook';
import { signPayload, verifySignature } from '../src/services/billing/webhookSignature';
import { buildVietQrPayload, crc16, normalizeContent } from '../src/services/billing/vietqr';

/**
 * Test đơn vị của §11 — KHÔNG cần container nào đang chạy.
 *
 * Cùng khuôn `ingestTypeMap.test.ts` và `datamodelSchema.test.ts`: mọi luật khó
 * của mục này nằm trong ba hàm thuần, nên chúng phải kiểm được mà không phụ
 * thuộc MySQL hay Redis. Phần ràng buộc do database giữ nằm ở
 * `billing.integration.test.ts`.
 */

describe('§11 mã đơn hàng', () => {
  it('đúng độ dài và đúng khuôn CHAR(12) của cột', () => {
    const code = newOrderCode();
    expect(code).toHaveLength(ORDER_CODE_LENGTH);
    expect(ORDER_CODE_LENGTH).toBe(12);
    expect(isOrderCode(code)).toBe(true);
  });

  it('KHÔNG chứa I, L, O, U — mã này sẽ bị đọc qua điện thoại', () => {
    /*
     * Ca này không phải chuyện thẩm mỹ. Người vận hành đọc mã cho kế toán, hoặc
     * khách gõ lại mã vào ứng dụng ngân hàng. `0` với `O` và `1` với `I` là lỗi
     * chép tay được bảo đảm sẽ xảy ra, và hậu quả là một khoản tiền vào tài
     * khoản với nội dung không khớp đơn nào — phải dò tay mới tìm ra.
     *
     * 500 mã để ca này không xanh nhờ may mắn: với 32 ký tự thì xác suất một mã
     * đơn lẻ tránh được cả bốn chữ cái là cao, nhưng 5000 ký tự thì không.
     *
     * Chỉ xét PHẦN THÂN. Tiền tố `BI` có chữ `I` và đó không sao: nó cố định ở
     * mọi mã, nên người đọc không bao giờ phải đoán nó là `I` hay `1`. Ràng
     * buộc thật nằm ở mười ký tự sinh ngẫu nhiên phía sau. (Bản đầu của ca này
     * xét cả chuỗi và đỏ ngay lần chạy đầu — đúng kiểu khẳng định viết ẩu hơn
     * là điều mình thật sự muốn nói.)
     */
    for (let i = 0; i < 500; i += 1) {
      expect(newOrderCode().slice(2)).not.toMatch(/[ILOU]/);
    }
  });

  it('chỉ gồm chữ HOA và số, để sống sót qua bộ lọc của ngân hàng', () => {
    // Nhiều ngân hàng lọc bỏ ký tự không phải chữ-số rồi ép hoa trước khi ghi
    // nội dung vào sao kê. Một mã có ký tự thường hoặc dấu gạch sẽ hiện trên
    // sao kê KHÁC với mã trong database, và việc đối chiếu không bao giờ khớp.
    for (let i = 0; i < 200; i += 1) {
      expect(newOrderCode()).toMatch(/^BI[0-9A-Z]{10}$/);
    }
  });

  it('không đoán được: 1000 mã liên tiếp KHÔNG trùng nhau và không tăng dần', () => {
    // Nếu ai đó thay `randomBytes` bằng một bộ đếm hay `Date.now()`, ca này đỏ.
    // Đó là thay đổi trông vô hại — và nó biến mã đơn thành thứ đoán được, tức
    // là đọc được đơn hàng của tổ chức khác.
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) codes.add(newOrderCode());
    expect(codes.size).toBe(1000);

    const list = [...codes];
    const sorted = [...list].sort();
    expect(list).not.toEqual(sorted);
  });

  it('từ chối chuỗi rác, kể cả chuỗi gần giống', () => {
    expect(isOrderCode('BI0123456789')).toBe(true);
    // Chữ thường.
    expect(isOrderCode('bi0123456789')).toBe(false);
    // Thiếu một ký tự.
    expect(isOrderCode('BI012345678')).toBe(false);
    // Chứa ký tự nằm ngoài bảng chữ.
    expect(isOrderCode('BI0123456I89')).toBe(false);
    expect(isOrderCode('')).toBe(false);
    // Chuỗi tấn công: phải bị từ chối TRƯỚC khi đi tới database.
    expect(isOrderCode("BI' OR 1=1 --")).toBe(false);
  });
});

describe('§11 chuỗi VietQR', () => {
  const MAU = {
    bankBin: '970436',
    accountNo: '1234567890',
    amountVnd: 299000,
    content: 'BI7K3XQ92FMR',
  };

  it('CRC-16/CCITT-FALSE khớp vector chuẩn', () => {
    /*
     * `crc16('123456789') === '29B1'` là vector kiểm chuẩn của biến thể
     * CCITT-FALSE. Nó ở đây vì có hàng chục biến thể CRC-16, và chọn nhầm cho
     * ra bốn chữ số trông hoàn toàn hợp lệ mà MỌI ứng dụng ngân hàng đều từ
     * chối — với thông báo "mã QR không hợp lệ", không nói gì về CRC.
     */
    expect(crc16('123456789')).toBe('29B1');
  });

  it('chuỗi mở đầu đúng và kết thúc bằng CRC bốn ký tự', () => {
    const payload = buildVietQrPayload(MAU);
    // 00 02 01 = phiên bản; 01 02 12 = QR ĐỘNG dùng một lần.
    expect(payload.startsWith('000201010212')).toBe(true);
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('CRC tính TRÊN CẢ tag 6304 — đây là chỗ dễ sai nhất', () => {
    // Chuẩn EMVCo bắt CRC phải bao gồm chính tag và độ dài của trường CRC. Bỏ
    // sót bốn ký tự đó cho ra một chuỗi trông đúng y hệt mà không máy nào đọc
    // được, và không có cách nào phát hiện bằng mắt.
    const payload = buildVietQrPayload(MAU);
    const than = payload.slice(0, -4);
    expect(than.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16(than));
  });

  it('mang đủ ngân hàng, số tài khoản, số tiền và nội dung', () => {
    const payload = buildVietQrPayload(MAU);
    // GUID của NAPAS.
    expect(payload).toContain('A000000727');
    expect(payload).toContain('0006970436');
    expect(payload).toContain('01101234567890');
    // Chuyển tới TÀI KHOẢN, không phải tới thẻ.
    expect(payload).toContain('QRIBFTTA');
    // 704 = VND; 54 06 299000 = số tiền.
    expect(payload).toContain('5303704');
    expect(payload).toContain('5406299000');
    expect(payload).toContain('BI7K3XQ92FMR');
  });

  it('số tiền KHÔNG nhân 100 — VND không có đơn vị phụ', () => {
    // Thói quen từ USD (lưu cent) sẽ khiến một đơn 299.000đ thành 29.900.000đ.
    // Ngân hàng vẫn nhận, khách vẫn quét được, và số tiền sai gấp trăm lần.
    const payload = buildVietQrPayload({ ...MAU, amountVnd: 299000 });
    expect(payload).toContain('5406299000');
    expect(payload).not.toContain('29900000');
  });

  it('đổi bất kỳ thứ gì thì CRC cũng đổi', () => {
    const goc = buildVietQrPayload(MAU);
    const khacTien = buildVietQrPayload({ ...MAU, amountVnd: 299001 });
    const khacNoiDung = buildVietQrPayload({ ...MAU, content: 'BI7K3XQ92FMS' });

    expect(khacTien).not.toBe(goc);
    expect(khacNoiDung).not.toBe(goc);
    expect(khacTien.slice(-4)).not.toBe(goc.slice(-4));
  });

  it('từ chối dữ liệu vô lý thay vì sinh ra một mã QR hỏng', () => {
    // Một mã QR hỏng chỉ lộ ra khi khách đã mở ứng dụng ngân hàng và quét —
    // muộn nhất có thể, và ở phía họ.
    expect(() => buildVietQrPayload({ ...MAU, bankBin: '97043' })).toThrow(/6 chữ số/);
    expect(() => buildVietQrPayload({ ...MAU, bankBin: 'VCB' })).toThrow(/6 chữ số/);
    expect(() => buildVietQrPayload({ ...MAU, amountVnd: 0 })).toThrow(/số nguyên dương/);
    expect(() => buildVietQrPayload({ ...MAU, amountVnd: -1 })).toThrow(/số nguyên dương/);
    expect(() => buildVietQrPayload({ ...MAU, amountVnd: 1500.5 })).toThrow(/số nguyên dương/);
  });

  it('nội dung bỏ dấu tiếng Việt thay vì xoá cả chữ', () => {
    // Ngân hàng ép hoa và lọc ký tự lạ trước khi ghi vào sao kê. Nếu ta không
    // chuẩn hoá giống họ thì chuỗi gửi đi khác chuỗi hiện trên sao kê, và việc
    // đối chiếu không bao giờ khớp.
    expect(normalizeContent('Đơn hàng 42')).toBe('DONHANG42');
    expect(normalizeContent('BI7K3XQ92FMR')).toBe('BI7K3XQ92FMR');
    expect(normalizeContent('a-b_c.d')).toBe('ABCD');
  });
});

describe('§11 chữ ký webhook', () => {
  const BODY = '{"orderCode":"BI7K3XQ92FMR","amount":299000}';
  const SECRET = 'khoa-bi-mat-cua-cong-thanh-toan';

  it('chữ ký ta tính khớp chính chữ ký ta ký', () => {
    expect(verifySignature({ rawBody: BODY, signature: signPayload(BODY, SECRET), secret: SECRET })).toBe(
      true,
    );
  });

  it('nhận cả dạng có tiền tố `sha256=`', () => {
    // Mỗi cổng viết một kiểu. Bắt nơi gọi tự bóc tiền tố nghĩa là mỗi adapter
    // lại bóc một lần, và chỗ nào quên thì MỌI webhook của cổng đó bị từ chối —
    // với thông báo "chữ ký sai" cho một chữ ký hoàn toàn đúng.
    const sig = signPayload(BODY, SECRET);
    expect(verifySignature({ rawBody: BODY, signature: `sha256=${sig}`, secret: SECRET })).toBe(true);
    expect(verifySignature({ rawBody: BODY, signature: sig.toUpperCase(), secret: SECRET })).toBe(true);
  });

  it('SAI khoá -> từ chối', () => {
    expect(
      verifySignature({ rawBody: BODY, signature: signPayload(BODY, 'khoa-khac'), secret: SECRET }),
    ).toBe(false);
  });

  it('đổi MỘT ký tự trong thân request -> từ chối', () => {
    /*
     * Ca quan trọng nhất của cả nhóm. Kẻ tấn công bắt được một webhook hợp lệ
     * rồi sửa số tiền từ 299.000 thành 1 và gửi lại — nếu chữ ký vẫn qua thì
     * mọi lớp bảo vệ ở trên vô nghĩa.
     */
    const sig = signPayload(BODY, SECRET);
    const sua = BODY.replace('299000', '000001');
    expect(verifySignature({ rawBody: sua, signature: sig, secret: SECRET })).toBe(false);
  });

  it('chữ ký RỖNG hoặc khoá RỖNG -> từ chối, không ném', () => {
    // Cả hai là trạng thái thật: cổng gửi thiếu header, hoặc người vận hành
    // chưa cấu hình khoá. Ném ở đây sẽ thành 500 và cổng sẽ gửi lại mãi.
    expect(verifySignature({ rawBody: BODY, signature: '', secret: SECRET })).toBe(false);
    expect(verifySignature({ rawBody: BODY, signature: signPayload(BODY, SECRET), secret: '' })).toBe(
      false,
    );
  });

  it('chữ ký NGẮN HƠN không làm `timingSafeEqual` ném', () => {
    // `timingSafeEqual` NÉM khi hai buffer khác độ dài — không trả `false`. Bỏ
    // phép kiểm độ dài thì một chữ ký cụt biến thành 500 thay vì 401.
    expect(() =>
      verifySignature({ rawBody: BODY, signature: 'abc123', secret: SECRET }),
    ).not.toThrow();
    expect(verifySignature({ rawBody: BODY, signature: 'abc123', secret: SECRET })).toBe(false);
  });

  it('sha512 khác sha256 — thuật toán phải khớp hai đầu', () => {
    const sig512 = signPayload(BODY, SECRET, 'sha512');
    expect(verifySignature({ rawBody: BODY, signature: sig512, secret: SECRET, algorithm: 'sha512' })).toBe(
      true,
    );
    expect(verifySignature({ rawBody: BODY, signature: sig512, secret: SECRET })).toBe(false);
  });

  it('ký trên Buffer và trên chuỗi cho cùng kết quả', () => {
    // Route truyền `Buffer` (thân thô), test hay truyền chuỗi. Hai đường phải
    // ra một kết quả, nếu không thì test xanh mà thực tế đỏ.
    expect(signPayload(Buffer.from(BODY, 'utf8'), SECRET)).toBe(signPayload(BODY, SECRET));
  });
});

describe('§11 bóc mã đơn khỏi nội dung chuyển khoản', () => {
  it('lấy được mã lẫn trong chuỗi ngân hàng chèn thêm', () => {
    /*
     * Ngân hàng chèn chữ quanh nội dung khách gõ. Không bóc thì MỌI webhook của
     * ngân hàng đều trượt, và triệu chứng là "không tìm thấy đơn" cho những đơn
     * đang nằm ngay đó.
     */
    expect(timMaDon('CT DEN:0011 BI7K3XQ92FMR GD 123456')).toBe('BI7K3XQ92FMR');
    expect(timMaDon('bi7k3xq92fmr')).toBe('BI7K3XQ92FMR');
    expect(timMaDon('BI7K3XQ92FMR')).toBe('BI7K3XQ92FMR');
  });

  it('không bịa ra mã khi nội dung không có', () => {
    // Trả bừa một mã nghĩa là ghi nhận tiền cho một đơn ngẫu nhiên.
    expect(timMaDon('THANH TOAN DON HANG')).toBeNull();
    expect(timMaDon('')).toBeNull();
    expect(timMaDon(null)).toBeNull();
    // Chứa I/L/O/U -> không thuộc bảng chữ nên không phải mã của ta.
    expect(timMaDon('BIIIIIIIIIII')).toBeNull();
  });
});

describe('§11 tính chu kỳ gói', () => {
  const NOW = new Date('2026-03-10T08:00:00.000Z');
  const NGAY = 86_400_000;

  it('mua lần đầu: bắt đầu từ hôm nay, không cộng dồn gì', () => {
    const r = tinhChuKy({ now: NOW, currentPeriodEnd: null, durationDays: 30 });
    expect(r.periodStart).toEqual(NOW);
    expect(r.periodEnd).toEqual(new Date(NOW.getTime() + 30 * NGAY));
    expect(r.carriedOverDays).toBe(0);
  });

  it('gia hạn SỚM: cộng dồn từ hạn cũ, khách KHÔNG mất ngày', () => {
    /*
     * Đây là điều khách sẽ thử — mua lại trước hạn vài ngày để chắc chắn không
     * đứt dịch vụ. Nếu công thức đặt lại từ hôm nay thì họ mất đúng số ngày còn
     * lại, và họ sẽ phát hiện ra.
     */
    const hanCu = new Date(NOW.getTime() + 12 * NGAY);
    const r = tinhChuKy({ now: NOW, currentPeriodEnd: hanCu, durationDays: 30 });

    expect(r.periodEnd).toEqual(new Date(hanCu.getTime() + 30 * NGAY));
    expect(r.carriedOverDays).toBe(12);
    // Gói mới có hiệu lực NGAY, không phải chờ hết gói cũ.
    expect(r.periodStart).toEqual(NOW);
  });

  it('gia hạn MUỘN: hạn cũ đã qua thì tính từ hôm nay, không nối vào quá khứ', () => {
    // Không có nhánh này thì một tổ chức bỏ ba tháng rồi quay lại sẽ mua một
    // gói hết hạn từ trước khi họ trả tiền.
    const hanCu = new Date(NOW.getTime() - 90 * NGAY);
    const r = tinhChuKy({ now: NOW, currentPeriodEnd: hanCu, durationDays: 30 });

    expect(r.periodEnd).toEqual(new Date(NOW.getTime() + 30 * NGAY));
    expect(r.carriedOverDays).toBe(0);
  });

  it('nâng cấp giữa chu kỳ dùng ĐÚNG công thức đó, không có nhánh riêng', () => {
    // Ba nhánh `if` cho gia hạn / nâng cấp / hạ cấp là ba cách tính, tức ba chỗ
    // để lệch nhau. Ca này khẳng định chỉ có một cách.
    const hanCu = new Date(NOW.getTime() + 20 * NGAY);
    const nangCap = tinhChuKy({ now: NOW, currentPeriodEnd: hanCu, durationDays: 365 });

    expect(nangCap.periodEnd).toEqual(new Date(hanCu.getTime() + 365 * NGAY));
    expect(nangCap.carriedOverDays).toBe(20);
  });

  it('số ngày còn lại làm tròn XUỐNG', () => {
    // Nói ít hơn thực tế thì khách không bao giờ thấy mình bị hụt. Làm tròn lên
    // thì "được cộng 13 ngày" mà thực tế 12,4 — và họ sẽ đếm.
    const hanCu = new Date(NOW.getTime() + 12 * NGAY + 20 * 3_600_000);
    const r = tinhChuKy({ now: NOW, currentPeriodEnd: hanCu, durationDays: 30 });
    expect(r.carriedOverDays).toBe(12);
  });

  it('gói 0 ngày bị TỪ CHỐI — không ai được mua gói Free', () => {
    // Gói Free có `durationDays = 0` và không subscription nào trỏ vào nó (luật
    // "không dòng nào = đang ở Free"). Rơi vào đây là lỗi logic, và ném ngay
    // còn hơn tạo một subscription có `periodEnd = periodStart` rồi bị
    // `ck_subscriptions_period` chặn ở tận database với một thông báo khó hiểu.
    expect(() => tinhChuKy({ now: NOW, currentPeriodEnd: null, durationDays: 0 })).toThrow(
      /số nguyên dương/,
    );
  });

  it('hạn thanh toán là 15 phút, và hết hạn tính theo mốc tuyệt đối', () => {
    const han = hanThanhToan(NOW);
    expect(han.getTime() - NOW.getTime()).toBe(15 * 60_000);

    expect(daHetHan(han, NOW)).toBe(false);
    expect(daHetHan(han, new Date(han.getTime() - 1))).toBe(false);
    // Đúng thời điểm hết hạn thì đã hết — biên đóng, không để một đơn sống
    // thêm một mili-giây tuỳ theo chỗ nào hỏi.
    expect(daHetHan(han, han)).toBe(true);
    expect(daHetHan(han, new Date(han.getTime() + 1))).toBe(true);
  });
});
