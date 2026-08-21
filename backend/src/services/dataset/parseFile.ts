import type { FileExt, SheetPreviewDto } from '@bi/shared';
import { Readable } from 'node:stream';
import Papa from 'papaparse';

import { env } from '../../config/env';
import { stripBom } from './detectFormat';
import { inferColumnType } from './inferType';
import { loadWorkbook, XlsxLoadError, type Workbook } from './loadWorkbook';

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

/**
 * Số dòng thật sự GIỮ LẠI trong bộ nhớ sau khi parse.
 *
 * ─── Đây là con số gỡ trần 50.000 dòng ──────────────────────────────────────
 *
 * Trước đây hàm này giữ đủ `DATASET_MAX_ROWS` dòng, rồi `analyze` nhét cả mảng
 * đó vào MỘT khoá Redis (~29 MB cho 50.000 dòng) và `commit` chép tiếp vào
 * `dataset_rows`. Chuỗi đó đặt hai bức tường: RAM của Node, và trần 512 MB cho
 * một giá trị chuỗi của Redis — tức khoảng 500.000 dòng là hết đường.
 *
 * Từ khi §9 đọc thẳng file để nạp (`readFileRows`), không ai còn cần cả mảng
 * nữa. Ba việc còn lại đều chỉ cần phần đầu:
 *
 *   đoán kiểu cột   200 dòng  (`SAMPLE_ROWS`)
 *   bảng xem trước  100 dòng  (`PREVIEW_ROWS`)
 *   `dataset_rows`  mẫu để tab "Dữ liệu" hiển thị
 *
 * 1.000 dòng phủ dư cả ba mà vẫn đủ để người dùng cuộn xem thật. Chi phí lưu trữ
 * từ đây KHÔNG còn tăng theo kích thước file.
 */
export const RETAINED_ROWS = 1_000;

export interface ParsedSheet {
  name: string;
  header: string[];
  /** CHỈ `RETAINED_ROWS` dòng đầu. Toàn bộ dữ liệu nằm ở file, đọc khi nạp. */
  rows: string[][];
  /** Tổng số dòng THẬT trong sheet — đếm hết, kể cả phần không giữ lại. */
  totalRows: number;
}

export interface ParseResult {
  sheets: ParsedSheet[];
  /** Có sheet nào nhiều dòng hơn `DATASET_MAX_ROWS` — phần dư sẽ không được nạp. */
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
/**
 * ─── Đọc theo LUỒNG, không dựng cả bảng rồi mới cắt ─────────────────────────
 *
 * Bản trước gọi `Papa.parse(text)` một phát và nhận về `result.data` chứa TOÀN
 * BỘ dòng, rồi mới `.slice(0, RETAINED_ROWS)`. Cắt như vậy giảm được phần GIỮ
 * LẠI nhưng không giảm phần DỰNG LÊN: 500.000 dòng vẫn thành nửa triệu mảng JS
 * trước khi dòng đầu tiên bị vứt đi. Đo được: quá năm phút chưa xong.
 *
 * `chunk` cho papaparse trả về từng khối, nên ta ĐẾM hết mà chỉ GIỮ phần đầu.
 * Bộ nhớ từ đây phẳng theo kích thước file.
 */
function parseCsv(buffer: Buffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const kept: string[][] = [];
    let seen = 0;

    Papa.parse(Readable.from(stripBom(buffer)) as never, {
      // Không dùng `header: true`: nó trả về object, mà object thì MẤT cột trùng
      // tên — file thật hay có hai cột cùng tên "Ghi chú" và cột sau đè cột
      // trước trong im lặng. Mảng giữ đủ.
      header: false,
      skipEmptyLines: 'greedy',
      delimiter: '',
      chunk: (result: Papa.ParseResult<string[]>) => {
        for (const row of result.data) {
          // `errors` của papaparse phần lớn là cảnh báo về dòng thiếu cột, và
          // file thật đầy những dòng như thế. Chỉ bỏ dòng RỖNG hẳn.
          if (row.length === 0) continue;
          seen += 1;
          // +1 cho hàng tiêu đề, nằm ở `kept[0]`.
          if (kept.length <= RETAINED_ROWS) kept.push(row);
        }
      },
      complete: () => {
        if (kept.length === 0) {
          reject(new ParseError('Không đọc được dòng dữ liệu nào từ file.'));
          return;
        }

        const [header = [], ...rest] = kept;
        const totalRows = Math.max(0, seen - 1);

        resolve({
          sheets: [
            {
              name: 'Sheet1',
              header: header.map(cellText),
              rows: rest.map(normalizeRow(header.length)),
              totalRows,
            },
          ],
          truncated: totalRows > env.DATASET_MAX_ROWS,
        });
      },
      error: (err: Error) => {
        reject(new ParseError(`Không đọc được file CSV: ${err.message}`));
      },
    });
  });
}

// ─── Excel ───────────────────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  let workbook: Workbook;
  try {
    workbook = await loadWorkbook(buffer);
  } catch (err) {
    // `XlsxLoadError` đã mang sẵn câu viết cho người dùng đọc — và đã ghi nguyên
    // nhân thật ra log. Lỗi khác thì không phải chuyện của file: để nó đi tiếp
    // lên `errorHandler` thành 500, đúng bản chất của nó.
    if (err instanceof XlsxLoadError) throw new ParseError(err.message);
    throw err;
  }

  const sheets: ParsedSheet[] = [];
  let truncated = false;

  for (const worksheet of workbook.worksheets) {
    // Sheet bị ẩn vẫn đọc được, nhưng bỏ qua: người dùng không thấy nó khi mở
    // file thì cũng không mong nó xuất hiện trong danh sách chọn.
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') continue;

    const table: string[][] = [];
    // ĐẾM mọi dòng nhưng chỉ GIỮ phần đầu. Trước đây hai việc này là một, và đó
    // là chỗ bộ nhớ tăng tuyến tính theo kích thước file. +1 cho hàng tiêu đề.
    let seen = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      seen += 1;
      if (table.length > RETAINED_ROWS) return;
      // `row.values` là mảng 1-INDEXED — phần tử 0 luôn là undefined. Cắt bỏ nó,
      // nếu không mọi cột lệch một vị trí và cột cuối cùng biến mất.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      table.push(values.map(cellText));
    });

    if (table.length === 0) continue;

    const totalRows = Math.max(0, seen - 1);
    if (totalRows > env.DATASET_MAX_ROWS) truncated = true;

    const [header = [], ...rest] = table;
    sheets.push({
      name: worksheet.name,
      header: header.map(cellText),
      rows: rest.map(normalizeRow(header.length)),
      totalRows,
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
export function cellText(value: unknown): string {
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
    // Số dòng THẬT của sheet, không phải số dòng đang giữ trong bộ nhớ. Lấy
    // `rows.length` ở đây thì mọi file đều hiện đúng 1.000 dòng — con số vừa sai
    // vừa trông hợp lý, nên không ai nghi ngờ.
    rowCount: sheet.totalRows,
    previewRows: sheet.rows.slice(0, PREVIEW_ROWS),
    columns: sheet.header.map((sourceName, columnIndex) => {
      const values = sample.map((row) => row[columnIndex] ?? '');
      return {
        columnIndex,
        sourceName,
        semanticType: inferColumnType(values),
        samples: values.filter((v) => v !== '').slice(0, 3),
      };
    }),
  };
}
