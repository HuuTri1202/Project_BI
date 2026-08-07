import { JOB_TITLES, normalizePhone } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { registerRequestSchema } from '../src/modules/auth/schemas';

/**
 * Kiểm đúng những luật mà yêu cầu 1.2 nêu, cộng hai luật mà 1.2 KHÔNG nêu nhưng
 * bắt buộc phải có: trần 72 byte của bcrypt, và ràng buộc nhập lại mật khẩu.
 *
 * Test chạy trên schema của BACKEND. Frontend dùng cùng bộ rule từ @bi/shared
 * nên chỉ cần kiểm một phía.
 */

const VALID = {
  fullName: 'Nguyễn Thái Hiền',
  companyName: 'Công ty Cổ phần ABC',
  email: 'hien@example.com',
  password: 'Matkhau123',
  confirmPassword: 'Matkhau123',
  phone: '0901234567',
  jobTitle: 'Data Analyst',
};

type RegisterField = keyof typeof VALID;

/** Lấy danh sách thông báo lỗi của một trường, rỗng nếu trường đó hợp lệ. */
function errorsFor(input: Record<string, unknown>, field: RegisterField): string[] {
  const result = registerRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.flatten().fieldErrors[field] ?? [];
}

describe('registerRequestSchema — dữ liệu hợp lệ', () => {
  it('chấp nhận bộ dữ liệu đầy đủ', () => {
    const result = registerRequestSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('chuẩn hoá email về chữ thường và cắt khoảng trắng', () => {
    const result = registerRequestSchema.parse({ ...VALID, email: '  HIEN@Example.COM  ' });
    expect(result.email).toBe('hien@example.com');
  });

  it('gộp khoảng trắng thừa trong họ tên', () => {
    const result = registerRequestSchema.parse({ ...VALID, fullName: '  Nguyễn   Thái  Hiền ' });
    expect(result.fullName).toBe('Nguyễn Thái Hiền');
  });
});

describe('họ và tên', () => {
  it('từ chối chuỗi rỗng', () => {
    expect(errorsFor({ ...VALID, fullName: '' }, 'fullName')).toContain(
      'Vui lòng nhập họ và tên',
    );
  });

  it('từ chối chuỗi chỉ có khoảng trắng', () => {
    expect(errorsFor({ ...VALID, fullName: '    ' }, 'fullName').length).toBeGreaterThan(0);
  });
});

describe('tên công ty', () => {
  it('từ chối chuỗi rỗng', () => {
    expect(errorsFor({ ...VALID, companyName: '' }, 'companyName')).toContain(
      'Tên công ty phải có ít nhất 2 ký tự',
    );
  });

  it('từ chối chuỗi chỉ có khoảng trắng', () => {
    expect(errorsFor({ ...VALID, companyName: '     ' }, 'companyName').length).toBeGreaterThan(0);
  });

  it('gộp khoảng trắng thừa', () => {
    expect(registerRequestSchema.parse({ ...VALID, companyName: '  FPT   Software  ' }).companyName).toBe(
      'FPT Software',
    );
  });

  it('từ chối quá 150 ký tự — đúng bằng độ dài cột tenants.name', () => {
    expect(errorsFor({ ...VALID, companyName: 'x'.repeat(151) }, 'companyName')).toContain(
      'Tên công ty tối đa 150 ký tự',
    );
  });

  it('chấp nhận đúng 150 ký tự', () => {
    expect(
      registerRequestSchema.safeParse({ ...VALID, companyName: 'x'.repeat(150) }).success,
    ).toBe(true);
  });
});

describe('email', () => {
  it.each(['khong-phai-email', 'thieu@ten-mien', '@example.com', 'a b@example.com'])(
    'từ chối %s',
    (email) => {
      expect(errorsFor({ ...VALID, email }, 'email')).toContain('Email không hợp lệ');
    },
  );
});

describe('mật khẩu — yêu cầu 1.2', () => {
  it('từ chối mật khẩu 7 ký tự', () => {
    expect(errorsFor({ ...VALID, password: 'Abc123x', confirmPassword: 'Abc123x' }, 'password')).toContain(
      'Mật khẩu tối thiểu 8 ký tự',
    );
  });

  it('chấp nhận đúng 8 ký tự nếu đủ hoa và số', () => {
    const input = { ...VALID, password: 'Abc12345', confirmPassword: 'Abc12345' };
    expect(registerRequestSchema.safeParse(input).success).toBe(true);
  });

  it('từ chối khi không có chữ hoa', () => {
    expect(
      errorsFor({ ...VALID, password: 'matkhau123', confirmPassword: 'matkhau123' }, 'password'),
    ).toContain('Mật khẩu phải có ít nhất 1 chữ hoa');
  });

  it('từ chối khi không có chữ số', () => {
    expect(
      errorsFor({ ...VALID, password: 'MatKhauDai', confirmPassword: 'MatKhauDai' }, 'password'),
    ).toContain('Mật khẩu phải có ít nhất 1 chữ số');
  });
});

describe('mật khẩu — trần 72 byte của bcrypt', () => {
  // Luật này KHÔNG có trong yêu cầu 1.2 nhưng bắt buộc: bcrypt cắt âm thầm ở
  // byte 72, nên hai mật khẩu khác nhau trùng 72 byte đầu sẽ mở được cùng một
  // tài khoản.
  it('chấp nhận mật khẩu ASCII đúng 72 byte', () => {
    const pwd = `Abc12345${'x'.repeat(64)}`; // 8 + 64 = 72
    expect(new TextEncoder().encode(pwd).length).toBe(72);
    expect(registerRequestSchema.safeParse({ ...VALID, password: pwd, confirmPassword: pwd }).success).toBe(
      true,
    );
  });

  it('từ chối mật khẩu 73 byte', () => {
    const pwd = `Abc12345${'x'.repeat(65)}`;
    expect(errorsFor({ ...VALID, password: pwd, confirmPassword: pwd }, 'password')[0]).toMatch(
      /72 byte/,
    );
  });

  it('đếm BYTE chứ không phải ký tự với chữ tiếng Việt có dấu', () => {
    // 'ữ' là 3 byte UTF-8. 25 ký tự này = 75 byte, tuy chỉ 33 ký tự tổng cộng.
    const pwd = `Abc12345${'ữ'.repeat(25)}`;
    expect(pwd.length).toBeLessThan(72);
    expect(new TextEncoder().encode(pwd).length).toBeGreaterThan(72);
    expect(errorsFor({ ...VALID, password: pwd, confirmPassword: pwd }, 'password').length).toBe(1);
  });
});

describe('nhập lại mật khẩu', () => {
  it('báo lỗi ở ô confirmPassword chứ không phải ô password', () => {
    const result = registerRequestSchema.safeParse({ ...VALID, confirmPassword: 'Khac123456' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields['confirmPassword']).toContain('Mật khẩu nhập lại không khớp');
      expect(fields['password']).toBeUndefined();
    }
  });
});

describe('số điện thoại — yêu cầu 1.2 (9–10 chữ số)', () => {
  it.each([
    ['12345678', 'chỉ 8 chữ số'],
    ['012345678901', '12 chữ số'],
    ['090123456a', 'có chữ cái'],
    ['', 'rỗng'],
  ])('từ chối %s (%s)', (phone) => {
    expect(errorsFor({ ...VALID, phone }, 'phone').length).toBeGreaterThan(0);
  });

  it.each([
    ['0901234567', '+84901234567'],
    ['+84901234567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['090 123 4567', '+84901234567'],
    ['090-123-4567', '+84901234567'],
    ['(090) 123.4567', '+84901234567'],
    ['901234567', '+84901234567'],
  ])('chấp nhận %s và chuẩn hoá thành %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(registerRequestSchema.parse({ ...VALID, phone: input }).phone).toBe(expected);
  });

  it('chấp nhận số nội địa 10 chữ số', () => {
    expect(normalizePhone('01234567890')).toBe('+841234567890');
  });
});

describe('chức danh — danh sách đóng', () => {
  it('từ chối khi chưa chọn gì', () => {
    expect(errorsFor({ ...VALID, jobTitle: '' }, 'jobTitle')).toContain('Vui lòng chọn chức danh');
  });

  it('từ chối giá trị ngoài danh sách (người gọi thẳng API)', () => {
    expect(errorsFor({ ...VALID, jobTitle: 'Giám đốc vũ trụ' }, 'jobTitle')).toContain(
      'Vui lòng chọn chức danh',
    );
  });

  it('không phơi cả danh sách ra thông báo lỗi', () => {
    const messages = errorsFor({ ...VALID, jobTitle: 'sai' }, 'jobTitle');
    expect(messages.join(' ')).not.toContain('Business Analyst');
  });

  it.each(JOB_TITLES)('chấp nhận %s', (jobTitle) => {
    expect(registerRequestSchema.safeParse({ ...VALID, jobTitle }).success).toBe(true);
  });

  it('mọi chức danh đều vừa cột job_title VARCHAR(100)', () => {
    for (const title of JOB_TITLES) {
      expect(title.length).toBeLessThanOrEqual(100);
    }
  });
});
