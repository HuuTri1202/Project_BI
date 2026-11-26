import type { FileExt, SheetPreviewDto } from '@bi/shared';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import Papa from 'papaparse';

import { env } from '../../config/env';
import { canhBaoCot } from './chatLuong';
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
  /**
   * Số dòng bị BỎ QUA trước hàng tiêu đề — §B4. `0` là trường hợp thường.
   *
   * Phải đi ra tới giao diện: bỏ qua dòng mà không nói là tự ý đổi hình dạng
   * dữ liệu của người ta. Xem `chonDongTieuDe`.
   */
  boQuaDong: number;
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

        // §B4 — dòng tên báo cáo ở trên hàng tiêu đề. Xem `chonDongTieuDe`.
        const boQuaDong = chonDongTieuDe(kept.map((r) => r.map(cellText)));
        const [header = [], ...rest] = kept.slice(boQuaDong);
        const totalRows = Math.max(0, seen - 1 - boQuaDong);

        resolve({
          sheets: [
            {
              name: 'Sheet1',
              header: header.map(cellText),
              rows: rest.map(normalizeRow(header.length)),
              totalRows,
              boQuaDong,
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

/**
 * Trần dung lượng cho ĐƯỜNG LÙI nạp cả workbook vào bộ nhớ.
 *
 * ═══ Vì sao phải có một con số ở đây ══════════════════════════════════════════
 *
 * `parseXlsxNap` dựng toàn bộ workbook thành object JS trước khi đọc ô đầu tiên.
 * Đo trong container `api` với trần heap 1536 MB (26/11/2026, 30 cột mỗi dòng):
 *
 *     tệp 7,8 MB   (52.479 dòng)   đỉnh heap 208 MB   14,8 giây
 *     tệp  17 MB  (100.001 dòng)   đỉnh heap 510 MB   32,0 giây
 *     tệp  42 MB  (250.001 dòng)   CHẾT: heap out of memory
 *     tệp  67 MB  (400.001 dòng)   CHẾT: heap out of memory
 *
 * Tiến trình KHÔNG bị kernel giết (`OOMKilled=false`) — chính V8 tự bỏ cuộc, và
 * người dùng nhận mã 503 của Caddy vì upstream vừa biến mất.
 *
 * ⚠️ Ràng buộc thật là SỐ Ô, không phải số byte. Một tệp 15 MB dày đặc ô có thể
 * nặng hơn một tệp 40 MB loãng, nên con số này là một phép xấp xỉ — nó chỉ tồn
 * tại vì lúc nhận tệp ta chưa biết gì ngoài kích thước. Chọn 15 MB vì ở mật độ
 * đo được (~28 MB heap cho mỗi MB tệp) nó ứng với ~420 MB, còn thừa chỗ cho
 * phần còn lại của tiến trình kể cả khi mật độ cao hơn gấp rưỡi.
 *
 * ⚠️ KHÔNG phải trần tải lên. `UPLOAD_MAX_BYTES` vẫn là 50 MB và tệp tới cỡ đó
 * đọc được bình thường — bằng đường LUỒNG, nơi bộ nhớ phẳng 41–54 MB bất kể tệp
 * to bao nhiêu. Trần này chỉ chặn đường lùi, đường mà chỉ chạy khi exceljs làm
 * hỏng việc đọc theo luồng.
 */
const TRAN_LUI_BYTES = 15 * 1_048_576;

/**
 * Đọc theo LUỒNG trước, hỏng thì lùi về nạp cả file — và chặn đường lùi theo
 * dung lượng.
 *
 * ═══ Vì sao luồng là đường chính, không phải đường phụ ════════════════════════
 *
 * Đo trên cùng tệp, cùng container (26/11/2026):
 *
 *     tệp          nạp cả file          đọc theo luồng
 *     7,8 MB       208 MB · 14,8 s      54 MB ·  8,0 s
 *      17 MB       510 MB · 32,0 s      41 MB · 19,7 s
 *      42 MB       CHẾT (OOM)           43 MB · 41,5 s
 *      67 MB       CHẾT (OOM)           44 MB · 79,4 s
 *
 * Luồng thắng CẢ HAI mặt: bộ nhớ phẳng, và nhanh hơn 1,6–1,9 lần. Nhanh hơn vì
 * §7 chỉ giữ `RETAINED_ROWS` dòng rồi ĐẾM phần còn lại, nên nó không phải dựng
 * object cho 400.000 dòng chỉ để vứt đi.
 *
 * Và nó khiến §7 với §9 đọc xlsx qua CÙNG một trình đọc. Đó không phải phần
 * thưởng kèm theo mà là lý do chính: mọi lỗi tìm được ngày 25/11/2026 — cột số
 * thành chiều, 980 dòng rỗng đếm vào kho, sai sheet, sai hàng tiêu đề — đều cùng
 * một gốc "hai trình đọc cùng một tệp mà không có gì buộc chúng đồng ý".
 *
 * ─── Vì sao vẫn giữ đường lùi ────────────────────────────────────────────────
 *
 * `WorkbookReader` của exceljs 4.4 có hai lỗi đã đo được; xem `xlsxRows` ở
 * `readFileRows.ts`. Lỗi thứ hai NÉM trước khi phát ra dòng nào, và nó nằm
 * trong ruột thư viện nên không vá được từ bên ngoài.
 *
 * Nhưng đường lùi phải CHẶN theo dung lượng, nếu không ta chỉ dời chỗ sập: một
 * tệp 40 MB mà exceljs không đọc nổi theo luồng sẽ rơi vào `parseXlsxNap` và
 * giết cả tiến trình. Chặn rồi thì nó thành một câu tiếng Việt nói được người
 * dùng phải làm gì.
 *
 * ─── Vì sao `sheets.length === 0` cũng lùi ───────────────────────────────────
 *
 * Luồng chạy xong mà không thấy sheet nào có dữ liệu là KHẢ NGHI, không phải
 * kết luận: đó đúng là hình dạng mà lỗi ghép tên của exceljs tạo ra. Với tệp đủ
 * nhỏ thì đọc lại bằng đường nạp rẻ hơn nhiều so với việc báo sai cho người
 * dùng rằng tệp của họ rỗng. Tệp lớn thì tin kết luận của luồng.
 */
async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const quaLon = buffer.length > TRAN_LUI_BYTES;

  try {
    const ket = await parseXlsxLuong(buffer);
    if (ket.sheets.length > 0) return ket;
    if (quaLon) throw new ParseError('File Excel không có sheet nào chứa dữ liệu.');
  } catch (err) {
    // `ParseError` là kết luận đã viết cho người dùng đọc, không phải sự cố —
    // lùi thêm một lần nữa chỉ để nhận lại đúng câu đó.
    if (err instanceof ParseError) throw err;
    if (quaLon) {
      throw new ParseError(
        `Không đọc được file Excel này theo luồng, và file lớn hơn ${String(
          Math.round(TRAN_LUI_BYTES / 1_048_576),
        )}MB nên không đọc được bằng cách nạp cả file vào bộ nhớ. ` +
          'Hãy mở file bằng Excel rồi lưu lại dưới dạng CSV và tải lên lại.',
      );
    }
  }

  const ket = await parseXlsxNap(buffer);
  if (ket.sheets.length === 0) {
    throw new ParseError('File Excel không có sheet nào chứa dữ liệu.');
  }
  return ket;
}

/**
 * Đọc xlsx theo luồng: ĐẾM mọi dòng, GIỮ `RETAINED_ROWS` dòng đầu mỗi sheet.
 *
 * Năm tuỳ chọn dưới đây phải khớp `xlsxStreamRows` ở `readFileRows.ts`, và
 * `styles: 'cache'` là BẮT BUỘC chứ không phải tối ưu: trong xlsx, ô ngày được
 * lưu là số sê-ri và chỉ ĐỊNH DẠNG SỐ mới cho biết đó là ngày. Bỏ styles thì ô
 * 31/07/2012 ra chuỗi `41121` — và vì §9 có khai nó, bỏ ở đây sẽ làm hai đường
 * đọc bất đồng đúng ở cột ngày.
 */
async function parseXlsxLuong(buffer: Buffer): Promise<ParseResult> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });

  const sheets: ParsedSheet[] = [];
  let truncated = false;

  for await (const worksheet of reader) {
    // Sheet ẩn: người dùng không thấy nó khi mở file thì cũng không mong nó hiện
    // ra trong danh sách chọn. Nhưng VẪN phải duyệt hết dòng của nó — bỏ qua mà
    // không đọc sẽ khiến luồng zip bên dưới kẹt ở giữa và sheet sau không bao
    // giờ tới. Cùng cái bẫy đã ghi ở `xlsxStreamRows`.
    const an = sheetAnOf(worksheet);

    const table: string[][] = [];
    // ĐẾM mọi dòng nhưng chỉ GIỮ phần đầu — chính chỗ này là lý do đường luồng
    // nhanh hơn đường nạp.
    let seen = 0;

    for await (const row of worksheet) {
      if (an) continue;
      const cells = docRowLuong(row.values);
      // Dòng trống hoàn toàn -> bỏ, KHÔNG đếm. Xem `laDongTrong`.
      if (laDongTrong(cells)) continue;
      seen += 1;
      if (table.length <= RETAINED_ROWS) table.push(cells);
    }

    if (an || table.length === 0) continue;

    // §B4 — xem `chonDongTieuDe`. `table` đã đặc (xem `docRowLuong`).
    const boQuaDong = chonDongTieuDe(table);
    const totalRows = Math.max(0, seen - 1 - boQuaDong);
    if (totalRows > env.DATASET_MAX_ROWS) truncated = true;

    const [header = [], ...rest] = table.slice(boQuaDong);
    sheets.push({
      name: sheetNameOf(worksheet) ?? `Sheet${String(sheets.length + 1)}`,
      header: header.map(cellText),
      rows: rest.map(normalizeRow(header.length)),
      totalRows,
      boQuaDong,
    });
  }

  return { sheets, truncated };
}

