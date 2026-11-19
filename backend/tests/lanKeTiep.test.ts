import { describe, expect, it } from 'vitest';

import { LECH_GIO_VIET_NAM, tinhLanKeTiep } from '../src/services/report/lanKeTiep';

/**
 * Mốc gửi kế tiếp của lịch định kỳ — mong muốn D6.
 *
 * ⚠️ Đây là phần duy nhất của D6 có thể SAI MÀ KHÔNG AI THẤY: lệch một giờ thì
 * thư vẫn gửi, lịch vẫn trông như đang chạy, chỉ là sai giờ. Nên mọi ca ở đây
 * viết bằng giờ VIỆT NAM đọc ra thành câu được, rồi đổi sang UTC bằng đúng một
 * hàm — không ca nào dựa vào múi giờ của máy chạy test.
 */

/** Dựng một mốc UTC từ giờ Việt Nam, để ca test đọc được như người nói. */
function gioVn(nam: number, thang: number, ngay: number, gio: number, phut = 0): Date {
  return new Date(Date.UTC(nam, thang - 1, ngay, gio - LECH_GIO_VIET_NAM, phut));
}

/** Đọc một mốc UTC ra thành giờ Việt Nam, dạng `YYYY-MM-DD HH:mm`. */
function docVn(d: Date): string {
  const vn = new Date(d.getTime() + LECH_GIO_VIET_NAM * 3_600_000);
  const hai = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(vn.getUTCFullYear())}-${hai(vn.getUTCMonth() + 1)}-${hai(vn.getUTCDate())} ` +
    `${hai(vn.getUTCHours())}:${hai(vn.getUTCMinutes())}`
  );
}

describe('hằng ngày', () => {
  it('chưa tới giờ hôm nay -> hôm nay', () => {
    // 6 giờ sáng thứ Ba, lịch 8 giờ -> 8 giờ sáng cùng ngày.
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 6), { tanSuat: 'hang-ngay', gio: 8 });
    expect(docVn(kq)).toBe('2026-03-10 08:00');
  });

  it('đã qua giờ -> hôm sau', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 9), { tanSuat: 'hang-ngay', gio: 8 });
    expect(docVn(kq)).toBe('2026-03-11 08:00');
  });

  it('ĐÚNG giờ -> hôm sau, không phải ngay bây giờ', () => {
    /*
     * Ca quan trọng nhất của cả file. Vòng lặp nền gửi xong rồi gọi hàm này để
     * đặt mốc kế tiếp; trả về đúng mốc vừa gửi là lịch tới hạn ngay lập tức, và
     * một thư thành một trăm thư trong một phút.
     */
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 8), { tanSuat: 'hang-ngay', gio: 8 });
    expect(docVn(kq)).toBe('2026-03-11 08:00');
  });

  it('nửa đêm cũng là một giờ hợp lệ', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 23, 30), { tanSuat: 'hang-ngay', gio: 0 });
    expect(docVn(kq)).toBe('2026-03-11 00:00');
  });
});

describe('hằng tuần', () => {
  it('chiều Chủ nhật, lịch 8 giờ thứ Hai -> sáng mai', () => {
    // 2026-03-08 là Chủ nhật; 2026-03-09 là thứ Hai.
    const kq = tinhLanKeTiep(gioVn(2026, 3, 8, 16), { tanSuat: 'hang-tuan', gio: 8, thu: 1 });
    expect(docVn(kq)).toBe('2026-03-09 08:00');
  });

  it('đúng thứ Hai nhưng đã 9 giờ -> thứ Hai TUẦN SAU', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 9, 9), { tanSuat: 'hang-tuan', gio: 8, thu: 1 });
    expect(docVn(kq)).toBe('2026-03-16 08:00');
  });

  it('thứ Ba hỏi lịch thứ Hai -> sáu ngày sau', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 10), { tanSuat: 'hang-tuan', gio: 8, thu: 1 });
    expect(docVn(kq)).toBe('2026-03-16 08:00');
  });

  it('Chủ nhật là 7, không phải 0', () => {
    // `getUTCDay()` trả 0 cho Chủ nhật; nhầm quy ước ở đây là lệch cả tuần.
    const kq = tinhLanKeTiep(gioVn(2026, 3, 9, 10), { tanSuat: 'hang-tuan', gio: 20, thu: 7 });
    expect(docVn(kq)).toBe('2026-03-15 20:00');
  });
});

describe('hằng tháng', () => {
  it('chưa tới ngày -> trong tháng này', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 2, 10), { tanSuat: 'hang-thang', gio: 7, ngay: 5 });
    expect(docVn(kq)).toBe('2026-03-05 07:00');
  });

  it('đã qua ngày -> tháng sau', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 3, 20, 10), { tanSuat: 'hang-thang', gio: 7, ngay: 5 });
    expect(docVn(kq)).toBe('2026-04-05 07:00');
  });

  it('tháng 12 cuộn sang năm mới', () => {
    const kq = tinhLanKeTiep(gioVn(2026, 12, 20, 10), { tanSuat: 'hang-thang', gio: 7, ngay: 5 });
    expect(docVn(kq)).toBe('2027-01-05 07:00');
  });

  it('ngày 28 vẫn tồn tại ở tháng Hai — kể cả năm không nhuận', () => {
    // Đây là lý do trần là 28: ngày 29–31 sẽ im lặng bỏ tháng Hai, và người dùng
    // chỉ phát hiện sau vài tháng không nhận được thư.
    const kq = tinhLanKeTiep(gioVn(2027, 2, 1, 10), { tanSuat: 'hang-thang', gio: 9, ngay: 28 });
    expect(docVn(kq)).toBe('2027-02-28 09:00');
  });
});

describe('không phụ thuộc múi giờ của máy chạy', () => {
  it('mốc trả về là UTC, lệch đúng 7 giờ so với giờ Việt Nam', () => {
    /*
     * Máy dev chạy UTC+7, máy chủ chạy UTC. Dùng `getHours()` (giờ địa phương)
     * ở bất kỳ đâu trong phép tính là làm hai máy cho hai kết quả khác nhau cho
     * cùng một lịch — và không có bài test nào trên máy dev thấy được điều đó.
     */
    const kq = tinhLanKeTiep(gioVn(2026, 3, 10, 6), { tanSuat: 'hang-ngay', gio: 8 });
    expect(kq.getUTCHours()).toBe(1);
    expect(kq.toISOString()).toBe('2026-03-10T01:00:00.000Z');
  });
});
