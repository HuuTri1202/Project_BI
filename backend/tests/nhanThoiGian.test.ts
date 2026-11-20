import { describe, expect, it } from 'vitest';

import { nhanThoiGian } from '../src/utils/nhanThoiGian';

/**
 * Nhãn thời gian — xem khối chú thích đầu `nhanThoiGian.ts`.
 *
 * Bộ này canh đúng hai điều: đọc được cả hai dạng thô mà hai nhánh dữ liệu trả
 * về, và KHÔNG đi qua múi giờ nào.
 */
describe('nhanThoiGian', () => {
  it('dạng của Cube (chữ T, có mili giây)', () => {
    expect(nhanThoiGian('2026-08-04T00:00:00.000')).toBe('04/08/2026');
  });

  it('dạng của ClickHouse toString (dấu cách)', () => {
    expect(nhanThoiGian('2026-08-04 00:00:00.000')).toBe('04/08/2026');
  });

  it('ngày thuần, không phần giờ', () => {
    expect(nhanThoiGian('2026-12-31')).toBe('31/12/2026');
  });

  it('có giờ khác nửa đêm thì giữ giờ và phút', () => {
    expect(nhanThoiGian('2026-08-04T14:30:00.000')).toBe('04/08/2026 14:30');
  });

  /*
   * Mốc đổi ngày — ca duy nhất phân biệt được phép cắt chuỗi với một `new Date`.
   *
   * `2026-08-01T00:00:00` đọc bằng `Date` trên máy UTC-5 ra 31/07; đọc bằng cách
   * này thì ra 01/08 ở mọi nơi, đúng bằng thứ phần nạp đã ghi vào kho.
   */
  it('nửa đêm đầu tháng KHÔNG lùi về ngày hôm trước', () => {
    expect(nhanThoiGian('2026-08-01T00:00:00.000')).toBe('01/08/2026');
    expect(nhanThoiGian('2026-01-01T00:00:00.000')).toBe('01/01/2026');
  });

  it('chuỗi không phải thời gian thì trả nguyên văn', () => {
    expect(nhanThoiGian('Chi nhánh Quận 1')).toBe('Chi nhánh Quận 1');
    expect(nhanThoiGian('(trống)')).toBe('(trống)');
  });
});