async function parseXlsxNap(buffer: Buffer): Promise<ParseResult> {
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
      const cells = docRowText(row);
      // Dòng trống hoàn toàn -> bỏ, KHÔNG đếm. Xem `laDongTrong`.
      if (laDongTrong(cells)) return;
      seen += 1;
      if (table.length > RETAINED_ROWS) return;
      table.push(cells);
    });

    if (table.length === 0) continue;

    // §B4 — xem `chonDongTieuDe`. `table` đã đặc (xem khối `Array.from` trên).
    const boQuaDong = chonDongTieuDe(table);
    const totalRows = Math.max(0, seen - 1 - boQuaDong);
    if (totalRows > env.DATASET_MAX_ROWS) truncated = true;

    const [header = [], ...rest] = table.slice(boQuaDong);
    sheets.push({
      name: worksheet.name,
      header: header.map(cellText),
      rows: rest.map(normalizeRow(header.length)),
      totalRows,
      boQuaDong,
    });
  }

  return { sheets, truncated };
}

/**
 * Dòng nào là HÀNG TIÊU ĐỀ — §B4.
 *
 * ═══ Hình dạng tệp thật mà bản cũ đọc hỏng ════════════════════════════════
 *
 * Tệp Excel người Việt xuất ra hầu như luôn có một dòng tên báo cáo ở trên
 * cùng:
 *
 *     BÁO CÁO DOANH THU THÁNG 10/2026 — Nhà Gỗ Coffee     ← một ô duy nhất
 *     (dòng trống)
 *     Ngày | Chi nhánh | Sản phẩm | Số lượng | Doanh thu   ← tiêu đề thật
 *
 * Lấy cứng dòng đầu làm tiêu đề thì bộ dữ liệu ra MỘT cột tên là cả câu tiêu
 * đề báo cáo, còn năm cột kia biến mất — không lỗi, không cảnh báo. Đo được
 * ngày 20/11/2026: "1 cột · 7 dòng" cho một tệp sáu cột.
 *
 * ═══ Luật, và vì sao nó hẹp đúng mức ═════════════════════════════════════
 *
 * Dòng tiêu đề là dòng ĐẦU TIÊN có từ HAI ô không rỗng trở lên, tìm trong
 * `TRAN_DO_TIEU_DE` dòng đầu. Không tìm thấy thì giữ nguyên dòng 0 — hành vi cũ.
 *
 * Hai ô là ngưỡng đúng: một tiêu đề báo cáo luôn nằm gọn trong một ô (người ta
 * gộp ô hoặc gõ vào A1), còn một bảng dữ liệu thì theo định nghĩa có ít nhất
 * hai cột. Tệp MỘT cột thật sự thì không dòng nào đạt hai ô, nên luật không
 * bao giờ chạm tới nó.
 *
 * Trần mười dòng để một tệp lạ không bị quét cả nghìn dòng đi tìm một thứ
 * không có — và vì chưa ai đặt mười dòng ghi chú lên đầu một bảng tính.
 */
