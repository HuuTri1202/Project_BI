// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { crc32, taoXlsx, tenCot, tenSheetHopLe } from '../src/features/reports/export/xlsx';

/**
 * Bộ ghi .xlsx tự viết — kiểm bằng cách ĐỌC NGƯỢC.
 *
 * ═══ Vì sao đọc ngược bằng exceljs ══════════════════════════════════════════
 *
 * Một tệp xlsx sai thì Excel chỉ nói "tệp bị hỏng", không nói hỏng ở đâu. Bài
 * test tự so chuỗi XML mình vừa sinh ra sẽ xanh cho mọi lỗi mà ta không nghĩ
 * tới — nó chỉ kiểm rằng hàm làm đúng điều ta TƯỞNG nó phải làm.
 *
 * `exceljs` là một bộ đọc xlsx thật, độc lập với mã của ta (đã có sẵn ở backend
 * để đọc tệp người dùng tải lên). Nó mở được thì Excel cũng mở được, và nó đọc
 * ra đúng giá trị nào thì người dùng thấy đúng giá trị đó.
 *
 * Chạy ở môi trường `node` chứ không jsdom: exceljs cần stream của Node, còn
 * `taoXlsx` chỉ dùng Blob/CompressionStream/TextEncoder — Node 18+ có đủ.
 */

async function doNguoc(blob: Blob): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

describe('taoXlsx — tệp mở được bằng một bộ đọc thật', () => {
  it('một sheet, tiêu đề và dữ liệu về đúng ô', async () => {
    const wb = await doNguoc(
      await taoXlsx([
        {
          ten: 'Doanh thu',
          cot: ['Nhóm', 'Giá trị'],
          dong: [
            ['Furniture', 742000.12],
            ['Technology', 836154],
          ],
        },
      ]),
    );

    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Doanh thu');
    expect(ws.getCell('A1').value).toBe('Nhóm');
    expect(ws.getCell('B1').value).toBe('Giá trị');
    expect(ws.getCell('A2').value).toBe('Furniture');
    expect(ws.getCell('B2').value).toBe(742000.12);
    expect(ws.getCell('A3').value).toBe('Technology');
    expect(ws.getCell('B3').value).toBe(836154);
  });

  it('số là SỐ chứ không phải chuỗi — để Excel còn cộng được', async () => {
    const wb = await doNguoc(await taoXlsx([{ ten: 'S', cot: ['a', 'b'], dong: [['x', 12.5]] }]));
    const v = wb.worksheets[0]!.getCell('B2').value;
    expect(typeof v).toBe('number');
    expect(v).toBe(12.5);
  });

  it('nhiều sheet, mỗi sheet giữ đúng dữ liệu của mình', async () => {
    const wb = await doNguoc(
      await taoXlsx([
        { ten: 'Một', cot: ['c'], dong: [['a1']] },
        { ten: 'Hai', cot: ['c'], dong: [['b1']] },
        { ten: 'Ba', cot: ['c'], dong: [['c1']] },
      ]),
    );

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Một', 'Hai', 'Ba']);
    expect(wb.getWorksheet('Một')!.getCell('A2').value).toBe('a1');
    expect(wb.getWorksheet('Hai')!.getCell('A2').value).toBe('b1');
    expect(wb.getWorksheet('Ba')!.getCell('A2').value).toBe('c1');
  });

  it('tiếng Việt có dấu đi qua nguyên vẹn', async () => {
    const wb = await doNguoc(
      await taoXlsx([
        {
          ten: 'Báo cáo quý',
          cot: ['Tên khách hàng', 'Số lượng'],
          dong: [['Nguyễn Thị Ánh Tuyết', 3]],
        },
      ]),
    );
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Báo cáo quý');
    expect(ws.getCell('A1').value).toBe('Tên khách hàng');
    expect(ws.getCell('A2').value).toBe('Nguyễn Thị Ánh Tuyết');
  });

  it('ký tự phải thoát trong XML không làm hỏng tệp', async () => {
    const wb = await doNguoc(
      await taoXlsx([
        { ten: 'X', cot: ['a & b'], dong: [['<script>alert("x")</script>'], ['dấu \' và "']] },
      ]),
    );
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('a & b');
    expect(ws.getCell('A2').value).toBe('<script>alert("x")</script>');
    expect(ws.getCell('A3').value).toBe('dấu \' và "');
  });

  it('ký tự điều khiển bị BỎ, tệp vẫn mở được', async () => {
    // XML 1.0 không cho phép nhóm ký tự này kể cả khi đã thoát. Dữ liệu thật từ
    // một tệp CSV cũ có thể mang chúng, và Excel sẽ từ chối cả tệp.
    const ban = `a${String.fromCharCode(1)}b${String.fromCharCode(31)}c`;
    const wb = await doNguoc(await taoXlsx([{ ten: 'X', cot: ['c'], dong: [[ban]] }]));
    expect(wb.worksheets[0]!.getCell('A2').value).toBe('abc');
  });

  it('ô trống và ô null không sinh ra ô rác', async () => {
    const wb = await doNguoc(
      await taoXlsx([{ ten: 'X', cot: ['a', 'b', 'c'], dong: [['x', null, '']] }]),
    );
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A2').value).toBe('x');
    expect(ws.getCell('B2').value).toBeNull();
    expect(ws.getCell('C2').value).toBeNull();
  });

  it('bảng rộng hơn 26 cột vẫn đúng ô (Z -> AA)', async () => {
    const cot = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const dong = [cot.map((_, i) => i)];
    const wb = await doNguoc(await taoXlsx([{ ten: 'X', cot, dong }]));
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('Z1').value).toBe('c25');
    expect(ws.getCell('AA1').value).toBe('c26');
    expect(ws.getCell('AD2').value).toBe(29);
  });

  it('bảng nhiều dòng vẫn đúng ở dòng cuối', async () => {
    const dong = Array.from({ length: 2000 }, (_, i) => [`hàng ${i}`, i * 2]);
    const wb = await doNguoc(await taoXlsx([{ ten: 'X', cot: ['a', 'b'], dong }]));
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A2001').value).toBe('hàng 1999');
    expect(ws.getCell('B2001').value).toBe(3998);
  });

  it('không có sheet nào thì NÉM, không giao một tệp không mở được', async () => {
    await expect(taoXlsx([])).rejects.toThrow('Không có dữ liệu');
  });

  it('giá trị không phải số hữu hạn được ghi thành chữ thay vì phá tệp', async () => {
    const wb = await doNguoc(
      await taoXlsx([{ ten: 'X', cot: ['a'], dong: [[Number.NaN], [Number.POSITIVE_INFINITY]] }]),
    );
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A2').value).toBe('NaN');
    expect(ws.getCell('A3').value).toBe('Infinity');
  });
});

