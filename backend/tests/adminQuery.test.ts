import { describe, expect, it } from 'vitest';

import { TENANT_SORT_KEYS, USER_SORT_KEYS } from '../src/repositories/platform';
import { escapeLikeTerm } from '../src/utils/sql';
import { generateTempPassword } from '../src/services/auth/password';
import { buildPageResult, resolveSortColumn } from '../src/utils/pagination';

/**
 * Test đơn vị — không chạm database, chạy bằng `npm test`.
 *
 * Ba thứ được kiểm ở đây đều là loại lỗi mà typecheck và ESLint không thấy được,
 * và cũng không lộ ra khi bấm thử trên giao diện: chúng chỉ hỏng với đúng vài
 * chuỗi đầu vào cụ thể.
 */

describe('resolveSortColumn — chốt chặn SQL injection', () => {
  it('từ chối chuỗi ngoài whitelist', () => {
    // `ORDER BY` không tham số hoá được bằng dấu `?`, nên đây là hàm duy nhất
    // đứng giữa query string và câu SQL.
    expect(resolveSortColumn('u.id; DROP TABLE users', USER_SORT_KEYS, 'fullName')).toBeNull();
    expect(resolveSortColumn('password_hash', USER_SORT_KEYS, 'fullName')).toBeNull();
    expect(resolveSortColumn('(SELECT 1)', USER_SORT_KEYS, 'fullName')).toBeNull();
  });

  it('chấp nhận đúng những khoá đã khai', () => {
    for (const key of USER_SORT_KEYS) {
      expect(resolveSortColumn(key, USER_SORT_KEYS, 'fullName')).toBe(key);
    }
    for (const key of TENANT_SORT_KEYS) {
      expect(resolveSortColumn(key, TENANT_SORT_KEYS, 'name')).toBe(key);
    }
  });

  it('khoá của bảng này KHÔNG lọt sang whitelist của bảng kia', () => {
    // Hai danh sách khác nhau và phải giữ khác nhau: `userCount` là cột của
    // truy vấn tenant, đưa vào ORDER BY của truy vấn user là lỗi SQL.
    expect(resolveSortColumn('userCount', USER_SORT_KEYS, 'email')).toBeNull();
    expect(resolveSortColumn('lastLoginAt', TENANT_SORT_KEYS, 'name')).toBeNull();
  });

  it('thiếu giá trị thì về mặc định, kiểu sai thì từ chối', () => {
    expect(resolveSortColumn(undefined, USER_SORT_KEYS, 'email')).toBe('email');
    expect(resolveSortColumn('', USER_SORT_KEYS, 'email')).toBe('email');
    // Query string có thể cho ra mảng khi tham số lặp lại: `?sort=a&sort=b`.
    expect(resolveSortColumn(['fullName'], USER_SORT_KEYS, 'email')).toBeNull();
    expect(resolveSortColumn(42, USER_SORT_KEYS, 'email')).toBeNull();
  });
});

describe('escapeLikeTerm — ký tự đại diện của LIKE', () => {
  it('thoát %, _ và dấu gạch chéo ngược', () => {
    // Không thoát thì tìm "100%" thành `LIKE '%100%%'` — khớp MỌI dòng, tức là
    // ô tìm kiếm trả về toàn bộ danh sách và người dùng tưởng nó hỏng.
    expect(escapeLikeTerm('100%')).toBe('100\\%');
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    expect(escapeLikeTerm('C:\\path')).toBe('C:\\\\path');
  });

  it('giữ nguyên chuỗi bình thường, kể cả tiếng Việt có dấu', () => {
    expect(escapeLikeTerm('Nguyễn Văn A')).toBe('Nguyễn Văn A');
    expect(escapeLikeTerm('an.nguyen@congty.vn')).toBe('an.nguyen@congty.vn');
  });

  it('email có gạch dưới là chuyện thường ngày', () => {
    expect(escapeLikeTerm('nguyen_van_a@x.com')).toBe('nguyen\\_van\\_a@x.com');
  });
});

describe('buildPageResult', () => {
  it('tính đúng số trang', () => {
    expect(buildPageResult([], 0, 1, 20).totalPages).toBe(0);
    expect(buildPageResult([1], 1, 1, 20).totalPages).toBe(1);
    expect(buildPageResult([], 20, 1, 20).totalPages).toBe(1);
    expect(buildPageResult([], 21, 1, 20).totalPages).toBe(2);
  });
});

describe('generateTempPassword', () => {
  it('đủ dài, có chữ số và ký tự đặc biệt', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateTempPassword();
      expect(pwd.length).toBeGreaterThanOrEqual(14);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('không chứa ký tự dễ đọc nhầm', () => {
    // Admin phải ĐỌC mật khẩu này cho người khác qua chat hoặc điện thoại.
    // Phân biệt 0/O và 1/l/I là chỗ sai phổ biến nhất, và hậu quả là một người
    // ngồi thử đăng nhập mà không hiểu vì sao không được.
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it('1000 lần sinh không trùng nhau lần nào', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateTempPassword()));
    expect(seen.size).toBe(1000);
  });
});