export const TRAN_DO_TIEU_DE = 10;

export function chonDongTieuDe(table: readonly (readonly string[])[]): number {
  const tran = Math.min(table.length, TRAN_DO_TIEU_DE);
  for (let i = 0; i < tran; i += 1) {
    const soO = (table[i] ?? []).filter((c) => cellText(c).trim() !== '').length;
    if (soO >= 2) return i;
  }
  return 0;
}

// ─── Chuẩn hoá ô ─────────────────────────────────────────────────────────────

/**
 * Giá trị THẬT của một ô trong workbook đã nạp vào bộ nhớ.
 *
 * ═══ Vì sao không đọc thẳng `cell.value` ═══════════════════════════════════
 *
 * Vì với ô CÔNG THỨC, `cell.value` của exceljs 4.4 làm MẤT kết quả khi kết quả
 * ấy là giá trị "giả" của JavaScript — `0`, `''`, `false`. Thủ phạm là một phép
 * lọc theo tính đúng/sai trong `lib/doc/cell.js`:
 *
 *     _copyModel(model) { ... const cp = name => { const v = model[name];
 *                         if (v) copy[name] = v; }; cp('result'); ... }
 *     get value() { return this._copyModel(this.model); }
 *
 * `if (v)` loại luôn `0`. Nên một ô `=SUM(H2:L2)` cho ra 0 trả về
 * `{ sharedFormula: 'E2' }` — một object KHÔNG có `result`, và `cellText` không
 * còn gì để lấy ngoài `String(object)`.
 *
 * ─── Cái giá đã đo trên file thật ──────────────────────────────────────────
 *
 * File `THNC_18BTT_902_Thu4 10-12.xlsx`, sheet `lms`: ba cột điểm TH1/TH3/GK
 * đều là công thức (`SUM(H2:L2)`, `N2`, `M2`). Năm ô trong đó có kết quả 0.
 *
 *     ô 0 -> "[object Object]"   trong bảng xem trước VÀ trong `dataset_rows`
 *     -> `inferColumnType` đòi MỌI ô khớp, một ô chữ là đủ -> cột thành `text`
 *     -> `text` sang ClickHouse là `String` -> §10 xếp thành CHIỀU, không phải
 *        thước đo -> ba cột điểm không cộng/không vẽ biểu đồ được
 *
 * Người dùng thấy đúng một triệu chứng: "cột số mà sao thành chiều dữ liệu".
 * Không có lỗi nào ở bất kỳ bước nào.
 *
 * ─── Vì sao `cell.result` chữa được ────────────────────────────────────────
 *
 * `Cell.get result()` trả `this._value.result` — đọc THẲNG model, không qua
 * `_copyModel`, nên `0` còn nguyên. Đã kiểm trên chính file trên: ô `F4`
 * `cell.value = {"sharedFormula":"F2"}` mà `cell.result = 0`.
 *
 * ⚠️ `cell.text` KHÔNG dùng thay được: nó là `` `${this.model.result || ''}` ``
 * — cùng phép lọc đúng/sai, nên ô 0 ra chuỗi rỗng.
 *
 * ─── Ô bị GỘP trả giá trị của ô gốc, và đó là lời nói dối thứ hai ──────────
 *
 * exceljs điền giá trị ô gốc vào MỌI ô con của một vùng gộp. Một dòng tên báo
 * cáo gộp `A4:P4` vì thế trông như 16 ô có dữ liệu, và `chonDongTieuDe` chấm
 * nó làm hàng tiêu đề — ra một bộ dữ liệu 16 cột cùng tên. Nhánh đọc theo
 * LUỒNG của §9 thì không điền, nên hai đường đọc cùng một file ra hai bảng
 * khác nhau.
 *
 * Ở đây chỉ trả `null` cho ô con (`ValueType.Merge`) — đúng cách Excel hiểu:
 * một vùng gộp có MỘT giá trị, nằm ở ô trên trái. Việc dò hàng tiêu đề trên
 * file nhiều tầng tiêu đề vẫn còn thiếu sót; xem `chonDongTieuDe`.
 */