describe('tenSheetHopLe — luật của Excel, không phải luật của ta', () => {
  it('cắt còn 31 ký tự', () => {
    const d = new Set<string>();
    expect(tenSheetHopLe('x'.repeat(50), d)).toHaveLength(31);
  });

  it('bỏ ký tự Excel cấm', () => {
    const d = new Set<string>();
    expect(tenSheetHopLe('Doanh thu / Quý [1] * ?', d)).toBe('Doanh thu Quý 1');
  });

  it('cắt đúng 31 ký tự thì KHÔNG để lại khoảng trắng lủng lẳng ở cuối', () => {
    const d = new Set<string>();
    // Cắt rơi vào giữa hai từ — đo được trên tệp thật: "Chi tiết · Doanh thu theo Nhóm ".
    const t = tenSheetHopLe('Chi tiết · Doanh thu theo Nhóm hàng', d);
    expect(t).toBe('Chi tiết · Doanh thu theo Nhóm');
    expect(t).not.toMatch(/\s$/);
  });

  it('tên rỗng vẫn ra một tên dùng được', () => {
    const d = new Set<string>();
    expect(tenSheetHopLe('   ', d)).toBe('Sheet');
  });

  it('trùng tên thì thêm hậu tố, và hậu tố KHÔNG bị cắt mất', () => {
    const d = new Set<string>();
    const a = tenSheetHopLe('x'.repeat(40), d);
    const b = tenSheetHopLe('x'.repeat(40), d);
    const c = tenSheetHopLe('x'.repeat(40), d);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(b.endsWith(' (2)')).toBe(true);
    expect(c.endsWith(' (3)')).toBe(true);
    expect(b.length).toBeLessThanOrEqual(31);
  });

  it('trùng tên THẬT SỰ tạo ra tệp mở được (Excel từ chối sheet trùng tên)', async () => {
    const wb = await doNguoc(
      await taoXlsx([
        { ten: 'Doanh thu', cot: ['a'], dong: [['1']] },
        { ten: 'Doanh thu', cot: ['a'], dong: [['2']] },
      ]),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Doanh thu', 'Doanh thu (2)']);
  });
});

describe('phần nền', () => {
  it('tenCot đếm theo hệ 26 không có chữ số 0', () => {
    expect(tenCot(0)).toBe('A');
    expect(tenCot(25)).toBe('Z');
    expect(tenCot(26)).toBe('AA');
    expect(tenCot(51)).toBe('AZ');
    expect(tenCot(52)).toBe('BA');
    expect(tenCot(701)).toBe('ZZ');
    expect(tenCot(702)).toBe('AAA');
  });

  it('crc32 khớp giá trị chuẩn đã biết', () => {
    // "123456789" -> 0xCBF43926 là véc-tơ kiểm thử chuẩn của CRC-32.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});
