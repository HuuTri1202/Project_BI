import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripCommentRels } from '../src/services/dataset/loadWorkbook';
import { ParseError, parseFile } from '../src/services/dataset/parseFile';

/**
 * Đọc file .xlsx do CÔNG CỤ KHÁC ghi ra — test đơn vị, không chạm database.
 *
 * ═══ Lỗi này đã xảy ra trên file thật của người dùng ════════════════════════
 *
 * `database (1).xlsx` — 1,3 MB, 5 sheet, do openpyxl 3.1.5 ghi — tải lên xong
 * rồi bị từ chối ở bước phân tích với câu:
 *
 *     File Excel hỏng hoặc được bảo vệ bằng mật khẩu.
 *
 * File không hỏng và không có mật khẩu: Excel mở nó bình thường. Thứ hỏng là
 * `workbook.xlsx.load` của exceljs 4.4, ném `TypeError` khi ráp phần ghi chú:
 *
 *     Cannot read properties of undefined (reading 'comments')
 *       at WorkSheetXform.reconcile  worksheet-xform.js:453
 *
 * Nguyên nhân đầy đủ nằm ở `src/services/dataset/loadWorkbook.ts`.
 *
 * ─── Bàn thử dựng lại đúng hình dạng đó, không phải một bản ghi giả ─────────
 *
 * Ghi bằng chính exceljs rồi CHÈN THÊM phần ghi chú theo cách openpyxl đặt tên
 * và một quan hệ trỏ tới nó bằng đường dẫn TUYỆT ĐỐI. Cùng khuôn với ca
 * "rels ghi đường dẫn tuyệt đối" trong `ingest.integration.test.ts`.
 *
 * Ca đầu tiên KHẲNG ĐỊNH bàn thử thật sự tái hiện được lỗi trước khi kiểm bản
 * vá — không có bước đó thì một bàn thử dựng sai sẽ xanh vì chẳng có gì hỏng,
 * và bản vá coi như chưa từng được kiểm.
 */

const RELS_PATH = 'xl/worksheets/_rels/sheet1.xml.rels';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Đúng cặp đường dẫn openpyxl ghi ra — cả hai đều lệch với cái exceljs chờ. */
const COMMENT_PART = 'xl/comments/comment1.xml';
const VML_PART = 'xl/drawings/commentsDrawing1.vml';

const COMMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Ai do</author></authors><commentList><comment ref="A1" authorId="0"><text><t>Ghi chu tren o A1</t></text></comment></commentList></comments>`;

const VML_XML = `<xml xmlns:v="urn:schemas-microsoft-com:vml"><v:shape id="_x0000_s1025" type="#_x0000_t202"/></xml>`;

/** Sổ nhỏ hai cột, đủ để khẳng định dữ liệu ra đúng chứ không chỉ "không ném lỗi". */
async function soSach(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Doanh thu');
  sheet.addRow(['Ngay', 'So tien']);
  sheet.addRow(['2026-01-01', 1500]);
  sheet.addRow(['2026-01-02', 2750]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Gắn ghi chú theo kiểu openpyxl vào một gói .xlsx do exceljs ghi. */
async function themGhiChuKieuOpenpyxl(sach: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(sach);

  zip.file(COMMENT_PART, COMMENT_XML);
  zip.file(VML_PART, VML_XML);

  const san = zip.file(RELS_PATH);
  const truoc =
    san === null
      ? `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELS_NS}"></Relationships>`
      : await san.async('string');

  // `Target` bắt đầu bằng `/` — dạng TUYỆT ĐỐI. Chuẩn OPC cho phép, exceljs thì
  // chỉ nhận dạng tương đối `../comments1.xml`.
  const sau = truoc.replace(
    '</Relationships>',
    `<Relationship Id="comments" Type="${OFFICE_REL}/comments" Target="/${COMMENT_PART}"/>` +
      `<Relationship Id="anysvml" Type="${OFFICE_REL}/vmlDrawing" Target="/${VML_PART}"/>` +
      '</Relationships>',
  );
  expect(sau).not.toBe(truoc);
  zip.file(RELS_PATH, sau);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseFile — file .xlsx do openpyxl ghi', () => {
  it('bàn thử TÁI HIỆN được lỗi: exceljs trần vẫn ném TypeError', async () => {
    const buffer = await themGhiChuKieuOpenpyxl(await soSach());

    // Không có khẳng định này thì ca dưới xanh vì bàn thử vô hại, chứ không phải
    // vì bản vá làm được việc.
    await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow(
      /reading 'comments'/,
    );
  });

  it('đọc được, và ra đúng dữ liệu chứ không chỉ "không ném lỗi"', async () => {
    const buffer = await themGhiChuKieuOpenpyxl(await soSach());

    const parsed = await parseFile(buffer, 'xlsx');

    expect(parsed.sheets).toHaveLength(1);
    const sheet = parsed.sheets[0];
    // Tên sheet THẬT, không phải `Sheet1` mặc định.
    expect(sheet?.name).toBe('Doanh thu');
    expect(sheet?.header).toEqual(['Ngay', 'So tien']);
    expect(sheet?.rows).toEqual([
      ['2026-01-01', '1500'],
      ['2026-01-02', '2750'],
    ]);
    expect(sheet?.totalRows).toBe(2);
  });

  it('file không có ghi chú thì KHÔNG bị nén lại — trả về đúng buffer cũ', async () => {
    const sach = await soSach();

    // Cùng tham chiếu, không phải cùng nội dung: đây là cách `loadWorkbook` biết
    // "không có gì để gỡ" và bỏ qua luôn lượt đọc thứ hai. Mọi file lành lặn đi
    // qua đường này, nên nó phải không tốn gì.
    expect(await stripCommentRels(sach)).toBe(sach);
  });
});

describe('parseFile — khi thật sự không đọc được', () => {
  it('nói không đọc được, KHÔNG đổ cho mật khẩu', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rac = Buffer.from('day khong phai mot file excel');

    const err = await parseFile(rac, 'xlsx').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ParseError);
    expect((err as Error).message).toMatch(/Không đọc được nội dung file Excel/);
    // Câu cũ nêu một nguyên nhân không thể xảy ra ở đây: .xlsx đặt mật khẩu là
    // gói OLE, `checkFormat` đã chặn từ trước. Người dùng làm theo nó sẽ đi tìm
    // một cái mật khẩu không tồn tại.
    expect((err as Error).message).not.toMatch(/mật khẩu/);
    // Và nguyên nhân thật phải NẰM LẠI trong log, thay vì bị `catch {}` nuốt.
    expect(log).toHaveBeenCalled();
  });
});
