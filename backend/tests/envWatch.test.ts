import { describe, expect, it } from 'vitest';

import { changedKeys } from '../src/config/envWatch';

/**
 * Canh `backend/.env` khi dev — `config/envWatch.ts`.
 *
 * Phần ghi giờ sửa file để `tsx watch` khởi động lại thì kiểm trên tiến trình dev
 * thật (xem README §11.2). Ở đây kiểm câu hỏi quyết định CÓ khởi động lại hay
 * không: khởi động lại thừa là cắt ngang job nạp dữ liệu đang chạy, thiếu là
 * một biến mới nằm im không ai đọc.
 */
describe('biến nào trong .env đã đổi', () => {
  it('thêm, sửa, xoá đều tính — và chỉ trả TÊN', () => {
    const truoc = { PORT: '4000', JWT_SECRET: 'cu' };
    expect(changedKeys(truoc, { ...truoc, SEPAY_API_TOKEN: 'moi' })).toEqual(['SEPAY_API_TOKEN']);
    expect(changedKeys(truoc, { ...truoc, JWT_SECRET: 'moi' })).toEqual(['JWT_SECRET']);
    expect(changedKeys(truoc, { PORT: '4000' })).toEqual(['JWT_SECRET']);
  });

  it('lưu lại không đổi gì thì không có gì để khởi động lại', () => {
    expect(changedKeys({ PORT: '4000' }, { PORT: '4000' })).toEqual([]);
    expect(changedKeys({}, {})).toEqual([]);
  });

  it('một biến đổi thành chuỗi rỗng VẪN là đổi', () => {
    expect(changedKeys({ SEPAY_API_TOKEN: 'abc' }, { SEPAY_API_TOKEN: '' })).toEqual([
      'SEPAY_API_TOKEN',
    ]);
  });
});
