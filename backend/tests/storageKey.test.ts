import { describe, expect, it } from 'vitest';

import { buildStorageKey, slugTenFile } from '../src/services/dataset/storageKey';

/**
 * Khoá lưu trữ MinIO — §7.4.
 *
 * ═══ Bộ này canh gì ═══════════════════════════════════════════════════════
 *
 * Khoá giờ mang theo tên người dùng đặt, để nhìn vào bucket là nhận ra file.
 * Tên đó đi THẲNG từ client lên, nên phần lớn bộ này là canh ranh giới an
 * toàn — một ký tự `/` lọt qua là đủ để vé ghi trỏ ra ngoài tiền tố tổ chức:
 *
 *     t4/w5/../../t1/w1/victim.xlsx
 *
 * và việc ghi diễn ra thẳng giữa trình duyệt với S3, không middleware nào thấy.
 *
 * Phần còn lại canh đúng một điều: khoá KHÔNG BAO GIỜ trùng. Cột `s3_key` cố ý
 * không UNIQUE (nhiều sheet dùng chung một khoá — migration 7), nên trùng khoá
 * không có gì chặn: bộ dữ liệu cũ vẫn hiện bình thường, tới lúc bấm "Nạp lại"
 * mới đọc nhầm file.
 */

describe('Rút tên file thành đoạn đọc được', () => {
  it('bỏ dấu tiếng Việt thay vì nghiền nát chữ', () => {
    // Không bỏ dấu trước khi lọc thì "Báo cáo quý 4" ra `b-o-c-o-qu-4` — vô
    // nghĩa, và mất luôn lý do đoạn này tồn tại.
    expect(slugTenFile('Báo cáo quý 4.xlsx')).toBe('bao-cao-quy-4');
    expect(slugTenFile('Đơn hàng tháng 12.csv')).toBe('don-hang-thang-12');
  });

  it('`đ` và `Đ` thành `d` — chúng KHÔNG tách ra dấu phụ khi chuẩn hoá', () => {
    // NFD tách được `ế` thành `e` + dấu, nhưng `đ` là một chữ cái riêng. Quên
    // nó thì mọi tên bắt đầu bằng "Đơn", "Điểm", "Đánh giá" đều mất chữ đầu.
    expect(slugTenFile('đĐ.csv')).toBe('dd');
  });

  it('khoảng trắng, ngoặc và ký tự lạ gộp thành MỘT dấu gạch', () => {
    expect(slugTenFile('database (1).xlsx')).toBe('database-1');
    expect(slugTenFile('doanh   thu___2026.csv')).toBe('doanh-thu-2026');
  });

  it('không để lại dấu gạch lủng lẳng ở hai đầu', () => {
    expect(slugTenFile('  (2026)  .csv')).toBe('2026');
    expect(slugTenFile('---abc---.xlsx')).toBe('abc');
  });

  it('tên không còn chữ nào dùng được thì lùi về một tên mặc định', () => {
    // Khoá rỗng ở giữa sẽ cho ra `t4/w5/__uuid.csv` — đọc như một lỗi, và tệ
    // hơn là hai dấu gạch dưới liền nhau làm người đọc tưởng mất dữ liệu.
    expect(slugTenFile('中文.csv')).toBe('tep');
    expect(slugTenFile('.xlsx')).toBe('tep');
    expect(slugTenFile('!!!.csv')).toBe('tep');
  });

  it('cắt tên dài và KHÔNG để lại dấu gạch ở chỗ cắt', () => {
    const dai = `${'a'.repeat(38)} ${'b'.repeat(20)}.csv`;
    const slug = slugTenFile(dai);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('CHẶN ĐƯỜNG DẪN: không ký tự nào thoát ra khỏi một đoạn', () => {
    /*
     * Ca quan trọng nhất của cả file. Danh sách trắng `[a-z0-9-]` khiến chuyện
     * này bất khả thi về mặt cấu trúc — nhưng viết ra để nếu có ai đổi sang
     * "lọc bỏ vài ký tự xấu" thì bài này đỏ ngay.
     */
    for (const doc of [
      '../../t1/w1/victim.xlsx',
      '..%2f..%2fetc%2fpasswd.csv',
      'a/b/c.csv',
      'a\\b\\c.csv',
      '....//....//x.csv',
      'con.csv',
    ]) {
      const slug = slugTenFile(doc);
      expect(slug, doc).toMatch(/^[a-z0-9-]+$/);
      expect(slug, doc).not.toContain('/');
      expect(slug, doc).not.toContain('\\');
      expect(slug, doc).not.toContain('..');
    }
  });
});

describe('Khoá lưu trữ hoàn chỉnh', () => {
  it('mang tiền tố tổ chức, tên đọc được, rồi UUID', () => {
    const khoa = buildStorageKey(4, 5, 'Báo cáo quý 4.xlsx', 'xlsx');

    expect(khoa).toMatch(
      /^t4\/w5\/bao-cao-quy-4__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$/,
    );
  });

  it('CHỈ BA đoạn đường dẫn, dù tên file có gì đi nữa', () => {
    // Đây là bất biến thật sự bảo vệ hệ thống: khoá luôn nằm trong đúng
    // `t{tenant}/w{workspace}/`, nên một vé ghi không bao giờ với sang tổ chức
    // khác được.
    const khoa = buildStorageKey(4, 5, '../../t1/w1/victim.xlsx', 'xlsx');

    expect(khoa.split('/')).toHaveLength(3);
    expect(khoa.startsWith('t4/w5/')).toBe(true);
    expect(khoa).not.toContain('..');
    expect(khoa).not.toContain('t1/w1');
  });

  it('cùng một tên file, hai lần tải lên -> HAI khoá khác nhau', () => {
    /*
     * Trùng khoá là mất dữ liệu âm thầm, và không có ràng buộc nào ở database
     * để chặn — `s3_key` cố ý không UNIQUE. Đây là lý do UUID vẫn còn nguyên
     * vẹn bên cạnh cái tên đọc được, thay vì một hậu tố ngắn cho đẹp.
     */
    const a = buildStorageKey(4, 5, 'database (1).xlsx', 'xlsx');
    const b = buildStorageKey(4, 5, 'database (1).xlsx', 'xlsx');

    expect(a).not.toBe(b);
    // Phần đọc được thì GIỐNG nhau — đó mới là điều mong muốn: hai bản của
    // cùng một file nằm cạnh nhau khi bucket sắp xếp theo tên.
    expect(a.split('__')[0]).toBe(b.split('__')[0]);
  });

  it('khoá ngắn hơn hẳn giới hạn 512 ký tự của cột', () => {
    const khoa = buildStorageKey(999999, 999999, `${'x'.repeat(300)}.csv`, 'csv');
    expect(khoa.length).toBeLessThan(120);
  });
});
