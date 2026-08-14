import { describe, expect, it } from 'vitest';

import {
  defaultFieldName,
  defaultFieldRole,
  inferColumnType,
  isBlank,
  looksLikeDate,
  looksLikeNumber,
  parseNumber,
} from '../src/services/dataset/inferType';

/**
 * Suy luận kiểu dữ liệu — §7.5.
 *
 * Không dùng database. Đây là loại lỗi im lặng nhất trong cả mục 7: đoán sai thì
 * không có ngoại lệ nào được ném, không có dòng log nào, chỉ có một biểu đồ trông
 * hợp lý mà số thì sai.
 */

describe('số 0 đứng đầu phải giữ nguyên là text', () => {
  // Ca quan trọng nhất file. Mã bưu chính, mã sản phẩm, số điện thoại đều là
  // chuỗi số có số 0 đầu; gọi chúng là số thì số 0 đó biến mất VĨNH VIỄN và
  // không ai phát hiện cho tới lúc đối chiếu với hệ thống khác.
  it.each(['0123', '007', '0900123456', '00'])('%s -> không phải số', (raw) => {
    expect(looksLikeNumber(raw)).toBe(false);
  });

  it('cột mã bưu chính được đoán là text', () => {
    expect(inferColumnType(['0123', '0456', '0789'])).toBe('text');
  });

  it('nhưng số 0 đơn lẻ và số thập phân dưới 1 vẫn là số', () => {
    expect(looksLikeNumber('0')).toBe(true);
    expect(looksLikeNumber('0.5')).toBe(true);
    expect(looksLikeNumber('-0.5')).toBe(true);
    expect(inferColumnType(['0', '0.5', '12'])).toBe('number');
  });
});

describe('dấu phân cách hàng nghìn: hai quy ước', () => {
  it('kiểu Việt Nam 1.234.567,89', () => {
    expect(looksLikeNumber('1.234.567')).toBe(true);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1.234,5')).toBe(1234.5);
  });

  it('kiểu Anh Mỹ 1,234,567.89', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('1,234.5')).toBe(1234.5);
  });

  it('dấu phẩy thập phân đơn lẻ kiểu Việt Nam', () => {
    expect(parseNumber('1,5')).toBe(1.5);
  });

  it('nhóm không đúng ba chữ số thì KHÔNG phải phân cách hàng nghìn', () => {
    // `1.5` phải là một phẩy năm, không phải một nghìn năm trăm.
    expect(parseNumber('1.5')).toBe(1.5);
    // `12.34.56` không khớp quy ước nào -> không phải số.
    expect(looksLikeNumber('12.34.56')).toBe(false);
  });

  it('phần trăm và khoảng trắng thừa vẫn đọc được', () => {
    expect(parseNumber(' 45% ')).toBe(45);
    expect(parseNumber('1 234')).toBe(1234);
  });
});

describe('ngày', () => {
  it.each(['2024-01-15', '2024-01-15T10:30', '2024-01-15 10:30:00'])('ISO %s', (raw) => {
    expect(looksLikeDate(raw)).toBe(true);
  });

  it.each(['15/01/2024', '3-4-2024', '31/12/2024'])('kiểu Việt Nam %s', (raw) => {
    expect(looksLikeDate(raw)).toBe(true);
  });

  it('ngày hoặc tháng vượt phạm vi -> không phải ngày', () => {
    expect(looksLikeDate('32/01/2024')).toBe(false);
    expect(looksLikeDate('15/13/2024')).toBe(false);
  });

  it('KHÔNG đưa chuỗi bất kỳ vào new Date() để thử', () => {
    // `new Date('2024')` cho ra 1/1/2024, biến một cột năm thành cột ngày.
    // `new Date('Kinh doanh')` là Invalid Date ở Node nhưng không phải ở mọi
    // môi trường. Cả hai đều phải trượt.
    expect(looksLikeDate('2024')).toBe(false);
    expect(looksLikeDate('Kinh doanh')).toBe(false);
  });
});

describe('boolean chỉ nhận chữ, không nhận 0/1', () => {
  it('cột toàn 0 và 1 là SỐ, không phải boolean', () => {
    // Gọi nó là boolean là làm mất khả năng cộng — mà một cột 0/1 hầu như luôn
    // là cờ để đếm.
    expect(inferColumnType(['0', '1', '1', '0'])).toBe('number');
  });

  it('true/false, có/không thì là boolean', () => {
    expect(inferColumnType(['true', 'false'])).toBe('boolean');
    expect(inferColumnType(['Có', 'Không', 'Có'])).toBe('boolean');
  });
});

describe('một ô lệch kiểu là cả cột thành text', () => {
  it('99 số và 1 chữ -> text, không phải "đa số thắng"', () => {
    // Nếu lấy đa số thì đúng ô chữ đó biến mất khỏi biểu đồ — và nó luôn là ô
    // đáng chú ý nhất: dòng "Tổng cộng", ô ghi "chưa có số liệu".
    const values = [...Array(99).fill('10'), 'Tổng cộng'];
    expect(inferColumnType(values)).toBe('text');
  });

  it('ô trống bị bỏ qua chứ không làm hỏng phép đoán', () => {
    expect(inferColumnType(['10', '', '20', 'N/A', '30'])).toBe('number');
  });

  it('cột rỗng hoàn toàn -> text', () => {
    expect(inferColumnType(['', '', ''])).toBe('text');
  });
});

describe('ô trống', () => {
  it.each(['', '   ', '-', 'N/A', 'null', '#N/A'])('%s được coi là trống', (raw) => {
    expect(isBlank(raw)).toBe(true);
  });

  it('số 0 KHÔNG phải ô trống', () => {
    expect(isBlank('0')).toBe(false);
  });
});

describe('vai trò và tên field mặc định', () => {
  it('chỉ số mới là thước đo', () => {
    expect(defaultFieldRole('number')).toBe('measure');
    expect(defaultFieldRole('text')).toBe('dimension');
    expect(defaultFieldRole('date')).toBe('dimension');
  });

  it('tên cột được làm sạch mức tối thiểu', () => {
    expect(defaultFieldName('doanh_thu', 0)).toBe('Doanh thu');
    expect(defaultFieldName('SL_BAN', 0)).toBe('SL BAN');
    expect(defaultFieldName('  Tên   sản phẩm  ', 0)).toBe('Tên sản phẩm');
  });

  it('cột không có tiêu đề được đặt tên theo vị trí', () => {
    // Để trống thì bước 2 hiện một hàng ô nhập không nhãn.
    expect(defaultFieldName('', 0)).toBe('Cột 1');
    expect(defaultFieldName('   ', 4)).toBe('Cột 5');
  });
});
