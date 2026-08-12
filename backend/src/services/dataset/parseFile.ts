import type { FileExt, SheetPreviewDto } from '@bi/shared';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

import { env } from '../../config/env';
import { stripBom } from './detectFormat';
import { inferColumnType } from './inferType';

/**
 * Đọc file đã tải lên thành bảng — §7.5.
 *
 * Kết quả là dạng TRUNG GIAN chung cho cả csv và xlsx: một mảng sheet, mỗi sheet
 * có tiêu đề cột và các dòng đã chuyển hết về chuỗi. Mọi phán đoán về kiểu dữ
 * liệu diễn ra sau đó, trên cùng một dạng, nên hai định dạng file không thể cho
 * ra hai hành vi khác nhau.
 *
 * CSV luôn cho đúng MỘT sheet tên `Sheet1` — để bước 2 của wizard không phải
 * biết mình đang xem loại file nào.
 */

/**
 * Số dòng gửi kèm về cho bảng xem trước ở bước 2 (§7.5).
 *
 * CHỈ là trần của việc XEM. Khi người dùng chốt, toàn bộ dòng được nạp tới
 * `DATASET_MAX_ROWS`. Hai con số khác nhau, và giao diện phải nói rõ điều đó —
 * thấy 100 rồi tin rằng hệ thống chỉ nhập chừng đó là hiểu nhầm rất dễ xảy ra.
 */
export const PREVIEW_ROWS = 100;

/** Số ô dùng để đoán kiểu của một cột. Đọc hết 50000 dòng chỉ để đoán là phí. */
const SAMPLE_ROWS = 200;

export interface ParsedSheet {
  name: string;
  header: string[];
  rows: string[][];
}

export interface ParseResult {
  sheets: ParsedSheet[];
  /** Có sheet nào bị cắt vì chạm trần `DATASET_MAX_ROWS` không. */
  truncated: boolean;
}

export class ParseError extends Error {}

export function parseFile(buffer: Buffer, ext: FileExt): Promise<ParseResult> {
  return ext === 'csv' ? parseCsv(buffer) : parseXlsx(buffer);
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Dùng papaparse chứ KHÔNG tự `split(',')`.
 *
 * Bốn thứ mà `split` làm sai và papaparse làm đúng, cả bốn đều xuất hiện trong
 * file thật:
 *
 *   "Hà Nội, Việt Nam"     dấu phẩy nằm TRONG giá trị
 *   "Anh ""Ba"" nói"       dấu ngoặc kép lồng nhau
 *   dòng kết thúc bằng \r\n so với \n
 *   dấu phân cách là ; hoặc tab (Excel vùng châu Âu xuất ra dấu chấm phẩy)
 *
 * Cái cuối là lý do để `delimiter` trống — papaparse tự dò từ vài dòng đầu.
 */
function parseCsv(buffer: Buffer): Promise<ParseResult> {
  const text = stripBom(buffer).toString('utf8');

  const result = Papa.parse<string[]>(text, {
    // Không dùng `header: true`: nó trả về object, mà object thì MẤT cột trùng
    // tên — file thật hay có hai cột cùng tên "Ghi chú" và cột sau đè cột trước
    // trong im lặng. Mảng giữ đủ.
    header: false,
    skipEmptyLines: 'greedy',
    delimiter: '',
  });

  // `errors` của papaparse phần lớn là cảnh báo về dòng thiếu cột, và file thật
  // đầy những dòng như thế. Chỉ chặn khi không đọc ra được dòng nào.
  const table = result.data.filter((row) => row.length > 0);
  if (table.length === 0) {
    throw new ParseError('Không đọc được dòng dữ liệu nào từ file.');
  }

  const [header = [], ...rest] = table;
  const limited = rest.slice(0, env.DATASET_MAX_ROWS);

  return Promise.resolve({
    sheets: [{ name: 'Sheet1', header: header.map(cellText), rows: limited.map(normalizeRow(header.length)) }],
    truncated: rest.length > env.DATASET_MAX_ROWS,
  });
}

// ─── Excel ───────────────────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // `buffer as never`: kiểu của exceljs khai tham số là `Buffer` của phiên bản
    // @types/node mà nó ghim, lệch với phiên bản trong repo này. Không phải lỗi
    // logic, chỉ là hai khai báo Buffer không đồng nhất.
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new ParseError('File Excel hỏng hoặc được bảo vệ bằng mật khẩu.');
  }

  const sheets: ParsedSheet[] = [];
  let truncated = false;

  for (const worksheet of workbook.worksheets) {
    // Sheet bị ẩn vẫn đọc được, nhưng bỏ qua: người dùng không thấy nó khi mở
    // file thì cũng không mong nó xuất hiện trong danh sách chọn.
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') continue;

    const table: string[][] = [];
    let overflow = false;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // +1 cho hàng tiêu đề.
      if (table.length > env.DATASET_MAX_ROWS) {
        overflow = true;
        return;
      }
      // `row.values` là mảng 1-INDEXED — phần tử 0 luôn là undefined. Cắt bỏ nó,
      // nếu không mọi cột lệch một vị trí và cột cuối cùng biến mất.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      table.push(values.map(cellText));
    });

    if (overflow) truncated = true;
    if (table.length === 0) continue;

    const [header = [], ...rest] = table;
    sheets.push({
      name: worksheet.name,
      header: header.map(cellText),
      rows: rest.map(normalizeRow(header.length)),
    });
  }

  if (sheets.length === 0) {
    throw new ParseError('File Excel không có sheet nào chứa dữ liệu.');
  }

  return { sheets, truncated };
}

