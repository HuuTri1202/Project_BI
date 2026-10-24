import { describe, expect, it } from 'vitest';

import { CUM_CO_DINH, giaiCum } from '../src/services/chat/khoangThoiGian';

/**
 * Cụm thời gian thành khoảng ngày — §chat.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Mọi con số của một câu hỏi có mốc thời gian đứng trên hai chuỗi mà hàm này
 * sinh ra. Lệch một ngày ở đây là lệch một ngày trong MỌI câu trả lời về thời
 * gian, và không có gì trên màn hình tố giác: truy vấn chạy, số ra đẹp, chỉ
 * là nó của một khoảng khác.
 *
 * Nên bốn chỗ được canh riêng, vì cả bốn đều là chỗ code ngày tháng hay sai:
 *
 *   1. **Mốc cuối HỞ.** Cột có thể là `DateTime`; `lte '2026-10-31'` cắt mất
 *      gần cả ngày 31. Mọi ca dưới đây đòi `truocKhi` là ngày SAU khoảng.
 *   2. **Vắt qua biên.** Tháng 1 lùi về tháng 12 năm trước, quý 1 lùi về quý
 *      4 năm trước — hai chỗ một phép trừ thẳng sẽ ra tháng 0 / quý -1.
 *   3. **Tuần bắt đầu THỨ HAI.** `getDay()` trả 0 cho Chủ nhật, nên bản ngây
 *      thơ cho ra tuần kiểu Mỹ. Ca Chủ nhật là ca bắt đúng chuyện đó.
 *   4. **Cụm lạ thì TỪ CHỐI.** Đoán một khoảng là tự đặt câu hỏi hộ người dùng.
 */

/** Thứ Năm 2026-10-15. Chọn giữa tháng, giữa tuần, giữa quý 4 — không trùng biên nào. */
const MOC = new Date(2026, 9, 15);

describe('Cụm cố định', () => {
  it('hôm nay / hôm qua', () => {
    expect(giaiCum('hom-nay', MOC)).toEqual({ tu: '2026-10-15', truocKhi: '2026-10-16' });
    expect(giaiCum('hom-qua', MOC)).toEqual({ tu: '2026-10-14', truocKhi: '2026-10-15' });
  });

  /** 2026-10-15 là thứ Năm, nên thứ Hai của tuần đó là 2026-10-12. */
  it('tuần này bắt đầu THỨ HAI, không phải Chủ nhật', () => {
    expect(giaiCum('tuan-nay', MOC)).toEqual({ tu: '2026-10-12', truocKhi: '2026-10-19' });
    expect(giaiCum('tuan-truoc', MOC)).toEqual({ tu: '2026-10-05', truocKhi: '2026-10-12' });
  });

  /*
   * ⚠️ Ca bắt bản ngây thơ.
   *
   * 2026-10-18 là CHỦ NHẬT. Tính thẳng theo `getDay()` (trả 0) thì "tuần này"
   * thành 18→25, tức là tuần SAU theo cách người dùng của hệ này đếm. Tuần
   * chứa Chủ nhật 18 phải là 12→19.
   */
  it('Chủ nhật vẫn thuộc tuần bắt đầu từ thứ Hai TRƯỚC nó', () => {
    expect(giaiCum('tuan-nay', new Date(2026, 9, 18))).toEqual({
      tu: '2026-10-12',
      truocKhi: '2026-10-19',
    });
  });

  it('tháng này / tháng trước', () => {
    expect(giaiCum('thang-nay', MOC)).toEqual({ tu: '2026-10-01', truocKhi: '2026-11-01' });
    expect(giaiCum('thang-truoc', MOC)).toEqual({ tu: '2026-09-01', truocKhi: '2026-10-01' });
  });

  it('quý này / quý trước — tháng 10 là quý 4', () => {
    expect(giaiCum('quy-nay', MOC)).toEqual({ tu: '2026-10-01', truocKhi: '2027-01-01' });
    expect(giaiCum('quy-truoc', MOC)).toEqual({ tu: '2026-07-01', truocKhi: '2026-10-01' });
  });

  it('năm nay / năm trước', () => {
    expect(giaiCum('nam-nay', MOC)).toEqual({ tu: '2026-01-01', truocKhi: '2027-01-01' });
    expect(giaiCum('nam-truoc', MOC)).toEqual({ tu: '2025-01-01', truocKhi: '2026-01-01' });
  });

  /** "7 ngày qua" TÍNH CẢ hôm nay: 9→15 là bảy ngày, không phải tám. */
  it('N ngày qua tính cả hôm nay', () => {
    expect(giaiCum('7-ngay-qua', MOC)).toEqual({ tu: '2026-10-09', truocKhi: '2026-10-16' });
    expect(giaiCum('30-ngay-qua', MOC)).toEqual({ tu: '2026-09-16', truocKhi: '2026-10-16' });
    expect(giaiCum('90-ngay-qua', MOC)).toEqual({ tu: '2026-07-18', truocKhi: '2026-10-16' });
  });

  /*
   * Mọi cụm gửi cho mô hình phải giải được.
   *
   * Thêm một chuỗi vào `CUM_CO_DINH` mà quên dạy `giaiCum` thì lời nhắc mời
   * mô hình chọn một cụm rồi `kiemForm` bỏ cả form mỗi lần nó chọn đúng cái
   * cụm ấy — một đường cụt im lặng.
   */
  it('mọi cụm trong danh sách gửi cho mô hình đều giải được', () => {
    for (const cum of CUM_CO_DINH) {
      expect(giaiCum(cum, MOC), cum).not.toBeNull();
    }
  });
});