export function cellValue(cell: ExcelJS.Cell): unknown {
  if (cell.type === ExcelJS.ValueType.Merge) return null;
  if (cell.type === ExcelJS.ValueType.Formula) return cell.result;
  return cell.value;
}

/**
 * Một dòng của workbook ĐÃ NẠP -> mảng chuỗi ĐẶC, đọc theo từng ô.
 *
 * ─── Bề rộng lấy từ `row.values`, KHÔNG phải `row.cellCount` ───────────────
 *
 * `cellCount` là số ô exceljs đã dựng, kể cả ô chỉ có ĐỊNH DẠNG mà không có
 * giá trị. Đo trên file thật: dòng tiêu đề của sheet `LY THUYET` có
 * `cellCount = 21` trong khi chỉ 16 cột có dữ liệu — năm cột rỗng thừa ra.
 * `row.values` chỉ liệt kê ô khác null, nên nó là bề rộng đúng.
 *
 * ─── Vì sao vẫn phải lặp theo CHỈ SỐ chứ không `.map` mảng đó ──────────────
 *
 * `row.values` là mảng THƯA và 1-INDEXED: phần tử 0 luôn `undefined`, và ô
 * trống ở giữa là một LỖ. `.map` bỏ qua lỗ và giữ nguyên chúng là lỗ, nên
 * `ParsedSheet.header` khai `string[]` mà thật ra không phải.
 *
 * LỖI ĐÃ XẢY RA TRÊN FILE THẬT: một file Excel có ô tiêu đề để trống ở giữa.
 * Bước phân tích trả về 200, bước chốt thì chết:
 *
 *     TypeError: Cannot read properties of null (reading 'replace')
 *       at defaultFieldName (inferType.ts)
 *
 * Chỗ `null` sinh ra là CACHE: kết quả phân tích đi qua Redis bằng
 * `JSON.stringify`, và JSON không có khái niệm lỗ — nó ghi lỗ thành `null`.
 * Nên giá trị trong bộ nhớ và giá trị đọc lại từ cache là HAI hình dạng khác
 * nhau, và chỉ hình dạng thứ hai mới nổ.
 *
 * `getCell(i)` dựng ô rỗng cho mọi lỗ nên mảng trả về luôn ĐẶC.
 *
 * ─── Gọi cho MỌI dòng, kể cả dòng không giữ lại — và cái giá của nó ────────
 *
 * Bản trước thoát sớm ở `table.length > RETAINED_ROWS` TRƯỚC khi đọc ô, nên
 * dòng thứ 1.001 trở đi chỉ được đếm. Giờ phải đọc hết, vì `laDongTrong` cần
 * nội dung mới biết có đếm dòng đó hay không — mà đếm sai thì `row_count` lại
 * lệch với kho, đúng cái vừa sửa.
 *
 * Đo trên `Global-Superstore.xlsx` (51.290 dòng × 24 cột, ba sheet):
 *
 *     trước  15,6 giây  RSS 741 MB
 *     sau     9–11 giây  RSS 829 MB
 *
 * Nhanh hơn chứ không chậm hơn — `Array.from` trên mảng THƯA của exceljs đắt
 * hơn vòng lặp theo chỉ số. Phần RSS thêm là các ô rỗng `getCell` dựng cho lỗ;
 * cả workbook vốn đã nằm sẵn trong bộ nhớ nên nó không đổi bậc độ lớn.
 */