// ─── Chuẩn hoá ô ─────────────────────────────────────────────────────────────

/**
 * Đưa mọi giá trị ô về chuỗi.
 *
 * exceljs trả về nhiều hình dạng khác nhau cho cùng một ô tuỳ nội dung: chuỗi,
 * số, `Date`, `{ text }` cho hyperlink, `{ richText: [...] }` cho ô có định
 * dạng hỗn hợp, `{ result }` cho công thức, `{ error }` cho `#DIV/0!`.
 *
 * Không xử lý hết thì một ô được tô đậm nửa chừng sẽ ra `[object Object]` trong
 * dữ liệu — và nó trông giống một giá trị thật cho tới khi ai đó nhìn biểu đồ.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // Ngày: giữ dạng ISO cho `looksLikeDate` nhận ra, và để thứ tự sắp xếp theo
  // chuỗi trùng với thứ tự thời gian.
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj['text'] === 'string') return obj['text'].trim();
    if (Array.isArray(obj['richText'])) {
      return obj['richText']
        .map((part) => String((part as { text?: unknown }).text ?? ''))
        .join('')
        .trim();
    }
    // Công thức: lấy KẾT QUẢ, không lấy công thức. Người dùng muốn số 1500, chứ
    // không phải chuỗi "=B2*C2".
    if ('result' in obj) return cellText(obj['result']);
    // `#DIV/0!` và họ hàng -> coi như ô trống, để một lỗi trong bảng tính không
    // làm cả cột bị đoán thành text.
    if ('error' in obj) return '';
  }

  return String(value).trim();
}

/**
 * Ép mọi dòng có đúng số ô bằng hàng tiêu đề.
 *
 * File thật đầy dòng ngắn (ô cuối bỏ trống) và dòng dài (thừa một ô ghi chú bên
 * phải bảng). Không chuẩn hoá thì `row[i]` là `undefined` ở chỗ này và dữ liệu
 * của cột khác ở chỗ kia.
 */
function normalizeRow(width: number): (row: unknown[]) => string[] {
  return (row) => {
    const cells = row.map(cellText);
    if (cells.length === width) return cells;
    if (cells.length > width) return cells.slice(0, width);
    return [...cells, ...Array<string>(width - cells.length).fill('')];
  };
}

// ─── Dựng bản xem trước cho bước 2 ───────────────────────────────────────────

export function toPreview(sheet: ParsedSheet): SheetPreviewDto {
  const sample = sheet.rows.slice(0, SAMPLE_ROWS);

  return {
    name: sheet.name,
    rowCount: sheet.rows.length,
    previewRows: sheet.rows.slice(0, PREVIEW_ROWS),
    columns: sheet.header.map((sourceName, columnIndex) => {
      const values = sample.map((row) => row[columnIndex] ?? '');
      return {
        columnIndex,
        sourceName,
        dataType: inferColumnType(values),
        samples: values.filter((v) => v !== '').slice(0, 3),
      };
    }),
  };
}
