import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { chonDongTieuDe, parseFile } from '../src/services/dataset/parseFile';

/**
 * Tìm HÀNG TIÊU ĐỀ trong một tệp người dùng thật xuất ra — §B4.
 *
 * ═══ Lỗi đã đo được, và nó mất dữ liệu trong im lặng ═══════════════════════
 *
 * Tệp Excel người Việt hầu như luôn có một dòng tên báo cáo trên cùng:
 *
 *     BÁO CÁO DOANH THU THÁNG 10/2026 — Nhà Gỗ Coffee
 *     (dòng trống)
 *     Ngày | Chi nhánh | Sản phẩm | Số lượng | Doanh thu
 *
 * Bản cũ lấy cứng dòng đầu làm tiêu đề, nên bộ dữ liệu ra MỘT cột mang tên là
 * cả câu tiêu đề báo cáo, và năm cột kia biến mất. Không lỗi, không cảnh báo:
 * màn hình chỉ ghi "1 cột · 7 dòng" cho một tệp sáu cột.
 */
describe('chonDongTieuDe', () => {
  it('bảng bình thường: tiêu đề là dòng 0', () => {
    expect(
      chonDongTieuDe([
        ['Ngày', 'Doanh thu'],
        ['01/10', '100'],
      ]),
    ).toBe(0);
  });

  it('một dòng tên báo cáo ở trên: bỏ đúng một dòng', () => {
    expect(chonDongTieuDe([['BÁO CÁO DOANH THU'], ['Ngày', 'Doanh thu'], ['01/10', '100']])).toBe(
      1,
    );
  });

  it('tên báo cáo cộng một dòng ghi chú: bỏ cả hai', () => {
    expect(
      chonDongTieuDe([['BÁO CÁO'], ['Lập ngày 20/11'], ['Ngày', 'Doanh thu'], ['01/10', '100']]),
    ).toBe(2);
  });

  it('ô trống ở đầu dòng vẫn tính là dòng một ô', () => {
    expect(
      chonDongTieuDe([
        ['', 'BÁO CÁO', ''],
        ['Ngày', 'Doanh thu'],
      ]),
    ).toBe(1);
  });

  /*
   * ĐỐI CHỨNG quan trọng nhất: tệp MỘT cột thật sự.
   *
   * Không dòng nào đạt hai ô, nên luật không bao giờ chạm tới nó và dòng 0 vẫn
   * là tiêu đề. Thiếu ca này thì một bản cài đặt "cứ bỏ dòng một ô" vẫn xanh,
   * và mọi tệp một cột mất dòng đầu.
   */
  it('tệp MỘT cột: không bỏ dòng nào', () => {
    expect(chonDongTieuDe([['Email'], ['a@b.com'], ['c@d.com']])).toBe(0);
  });

  it('bảng rỗng thì trả 0 chứ không nổ', () => {
    expect(chonDongTieuDe([])).toBe(0);
  });

  /*
   * Trần mười dòng: một tệp mà mãi tới dòng 20 mới có bảng thì nó không phải
   * thứ luật này nói về, và đoán tiếp chỉ làm hỏng theo một kiểu khác.
   */
  it('quá mười dòng một ô thì thôi đoán, giữ dòng 0', () => {
    const dai = Array.from({ length: 12 }, () => ['chỉ một ô']);
    expect(chonDongTieuDe([...dai, ['Ngày', 'Doanh thu']])).toBe(0);
  });
});

describe('parseFile đọc đúng tệp có dòng tên báo cáo', () => {
  /** Đúng hình dạng tệp đã làm lộ lỗi, ghi bằng exceljs. */
  async function tepCoTieuDe(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet('Doanh thu T10');
    s.addRow(['BÁO CÁO DOANH THU THÁNG 10/2026 — Nhà Gỗ Coffee']);
    s.addRow([]);
    s.addRow(['Ngày', 'Chi nhánh', 'Doanh thu']);
    s.addRow(['01/10/2026', 'Quận 1', 348000]);
    s.addRow(['02/10/2026', 'Thủ Đức', 225000]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('.xlsx: ba cột, hai dòng, và nói ra đã bỏ mấy dòng', async () => {
    const kq = await parseFile(await tepCoTieuDe(), 'xlsx');
    const sheet = kq.sheets[0];

    expect(sheet?.header).toEqual(['Ngày', 'Chi nhánh', 'Doanh thu']);
    expect(sheet?.rows).toHaveLength(2);
    // Dòng trống đã bị exceljs bỏ trước, nên chỉ còn một dòng bị bỏ ở đây.
    expect(sheet?.boQuaDong).toBe(1);
    // Số dòng THẬT không được tính cả dòng tiêu đề báo cáo.
    expect(sheet?.totalRows).toBe(2);
  });

  it('.csv: cùng một luật', async () => {
    const csv = ['BÁO CÁO DOANH THU', 'Ngày,Chi nhánh,Doanh thu', '01/10/2026,Quận 1,348000'].join(
      '\n',
    );

    const kq = await parseFile(Buffer.from(csv, 'utf8'), 'csv');
    const sheet = kq.sheets[0];

    expect(sheet?.header).toEqual(['Ngày', 'Chi nhánh', 'Doanh thu']);
    expect(sheet?.rows).toHaveLength(1);
    expect(sheet?.boQuaDong).toBe(1);
  });

  it('.csv bình thường: không bỏ dòng nào', async () => {
    const csv = ['Ngày,Doanh thu', '01/10/2026,348000'].join('\n');

    const kq = await parseFile(Buffer.from(csv, 'utf8'), 'csv');

    expect(kq.sheets[0]?.header).toEqual(['Ngày', 'Doanh thu']);
    expect(kq.sheets[0]?.boQuaDong).toBe(0);
  });
});