export function docRowText(row: ExcelJS.Row): string[] {
  const values: unknown = row.values;
  const width = Array.isArray(values) ? values.length - 1 : 0;

  const cells: string[] = [];
  for (let col = 1; col <= width; col += 1) cells.push(cellText(cellValue(row.getCell(col))));
  return cells;
}

/**
 * Dòng không còn một ô nào có chữ.
 *
 * ═══ Vì sao LUẬT NÀY phải nằm ở đây, dùng chung cho cả hai đường đọc ═══════
 *
 * `eachRow({ includeEmpty: false })` của exceljs và trình đọc theo LUỒNG của
 * §9 định nghĩa "trống" khác nhau: một dòng chỉ có ô được TÔ MÀU, không có giá
 * trị nào, bị nhánh này bỏ qua còn nhánh kia vẫn phát ra.
 *
 * Hậu quả đo được trên `THNC_18BTT_902_Thu4 10-12.xlsx`:
 *
 *     sheet   §7 đếm được   ClickHouse thật sự có
 *     lms           15            995   (980 dòng rỗng)
 *     LY THUYET     23            998
 *     THUC HANH     22            999
 *
 * Nghĩa là mọi phép đếm dòng trong mô hình đều sai gấp vài chục lần, và mọi
 * giá trị trung bình chia cho một mẫu số bịa ra. Không có lỗi nào ở đâu cả.
 *
 * Nên "trống" phải là định nghĩa CỦA TA, không phải của exceljs: mọi ô cho ra
 * chuỗi rỗng. `readFileRows` dùng lại đúng hàm này.
 */
