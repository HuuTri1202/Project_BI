import type { FileExt, SemanticType } from '@bi/shared';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import Papa from 'papaparse';

import { storage } from '../../storage';
import { normalizeCell } from '../dataset/normalizeCell';
// `cellText` dùng CHUNG với `parseFile`, không chép lại: hai đường này đọc cùng
// một file Excel, và một bản sao lệch nhau nghĩa là bảng xem trước và dữ liệu
// trong kho nói hai điều khác nhau về đúng một ô. Cùng lý do với `normalizeCell`.
import { cellText } from '../dataset/parseFile';

/**
 * Đọc THẲNG file trong MinIO thành từng lô dòng, cho §9 nạp vào ClickHouse.
 *
 * ─── Vì sao không đọc `dataset_rows` như bản đầu ────────────────────────────
 *
 * Bản đầu của §9 nạp từ `dataset_rows` vì bảng đó đã có sẵn. Nó chạy đúng, và nó
 * đặt trần 50.000 dòng lên toàn bộ nguồn `file` — trần ấy không đến từ ClickHouse
 * (50.000 dòng chỉ tốn 4,57 MiB và nạp xong dưới 5 giây) mà đến từ ba chỗ trên
 * đường đi:
 *
 *   cache phân tích   MỘT khoá Redis, ~29 MB/50k dòng — Redis chặn cứng 512 MB
 *                     mỗi giá trị chuỗi, nên tường là khoảng 500.000 dòng
 *   dataset_rows      ~29 MB/50k dòng, phình 6,3× so với chính dữ liệu đó trong
 *                     ClickHouse, vì JSON lặp lại tên cột ở TỪNG dòng
 *   RAM Node          giữ cả mảng dòng trong lúc nạp
 *
 * Đọc thẳng file gỡ cả ba. Dữ liệu đi một mạch **file → ClickHouse**, không đọng
 * lại ở đâu, và `dataset_rows` co về đúng vai trò còn lại của nó: một mẫu để xem
 * trước.
 *
 * ─── Buffer vẫn nguyên khối, và vì sao chấp nhận được ───────────────────────
 *
 * `ObjectStorage.getObject` trả `Buffer`, nên file vẫn được tải trọn vẹn vào bộ
 * nhớ. Đó KHÔNG phải chỗ phình: `UPLOAD_MAX_BYTES` chặn ở 50 MB và buffer sống
 * đúng một lần nạp. Thứ thật sự nổ là mảng dòng đã parse — 50 MB văn bản thành
 * vài trăm MB đối tượng JS — và chính nó được thay bằng dòng chảy ở đây. Thêm
 * một API luồng vào `ObjectStorage` sẽ gỡ nốt phần cuối; ghi vào nợ, không giấu.
 */

/** Cột cần đọc, theo đúng thứ tự sẽ ghi sang ClickHouse. */
export interface FileColumnRef {
  /** Vị trí cột trong file (0-based) — `dataset_columns.ordinal`. */
  ordinal: number;
  /** Kiểu suy ra ở §7, quyết định cách chuẩn hoá ô. */
  semanticType: SemanticType;
}

export interface ReadFileOptions {
  /** Tên sheet cần đọc. Với CSV thì bỏ qua — file CSV chỉ có một bảng. */
  sheetName: string | null;
  columns: readonly FileColumnRef[];
  batchSize: number;
  /** Đọc tối đa bấy nhiêu dòng dữ liệu (không kể hàng tiêu đề). */
  maxRows: number;
}

/**
 * Phát ra từng lô `unknown[][]`, mỗi dòng đã xếp ĐÚNG thứ tự `opts.columns`.
 *
 * Cùng hình dạng với `Driver.readAllRows` của nguồn `connection` — cố ý, để
 * `loadDataset` xử lý hai nguồn bằng một vòng lặp thay vì hai nhánh phải giữ cho
 * khớp nhau.
 */