describe('Vắt qua biên năm', () => {
  /** ⚠️ `m - 1` khi `m === 0` phải ra tháng 12 năm trước, không phải tháng 0. */
  it('tháng trước của tháng Một là tháng 12 năm trước', () => {
    expect(giaiCum('thang-truoc', new Date(2026, 0, 9))).toEqual({
      tu: '2025-12-01',
      truocKhi: '2026-01-01',
    });
  });

  /** ⚠️ Cùng cái bẫy, một tầng trên: quý trước của quý 1. */
  it('quý trước của quý 1 là quý 4 năm trước', () => {
    expect(giaiCum('quy-truoc', new Date(2026, 1, 9))).toEqual({
      tu: '2025-10-01',
      truocKhi: '2026-01-01',
    });
  });

  it('"30 ngày qua" bắt đầu từ tháng 12 khi hôm nay là đầu tháng Một', () => {
    expect(giaiCum('30-ngay-qua', new Date(2026, 0, 5))).toEqual({
      tu: '2025-12-07',
      truocKhi: '2026-01-06',
    });
  });

  /** Năm nhuận: 2028-02 có 29 ngày, nên mốc hở vẫn là 03-01. */
  it('tháng Hai năm nhuận', () => {
    expect(giaiCum('thang-2', new Date(2028, 5, 1))).toEqual({
      tu: '2028-02-01',
      truocKhi: '2028-03-01',
    });
  });
});

describe('Ba khuôn mang số', () => {
  it('thang-N là tháng N của NĂM NAY', () => {
    expect(giaiCum('thang-3', MOC)).toEqual({ tu: '2026-03-01', truocKhi: '2026-04-01' });
    expect(giaiCum('thang-12', MOC)).toEqual({ tu: '2026-12-01', truocKhi: '2027-01-01' });
  });

  it('quy-N là quý N của năm nay', () => {
    expect(giaiCum('quy-1', MOC)).toEqual({ tu: '2026-01-01', truocKhi: '2026-04-01' });
    expect(giaiCum('quy-4', MOC)).toEqual({ tu: '2026-10-01', truocKhi: '2027-01-01' });
  });

  it('nam-YYYY', () => {
    expect(giaiCum('nam-2024', MOC)).toEqual({ tu: '2024-01-01', truocKhi: '2025-01-01' });
  });
});

/**
 * Cụm lạ phải TỪ CHỐI.
 *
 * `null` ở đây làm `kiemForm` bỏ cả form, tức khung nói "chưa hiểu" — một
 * thất bại nhìn thấy được. Đoán một khoảng là tự đặt câu hỏi hộ người dùng
 * rồi trả lời câu mình vừa đặt.
 */
describe('Cụm không nhận ra', () => {
  it.each([
    ['thang-0', 'tháng 0 không tồn tại'],
    ['thang-13', 'ngoài 1..12'],
    ['quy-0', 'ngoài 1..4'],
    ['quy-5', 'ngoài 1..4'],
    ['nam-1999', 'ngoài 2000..2100 — dấu hiệu mô hình đang bịa'],
    ['nam-2101', 'ngoài 2000..2100'],
    ['nam-99', 'không đủ bốn chữ số'],
    ['2026-10-01', '⚠️ một NGÀY, không phải một cụm — mô hình không được viết ngày'],
    ['tháng này', 'có dấu: danh sách là chuỗi không dấu'],
    ['last-month', 'tiếng Anh không nằm trong danh sách'],
    ['', 'rỗng'],
  ])('từ chối %s (%s)', (cum) => {
    expect(giaiCum(cum, MOC)).toBeNull();
  });
});