export function laDongTrong(cells: readonly string[]): boolean {
  return cells.every((c) => c === '');
}

// ─── Đọc theo LUỒNG: phần dùng chung của §7 và §9 ─────────────────────────────
//
// Ba hàm dưới đây TỪNG nằm trong `services/ingest/readFileRows.ts`, nơi duy
// nhất đọc xlsx theo luồng. Từ khi §7 cũng đọc theo luồng (xem `parseXlsxLuong`)
// thì có HAI nơi cần chúng, và hai bản sao của luật đặt tên sheet là đúng cái
// lớp lỗi mà `sheetNameOf` được viết ra để chữa. Nên chúng ở đây, cạnh
// `cellText` và `laDongTrong` — những luật khác mà cả hai đường đọc đã dùng
// chung từ trước.

/** Bản khai của một sheet trong `xl/workbook.xml`. */
interface KhaiBaoSheet {
  rId?: string;
  name?: string;
  /** `'hidden'` / `'veryHidden'` / `'visible'` — thiếu nghĩa là hiện. */
  state?: string;
}

/**
 * `/xl/worksheets/sheet1.xml` và `worksheets/sheet1.xml` là CÙNG một phần.
 *
 * Quan hệ trong gói OPC được phép ghi đích ở dạng tuyệt đối (bắt đầu bằng `/`,
 * tính từ gốc gói) hoặc tương đối (tính từ thư mục chứa `workbook.xml`). Cả hai
 * đều đúng chuẩn; công cụ nào ghi kiểu nào là tuỳ nó.
 */