export async function* readFileRows(
  s3Key: string,
  ext: FileExt,
  opts: ReadFileOptions,
): AsyncGenerator<unknown[][], void, undefined> {
  const buffer = await storage.getObject(s3Key);
  // Cả hai nguồn phát ra NHÓM dòng, không phải từng dòng: một callback hay một
  // vòng lặp cho mỗi dòng của file nửa triệu dòng là nửa triệu lần chuyển ngữ
  // cảnh, và nó đo được — xem ghi chú ở `csvRows`.
  const source = ext === 'csv' ? csvRows(buffer) : xlsxRows(buffer, opts.sheetName);

  let batch: unknown[][] = [];
  let read = 0;

  outer: for await (const rows of source) {
    for (const raw of rows) {
      if (read >= opts.maxRows) break outer;
      read += 1;

      batch.push(opts.columns.map((c) => normalizeCell(raw[c.ordinal] ?? '', c.semanticType)));

      if (batch.length >= opts.batchSize) {
        yield batch;
        batch = [];
      }
    }
  }

  if (batch.length > 0) yield batch;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Phát từng dòng CSV, BỎ hàng tiêu đề.
 *
 * ─── Vì sao phải bắc cầu callback → async generator ────────────────────────
 *
 * Callback của papaparse là ĐỒNG BỘ: không `await` được bên trong, nên không thể
 * chờ ClickHouse ghi xong rồi mới đọc tiếp. Không điều tiết thì papaparse đọc
 * hết file với tốc độ tối đa và nhét toàn bộ vào hàng đợi — đúng cái mảng dòng
 * mà cả file này sinh ra để tránh.
 *
 * `parser.pause()` / `resume()` là lối ra: dừng khi hàng đợi đầy, chạy lại khi
 * người tiêu thụ đã lấy. Bộ nhớ bị chặn ở `QUEUE_LIMIT` dòng bất kể file to
 * bao nhiêu.
 *
 * ─── `chunk` chứ KHÔNG `step`, và đó là khác biệt về ĐỘ PHỨC TẠP ───────────
 *
 * `step` gọi callback MỘT LẦN MỖI DÒNG. Với 500.000 dòng đó là nửa triệu lời
 * gọi, và bản đầu của hàm này còn lấy dòng ra bằng `queue.shift()` — thao tác
 * O(n) trên mảng, nên tổng công là O(n²). Đo được: 500.000 dòng chạy quá năm
 * phút chưa xong.
 *
 * `chunk` trả về cả một MẢNG dòng cho mỗi khối dữ liệu đọc từ luồng, và hàng đợi
 * được TRÁO chứ không rút từng phần tử. Cả hai đều về O(n).
 */
const QUEUE_LIMIT = 20_000;

async function* csvRows(buffer: Buffer): AsyncGenerator<string[][], void, undefined> {
  /** Danh sách các KHỐI đang chờ; mỗi khối là một mảng dòng. */
  let queue: string[][][] = [];
  /** Tổng số DÒNG đang chờ — cái quyết định van, không phải số khối. */
  let queued = 0;
  let done = false;
  let failure: Error | null = null;
  /**
   * Van điều tiết, giữ trong một HỘP chứ không phải biến trần.
   *
   * `let parser = null` rồi gán bên trong callback thì TypeScript vẫn thu hẹp
   * biến về `null` ở chỗ dùng — nó không xâu chuỗi được thứ tự giữa một callback
   * và vòng lặp bên ngoài. Thu hẹp trên THUỘC TÍNH thì bị xoá sau mỗi lời gọi
   * hàm, nên hộp cho ra đúng kiểu mà không phải ép.
   */
  const throttle: { parser: { pause: () => void; resume: () => void } | null } = {
    parser: null,
  };
  /** Đánh thức bên tiêu thụ đang chờ dòng mới. */
  let wake: (() => void) | null = null;

  const signal = (): void => {
    wake?.();
    wake = null;
  };

  let first = true;

  // `as never`: papaparse KHAI BÁO tham số đầu là `string | LocalFile`, nhưng bản
  // Node của nó nhận cả `Readable` — đó chính là cơ chế `NODE_STREAM_INPUT` mà
  // tài liệu mô tả. Khai báo hẹp hơn hiện thực; ép kiểu ở đúng một chỗ, có ghi
  // chú, hơn là bỏ luồng để quay lại nạp cả file vào mảng.
  Papa.parse(Readable.from(buffer) as never, {
    header: false,
    skipEmptyLines: 'greedy',
    delimiter: '',
    chunk: (result: Papa.ParseResult<string[]>, self) => {
      throttle.parser = self;

      let rows = result.data;
      // Hàng đầu của khối ĐẦU TIÊN là tiêu đề. `dataset_columns.ordinal` đánh số
      // theo đúng thứ tự cột của hàng đó, nên bỏ nó đi là đủ — không cần đối
      // chiếu tên.
      if (first) {
        first = false;
        rows = rows.slice(1);
      }
      if (rows.length > 0) {
        queue.push(rows);
        queued += rows.length;
      }

      if (queued >= QUEUE_LIMIT) self.pause();
      signal();
    },
    complete: () => {
      done = true;
      signal();
    },
    error: (err: Error) => {
      failure = err;
      done = true;
      signal();
    },
  });

  for (;;) {
    if (queue.length > 0) {
      // TRÁO cả hàng đợi rồi mở van ngay, thay vì rút từng dòng: papaparse đọc
      // tiếp trong lúc bên tiêu thụ đang ghi lô này sang ClickHouse.
      const chunks = queue;
      queue = [];
      queued = 0;
      throttle.parser?.resume();

      for (const rows of chunks) yield rows;
      continue;
    }
    if (failure) throw failure;
    if (done) return;

    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

// ─── Excel ───────────────────────────────────────────────────────────────────

/**
 * Phát từng dòng của ĐÚNG một sheet, bỏ hàng tiêu đề.
 *
 * `WorkbookReader` đọc theo luồng và tự nó đã là async iterable, nên không cần
 * bắc cầu như CSV — điều tiết có sẵn trong `for await`.
 *
 * `worksheet.name` phải khớp `sheetName`: một file nhiều sheet sinh ra nhiều bộ
 * dữ liệu trỏ chung MỘT object trên S3, nên đọc nhầm sheet là nạp dữ liệu của bộ
 * khác vào bảng này — sai mà không có lỗi nào.
 */
/** Gom bấy nhiêu dòng rồi mới phát một lần — cùng lý do với `chunk` của CSV. */
const XLSX_GROUP = 2_000;

async function* xlsxRows(
  buffer: Buffer,
  sheetName: string | null,
): AsyncGenerator<string[][], void, undefined> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    // ⚠️ PHẢI là 'cache', không được 'ignore' (cũng là mặc định của exceljs).
    //
    // Trong xlsx, một ô ngày KHÔNG được lưu như ngày — nó là số sê-ri (số ngày
    // kể từ 1899-12-30) và chỉ có ĐỊNH DẠNG SỐ trong `xl/styles.xml` mới cho
    // biết đó là ngày. Bỏ styles đi thì exceljs trả về số trần: ô 31/07/2012 ra
    // đúng `41121`, `cellText` cho ra chuỗi "41121", và cả cột ngày thành NULL
    // trong ClickHouse.
    //
    // Bẫy ở chỗ nhánh phân tích (`workbook.xlsx.load`) LUÔN đọc styles, nên nó
    // nhận ra kiểu `date` và giao diện hiện đúng — chỉ nhánh nạp là hỏng. Hai
    // đường bất đồng mà không có lỗi nào ở bước phân tích.
    //
    // Đo trên Global-Superstore.xlsx (51.290 dòng): 'cache' 390 ms, 'ignore'
    // 429 ms. Không đắt hơn.
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });

  let found = false;

  for await (const worksheet of reader) {
    // `.name` CÓ trên đối tượng runtime nhưng thiếu trong khai báo kiểu của
    // exceljs 4.4 cho `WorksheetReader`. Thu hẹp tại chỗ thay vì ép `any`.
    const name = (worksheet as unknown as { name?: string }).name;

    if (sheetName !== null && name !== sheetName) {
      // Vẫn phải rút cạn sheet không dùng: bỏ qua mà không đọc sẽ khiến luồng
      // zip bên dưới kẹt ở giữa và sheet cần tìm không bao giờ tới.
      for await (const _row of worksheet) void _row;
      continue;
    }
    found = true;

    let first = true;
    let group: string[][] = [];

    for await (const row of worksheet) {
      if (first) {
        first = false;
        continue;
      }
      // `row.values` là mảng 1-INDEXED — phần tử 0 luôn `undefined`. Cắt bỏ nó,
      // nếu không mọi cột lệch một vị trí và cột cuối biến mất. Cùng một cái bẫy
      // đã ghi trong `parseFile.ts`.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      group.push(values.map(cellText));

      if (group.length >= XLSX_GROUP) {
        yield group;
        group = [];
      }
    }

    if (group.length > 0) yield group;
    break;
  }

  if (!found && sheetName !== null) {
    throw new Error(`Không tìm thấy sheet "${sheetName}" trong file.`);
  }
}

