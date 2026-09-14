import type { ExplorerFieldDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { filterSheets, groupBySheet } from '../src/features/reports/builder/sheets';

/**
 * Bảng trường chia theo BẢNG, không chia theo vai trò đoán được — §10.10.
 *
 * ═══ Vì sao khoá lại bằng test ══════════════════════════════════════════════
 *
 * Trước bản này bảng trường xếp thành hai khối "Chiều" và "Thước đo" theo vai
 * trò mà `classifyColumn.ts` ĐOÁN ra từ kiểu cột và từ cuối của tên. Bỏ hai khối
 * đó đi thì thứ tự và cách gom trở thành thứ duy nhất còn giúp người dùng tìm
 * được một trường — và sai ở đây không hiện ra như một lỗi, chỉ hiện ra như một
 * danh sách khó tra.
 */

function dim(id: number, label: string, datasetName: string): ExplorerFieldDto {
  return { id, label, datasetName, cubeType: 'string' };
}

function mea(id: number, label: string, datasetName: string): ExplorerFieldDto {
  return {
    id,
    label,
    datasetName,
    cubeType: 'number',
    agg: 'sum',
    availableAggs: ['sum', 'avg'],
    nguon: { kind: 'column', label },
  };
}

const KH = 'database (1) · Customers';
const DH = 'database (1) · Orders';

describe('groupBySheet', () => {
  it('gom theo bảng, giữ THỨ TỰ XUẤT HIỆN chứ không sắp chữ cái', () => {
    // Thứ tự trong mô hình là thứ tự người dùng thêm bảng vào, nên bảng chính
    // thường đứng trước bảng tra cứu — đúng thứ tự họ sẽ tìm.
    const sheets = groupBySheet([dim(1, 'Status', DH), dim(2, 'Name', KH)], []);

    expect(sheets.map((s) => s.name)).toEqual([DH, KH]);
  });

  it('cột đứng trước trường đã gộp, TRONG cùng một bảng', () => {
    const sheets = groupBySheet([dim(1, 'Status', DH)], [mea(9, 'Số dòng', DH)]);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.fields.map((f) => [f.kind, f.field.label])).toEqual([
      ['dimension', 'Status'],
      ['measure', 'Số dòng'],
    ]);
  });

  it('bảng CHỈ có trường gộp vẫn hiện ra', () => {
    // Xảy ra khi mọi cột của bảng bị đặt `hidden`. Để bảng biến mất thì thước đo
    // của nó cũng biến mất theo mà không có gì giải thích.
    const sheets = groupBySheet([dim(1, 'Name', KH)], [mea(9, 'Doanh thu', DH)]);

    expect(sheets.map((s) => s.name)).toEqual([KH, DH]);
    expect(sheets[1]?.fields).toHaveLength(1);
  });

  it('KHÔNG còn nhóm nào mang tên vai trò', () => {
    // Đây chính là thứ bản này bỏ đi: hai khối "Chiều (Dimension)" và "Thước đo
    // (Measure)". Tên nhóm giờ là tên bảng, và chỉ là tên bảng.
    const sheets = groupBySheet([dim(1, 'Name', KH)], [mea(9, 'Doanh thu', KH)]);

    expect(sheets.map((s) => s.name)).toEqual([KH]);
    expect(sheets[0]?.fields).toHaveLength(2);
  });
});

describe('filterSheets', () => {
  const sheets = groupBySheet(
    [dim(1, 'Name', KH), dim(2, 'Address', KH), dim(3, 'Status', DH)],
    [mea(9, 'Doanh thu', DH)],
  );

  it('từ khoá rỗng thì trả về nguyên vẹn', () => {
    expect(filterSheets(sheets, '   ')).toHaveLength(2);
  });

  it('lọc theo tên trường, và BỎ bảng không còn gì', () => {
    const found = filterSheets(sheets, 'doanh');

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe(DH);
    expect(found[0]?.fields.map((f) => f.field.label)).toEqual(['Doanh thu']);
  });

  it('khớp tên BẢNG thì giữ cả bảng', () => {
    // Người dùng nhớ "trường này ở bảng Customers" thường xuyên hơn nhớ tên
    // chính xác của trường.
    const found = filterSheets(sheets, 'customers');

    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toHaveLength(2);
  });

  it('không khớp gì thì trả danh sách rỗng, không phải bảng rỗng', () => {
    expect(filterSheets(sheets, 'zzz')).toEqual([]);
  });
});