function opcTarget(target: string | undefined): string {
  return target === undefined ? '' : target.replace(/^\/?xl\//, '');
}

/**
 * Tên THẬT của sheet đang được phát ra — tự nối lấy, không tin `worksheet.name`.
 *
 * ═══ Vì sao không dùng thẳng `worksheet.name` ══════════════════════════════
 *
 * exceljs 4.4 nối tên sheet bằng đúng một phép so sánh CHUỖI (xem
 * `stream/xlsx/workbook-reader.js`, hàm `_parseWorksheet`):
 *
 *     rel.Target === `worksheets/sheet${sheetNo}.xml`
 *
 * Nó chỉ nhận dạng TƯƠNG ĐỐI. File do openpyxl ghi dùng dạng tuyệt đối
 * `/xl/worksheets/sheet1.xml`, nên phép so sánh không bao giờ khớp, tên không
 * bao giờ được gán, và `WorksheetReader` giữ nguyên giá trị mặc định của nó:
 * `Sheet1`, `Sheet2`, … theo số thứ tự FILE.
 *
 * Đo trên file `database.xlsx` thật của người dùng:
 *
 *     workbook.xlsx.load()  ->  "Customers", "Products", "Orders", …
 *     WorkbookReader        ->  "Sheet1",    "Sheet2",   "Sheet3",  …
 *
 * Hậu quả không phải đọc nhầm sheet mà là KHÔNG TÌM THẤY sheet nào: nhánh phân
 * tích (§7) dùng `workbook.xlsx.load` nên `datasets.sheet_name` lưu tên thật,
 * còn nhánh nạp (§9) đi tìm tên đó giữa `Sheet1…Sheet5`. Cả 8 bộ dữ liệu của
 * một file 5 sheet đều `failed` với `rows_read = 0`.
 *
 * ─── Vì sao nối lại được, và nối bằng gì ───────────────────────────────────
 *
 * Bản thân `WorkbookReader` VẪN đọc đúng cả hai mảnh cần thiết — nó chỉ ghép
 * sai. `worksheet.workbook` trỏ ngược về chính trình đọc đó, nên ta lấy lại
 * `workbookRels` (từ `xl/_rels/workbook.xml.rels`) và `model.sheets` (từ
 * `xl/workbook.xml`) rồi tự ghép, với đích đã chuẩn hoá.
 *
 * `worksheet.id` là số trong tên file (`sheet3.xml` → `3`) và luôn được đặt,
 * kể cả khi phép ghép của exceljs trượt — đó là khoá ghép đáng tin ở đây.
 *
 * Trả `undefined` khi không nối được mảnh nào — nơi gọi lùi về giá trị của chính
 * exceljs: file một sheet vẫn nạp được bằng đường `sheetName === null`, và một
 * tên sai vẫn hơn là ném lỗi.
 *
 * ⚠️ `undefined` ở đây KHÔNG có nghĩa "ghép trượt". Nó cũng là kết quả khi
 * exceljs đã ghép ĐÚNG (nhánh `sheets.some` ở dưới), và lúc đó `worksheet.name`
 * cùng `worksheet.state` đều đã được thư viện đặt sẵn — xem `sheetNameOf`.
 */
function khaiBaoSheet(worksheet: unknown): KhaiBaoSheet | undefined {
  const ws = worksheet as {
    id?: number | string;
    name?: string;
    workbook?: {
      workbookRels?: { Id?: string; Target?: string }[];
      model?: { sheets?: KhaiBaoSheet[] };
    };
  };

  const rels = ws.workbook?.workbookRels;
  const sheets = ws.workbook?.model?.sheets;
  if (rels === undefined || sheets === undefined) return undefined;

  /*
   * ─── exceljs ghép ĐÚNG thì đừng ghép lại: `ws.id` không phải số tên tệp ───
   *
   * Khi phép so chuỗi của exceljs khớp, nó gán luôn `ws.id = sheetId` lấy từ
   * `xl/workbook.xml` — và `sheetId` KHÔNG liên quan gì tới số trong tên tệp.
   * Lúc đó phép tra `worksheets/sheet${ws.id}.xml` ở dưới là tra một tệp khác.
   *
   * Đo trên `Global-Superstore.xlsx` (Google Sheets ghi, quan hệ dạng tương
   * đối nên exceljs khớp bình thường):
   *
   *     khai báo   Orders(sheetId 1, rId1)  Returns(3, rId2)  People(5, rId3)
   *     tệp        sheet1.xml               sheet2.xml        sheet3.xml
   *
   *     ws.id=3 -> tra sheet3.xml -> rId3 -> "People"     ← phải là Returns
   *     ws.id=5 -> tra sheet5.xml -> không có -> ws.name
   *
   * Nên có HAI luồng cùng tự xưng là "People", và `xlsxStreamRows` lấy cái
   * đầu: dữ liệu sheet Returns đi vào bảng mang tên cột của sheet People.
   * Đã xảy ra bốn lần trên dữ liệu thật — bốn bộ `… · People` đều ghi
   * `row_count = 13` mà `loaded_row_count = 1173`, đúng bằng số dòng Returns.
   *
   * Phân biệt hai ca bằng chính TÊN exceljs đưa ra: ghép trượt thì nó để tên
   * mặc định `Sheet1`, `Sheet2`… (đo trên tệp openpyxl: `Sheet1…Sheet5` trong
   * khi workbook khai `Customers…Returns`), nên một cái tên CÓ trong danh sách
   * khai báo là bằng chứng phép ghép đã thành công.
   */
  if (sheets.some((s) => s.name === ws.name)) return undefined;

  const dich = `worksheets/sheet${String(ws.id)}.xml`;
  const rel = rels.find((r) => opcTarget(r.Target) === dich);
  if (rel === undefined) return undefined;

  return sheets.find((s) => s.rId === rel.Id);
}

/**
 * Tên THẬT của sheet đang được phát ra. Xem `khaiBaoSheet`.
 *
 * Lùi về `worksheet.name` khi không nối được: đó cũng chính là giá trị đúng
 * trong trường hợp exceljs đã ghép thành công.
 */
export function sheetNameOf(worksheet: unknown): string | undefined {
  const ws = worksheet as { name?: string };
  return khaiBaoSheet(worksheet)?.name ?? ws.name;
}

/**
 * Sheet này có bị ẨN không — cùng câu hỏi mà đường nạp cả file trả lời bằng
 * `worksheet.state`.
 *
 * Phải đi qua `khaiBaoSheet` chứ không đọc thẳng `worksheet.state`: exceljs chỉ
 * gán `state` ở đúng nhánh mà nó cũng gán `name` (`workbook-reader.js`, hàm
 * `_parseWorksheet`), nên file nào bị lỗi ghép tên thì cũng mất luôn trạng thái
 * ẩn — và khi đó mọi sheet đều trông như đang hiện.
 *
 * Thiếu thông tin thì coi là HIỆN. Hiện thừa một sheet thì người dùng thấy và bỏ
 * qua được; ẩn mất một sheet có dữ liệu thật thì họ không có cách nào biết.
 */
export function sheetAnOf(worksheet: unknown): boolean {
  const ws = worksheet as { state?: string };
  const state = khaiBaoSheet(worksheet)?.state ?? ws.state;
  return state === 'hidden' || state === 'veryHidden';
}

/**
 * Một dòng của trình đọc theo LUỒNG -> mảng chuỗi ĐẶC.
 *
 * `row.values` là mảng 1-INDEXED và THƯA: phần tử 0 luôn `undefined`, ô trống ở
 * giữa là một lỗ. Cắt phần tử 0 đi, nếu không mọi cột lệch một vị trí và cột
 * cuối biến mất; `Array.from` chứ không `.map` để lỗ thành `''` thay vì ở lại
 * làm lỗ. Cùng hai cái bẫy đã ghi ở `parseFile.docRowText`.
 *
 * ⚠️ KHÔNG gọi `docRowText` ở đây được: nhánh luồng dựng ô theo cách khác, ô
 * công thức ra `{ formula: '', result: 0 }` và `cell.type` không phải
 * `ValueType.Formula`, nên `cell.result` là `undefined`. Hai nhánh đọc hai hình
 * dạng khác nhau của cùng một thư viện; chỗ chung của chúng là `cellText`.
 */
export function docRowLuong(values: unknown): string[] {
  return Array.from(Array.isArray(values) ? values.slice(1) : [], cellText);
}

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

    /*
     * Ô công thức mà exceljs ĐÃ VỨT `result` — xem khối ở `cellValue`.
     *
     * Đường đọc trong bộ nhớ không còn tới đây nữa vì `cellValue` lấy
     * `cell.result`. Nhánh này là cho trình đọc theo LUỒNG của §9: ở đó ô chủ
     * của một công thức dùng chung mà kết quả bằng 0 bị thư viện bỏ mất trước
     * khi ta chạm vào, và KHÔNG có đường nào lấy lại.
     *
     * Trả `''` là chọn MẤT MỘT Ô thay vì hỏng CẢ CỘT: `[object Object]` là một
     * chuỗi, nên nó vừa ghi rác vào kho vừa kéo cả cột số thành `text`. Ô rỗng
     * thì `inferColumnType` bỏ qua, và cột vẫn là số.
     */
    if ('formula' in obj || 'sharedFormula' in obj) return '';
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

  // `values` đi kèm từng cột để phần cảnh báo dưới đây không phải cắt mẫu lần
  // hai; nó được loại khỏi DTO ngay ở `return` vì 200 ô mỗi cột không có lý do
  // gì đi qua dây.
  const cot = sheet.header.map((sourceName, columnIndex) => {
    const values = sample.map((row) => row[columnIndex] ?? '');
    return {
      columnIndex,
      sourceName,
      semanticType: inferColumnType(values),
      samples: values.filter((v) => v !== '').slice(0, 3),
      values,
    };
  });

  return {
    name: sheet.name,
    // Số dòng THẬT của sheet, không phải số dòng đang giữ trong bộ nhớ. Lấy
    // `rows.length` ở đây thì mọi file đều hiện đúng 1.000 dòng — con số vừa sai
    // vừa trông hợp lý, nên không ai nghi ngờ.
    rowCount: sheet.totalRows,
    // §B4 — nói ra là đã bỏ mấy dòng đầu. Bỏ mà im lặng là tự ý đổi hình dạng
    // dữ liệu của người ta; `0` thì DTO không mang trường này.
    ...(sheet.boQuaDong > 0 ? { boQuaDong: sheet.boQuaDong } : {}),
    previewRows: sheet.rows.slice(0, PREVIEW_ROWS),
    // Liệt kê tường minh để `values` KHÔNG đi qua dây: 200 ô mỗi cột nhân số
    // cột là một phần tải không ai dùng, và nó còn nằm trong cache Redis.
    columns: cot.map((c) => ({
      columnIndex: c.columnIndex,
      sourceName: c.sourceName,
      semanticType: c.semanticType,
      samples: c.samples,
    })),
    // Soi trên cùng MỘT mẫu với phần đoán kiểu ở trên: cảnh báo nói về đúng
    // những ô mà kiểu đã được suy ra từ đó.
    canhBao: cot.flatMap((c) => canhBaoCot(c.sourceName, c.columnIndex, c.values, c.semanticType)),
  };
}
