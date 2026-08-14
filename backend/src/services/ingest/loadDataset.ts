import type { DatasetDto } from '@bi/shared';

import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as loadsRepo from '../../repositories/datasetLoads';
import * as datasetsRepo from '../../repositories/datasets';
import { requireSecret, toConfigFromSecret } from '../connections/connectionService';
import { driverFor } from '../connections/drivers';
import {
  buildCreateTable,
  buildIngestColumns,
  chTableName,
  insertColumnList,
  qualified,
  type IngestColumn,
} from './buildDdl';
import { readFileRows } from './readFileRows';
import { toClickHouseDateTime } from './typeMap';

/**
 * Chạy MỘT lần nạp, từ đầu tới cuối (§9.4, §9.5, §9.7).
 *
 * Hàm này KHÔNG biết gì về hàng đợi hay HTTP: nó nhận một `runId` đã được nhặt,
 * làm việc, rồi ghi kết quả. Nhờ vậy test tích hợp gọi thẳng nó và `await` được,
 * thay vì phải chờ một vòng lặp nền — chờ vòng lặp trong test là công thức của
 * bài test lúc xanh lúc đỏ tuỳ tốc độ máy.
 */

/**
 * Số dòng mỗi lô gửi sang ClickHouse.
 *
 * Có SÀN và có TRẦN, cả hai đều là ràng buộc thật:
 *
 *   Sàn ~1.000 — mỗi câu INSERT sinh một *part* trên đĩa. Chèn 100 dòng một lần
 *   cho 50.000 dòng là 500 part, và ClickHouse sẽ ném `Too many parts` rồi chặn
 *   ghi.
 *
 *   Trần từ `users.d/limits.xml`: `max_memory_usage` đo được là 954 MiB trên
 *   container 2 GB. 5.000 dòng × vài chục cột ≈ vài chục MB body JSON — cách xa
 *   trần, và cũng cách xa `max_execution_time`.
 */
const BATCH_ROWS = 5_000;

/**
 * Trần số dòng cho MỘT lần nạp từ CSDL nguồn.
 *
 * Nguồn `file` đã bị §7 chặn ở `DATASET_MAX_ROWS`, nhưng nguồn `connection` thì
 * không có trần nào — một bảng 500 triệu dòng sẽ chảy vào container ClickHouse
 * 2 GB cho tới khi nó chết. Chạm trần KHÔNG phải lỗi: lần nạp vẫn `succeeded`,
 * kèm một dòng trong bảng lỗi nói rõ đã cắt ở đâu, vì im lặng cắt mất chín phần
 * mười dữ liệu rồi vẽ biểu đồ lên phần còn lại là kiểu sai tệ nhất trong BI.
 */
const MAX_INGEST_ROWS = 1_000_000;

export interface LoadOutcome {
  rowsRead: number;
  rowsLoaded: number;
  /** Số Ô hỏng, không phải số dòng hỏng. Một dòng có thể góp nhiều ô. */
  rowsFailed: number;
  chTable: string;
}

export async function loadDataset(
  runId: number,
  tenantId: number,
  datasetId: number,
): Promise<LoadOutcome> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  if (!dataset) throw new Error('Bộ dữ liệu không còn tồn tại.');

  const allColumns = await datasetsRepo.listColumns(mysqlPool, datasetId);
  const columns = buildIngestColumns(dataset.source, allColumns);
  if (columns.length === 0) {
    throw new Error('Bộ dữ liệu không có cột nào được chọn nhập, không dựng được bảng.');
  }

  const db = env.CLICKHOUSE_DATABASE;
  const target = chTableName(tenantId, datasetId);
  const staging = `${target}__new`;

  // ─── Nạp lại NGUYÊN TỬ: nạp vào bảng tạm rồi tráo tên ─────────────────────
  //
  // Cách hiển nhiên (TRUNCATE rồi nạp lại) để lộ một cửa sổ vài phút trong đó
  // bảng rỗng hoặc thiếu dòng, và MỌI báo cáo dựng trên nó trả về số 0. Nạp vào
  // bảng tạm thì bảng đang phục vụ không bị đụng tới một mili-giây nào, và một
  // lần nạp hỏng giữa chừng cũng không làm mất dữ liệu cũ.

  // `SYNC` là BẮT BUỘC, không phải trang trí. `bi_analytics` dùng engine
  // `Atomic` (đã kiểm bằng `system.databases`), ở đó `DROP TABLE` chỉ đánh dấu
  // xoá rồi dọn thật sau `database_atomic_delay_before_drop_table_sec` — mặc
  // định 480 GIÂY. Thiếu `SYNC` thì câu `CREATE` ngay sau đây nổ "Directory for
  // table data already exists", và lỗi ấy chỉ xuất hiện khi nạp lại trong vòng
  // tám phút — tức là đúng lúc người ta đang thử nghiệm.
  await command(`DROP TABLE IF EXISTS ${qualified(db, staging)} SYNC`);
  await command(buildCreateTable(db, staging, columns));

  let outcome: LoadOutcome;
  try {
    outcome = await fill(runId, tenantId, dataset, columns, db, staging, target);
  } catch (err) {
    // Dọn bảng tạm rồi ném tiếp. Bỏ lại thì lần sau `DROP … SYNC` cũng xử lý
    // được, nhưng để một bảng rác nằm chờ tám phút là chiếm đĩa vô cớ.
    await command(`DROP TABLE IF EXISTS ${qualified(db, staging)} SYNC`).catch(() => undefined);
    throw err;
  }

  // `EXCHANGE TABLES` đòi CẢ HAI vế phải tồn tại. Lần nạp đầu tiên thì bảng đích
  // chưa có, nên tạo một bảng rỗng cùng schema — rẻ hơn nhiều so với rẽ nhánh
  // "đã tồn tại chưa", và nhánh đó còn có khe hở giữa lúc kiểm và lúc tráo.
  await command(buildCreateTable(db, target, columns));

  // Tráo TÊN, nguyên tử. `EXCHANGE` không quan tâm hai bảng có cùng schema hay
  // không — nên schema mới thay schema cũ ở đây là đúng ý: bảng nguồn thêm cột
  // thì lần nạp sau tự có cột đó.
  await command(`EXCHANGE TABLES ${qualified(db, target)} AND ${qualified(db, staging)}`);

  // Bảng cũ giờ mang tên tạm. `SYNC` để trả đĩa ngay thay vì tám phút nữa.
  await command(`DROP TABLE IF EXISTS ${qualified(db, staging)} SYNC`);

  return outcome;
}

async function command(query: string): Promise<void> {
  await warehouse.command({ query });
}

/**
 * Đọc nguồn theo lô, chuyển kiểu, ghi sang bảng tạm.
 *
 * Ghi tiến độ sau mỗi lô để giao diện thấy con số nhích lên — không có nó thì
 * một lần nạp mười phút trông y hệt một lần nạp bị treo.
 */
async function fill(
  runId: number,
  tenantId: number,
  dataset: DatasetDto,
  columns: readonly IngestColumn[],
  db: string,
  staging: string,
  target: string,
): Promise<LoadOutcome> {
  const insertColumns = insertColumnList(columns);
  const errors = new ErrorSink(runId);

  let rowsRead = 0;
  let rowsLoaded = 0;

  const writeBatch = async (values: unknown[][]): Promise<void> => {
    if (values.length === 0) return;
    await warehouse.insert({
      table: qualified(db, staging),
      values,
      // `JSONCompactEachRow`: mỗi dòng là một MẢNG giá trị, không lặp tên cột.
      // `JSONEachRow` sẽ nhắc lại tên cột một lần cho mỗi ô — với 24 cột × 50.000
      // dòng là hơn một triệu lần, thuần chi phí đường truyền.
      format: 'JSONCompactEachRow',
      // ⚠️ `@clickhouse/client` ghép mảng này vào SQL bằng `.join(', ')` và KHÔNG
      // escape gì — đã đọc `dist/common/client.js`. `insertColumnList` đã bọc sẵn.
      //
      // Ép kiểu vì client đòi `NonEmptyArray`, thứ TypeScript không suy ra được
      // từ một `map()`. `buildIngestColumns` đã bảo đảm có ít nhất một cột (và
      // `loadDataset` ném lỗi nếu không), cộng thêm `_row_index` luôn có mặt.
      columns: insertColumns as [string, ...string[]],
    });
    rowsLoaded += values.length;
    await loadsRepo.updateProgress(mysqlPool, runId, {
      rowsRead,
      rowsLoaded,
      rowsFailed: errors.total,
    });
  };

  // MỘT vòng lặp cho cả hai nguồn.
  //
  // Trước đây đây là hai nhánh: nguồn `file` phân trang `dataset_rows` theo khoá,
  // nguồn `connection` chảy qua async generator. Từ khi `readFileRows` phát ra
  // đúng hình dạng `unknown[][]` mà driver phát ra, hai nhánh gộp được — và đó
  // không chỉ là gọn: hai vòng lặp riêng nghĩa là mọi sửa đổi về đánh số dòng,
  // ghi tiến độ hay đếm lỗi đều phải làm hai lần cho khớp.
  const { stream, maxRows } = await openSource(tenantId, dataset, columns);

  for await (const batch of stream) {
    const values = batch.map((row) => {
      const index = rowsRead;
      rowsRead += 1;
      return [...columns.map((col, i) => convert(row[i], col, index, errors)), index];
    });
    await writeBatch(values);
  }

  // Trần đi KÈM luồng, không phải hằng số cố định: hai nguồn có hai trần khác
  // nhau (`DATASET_MAX_ROWS` cho file, `MAX_INGEST_ROWS` cho CSDL). So với một
  // hằng số duy nhất thì nguồn file sẽ bị cắt mà không dòng lỗi nào được ghi —
  // im lặng cắt mất dữ liệu rồi vẽ biểu đồ lên phần còn lại là kiểu sai tệ nhất
  // trong BI.
  if (rowsRead >= maxRows) {
    errors.push({
      rowIndex: maxRows,
      columnName: null,
      rawValue: null,
      reason: `Đã chạm trần ${maxRows.toLocaleString('vi-VN')} dòng cho một lần nạp; phần còn lại chưa được nạp.`,
    });
  }

  await errors.flush();
  return { rowsRead, rowsLoaded, rowsFailed: errors.total, chTable: target };
}

/**
 * Mở nguồn dòng, che đi việc nó là file hay CSDL.
 *
 * Trả về cùng một kiểu cho cả hai: từng lô `unknown[][]`, mỗi dòng xếp đúng thứ
 * tự `columns`. Nhờ vậy `fill` không cần biết mình đang nạp từ đâu.
 */
interface RowSource {
  stream: AsyncGenerator<unknown[][], void, undefined>;
  /** Trần đã áp cho luồng này, để nơi gọi ghi đúng dòng lỗi khi chạm. */
  maxRows: number;
}

async function openSource(
  tenantId: number,
  dataset: DatasetDto,
  columns: readonly IngestColumn[],
): Promise<RowSource> {
  if (dataset.source === 'file') {
    const file = await datasetsRepo.findStorageKey(mysqlPool, tenantId, dataset.id);
    if (!file) {
      throw new Error('Không tìm thấy file gốc của bộ dữ liệu này trong kho lưu trữ.');
    }

    // Trần của nguồn `file` là `DATASET_MAX_ROWS` — cùng con số mà §7 dùng để
    // bật cờ "đã cắt bớt" trên giao diện. Dùng `MAX_INGEST_ROWS` ở đây sẽ nạp
    // nhiều hơn số mà người dùng vừa được báo là sẽ nạp.
    const maxRows = env.DATASET_MAX_ROWS;

    // Đọc THẲNG file, không qua `dataset_rows` — xem đầu `readFileRows.ts`. Từ
    // đây `dataset_rows` chỉ còn là mẫu để xem trước, nên nạp từ nó sẽ nạp thiếu.
    return {
      maxRows,
      stream: readFileRows(file.key, file.ext, {
        sheetName: dataset.sheetName,
        columns: columns.map((c) => ({
          ordinal: c.sourceOrdinal,
          semanticType: c.semanticType ?? 'text',
        })),
        batchSize: BATCH_ROWS,
        maxRows,
      }),
    };
  }

  if (dataset.connectionId === null || dataset.sourceSchema === null || dataset.sourceTable === null) {
    throw new Error('Bộ dữ liệu nguồn CSDL thiếu thông tin kết nối.');
  }

  const secret = await requireSecret(tenantId, dataset.connectionId);
  const cfg = await toConfigFromSecret(secret);
  const ref = { schema: dataset.sourceSchema, table: dataset.sourceTable };

  return {
    maxRows: MAX_INGEST_ROWS,
    stream: driverFor(secret.kind).readAllRows(cfg, ref, {
      // Tên cột NGUỒN, không phải tên hiển thị: nguồn `connection` để trống
      // `field_name`, nên `key` chính là tên cột trong CSDL của khách hàng.
      columns: columns.map((c) => c.key),
      batchSize: BATCH_ROWS,
      maxRows: MAX_INGEST_ROWS,
    }),
  };
}

/**
 * Ép một giá trị nguồn về dạng ClickHouse nhận được.
 *
 * ─── Luật xuyên suốt: một Ô hỏng KHÔNG được giết cả lần nạp ────────────────
 *
 * Ô không ép được -> ghi `NULL` VÀ một dòng vào `dataset_load_errors`, rồi đi
 * tiếp. Với dữ liệu thật thì sẽ luôn có ô rác; bắt hỏng cả lần nạp nghĩa là
 * người dùng không bao giờ nạp được gì. Một ô ngày sai định dạng ở dòng 40.000
 * không được phép giết một lần nạp đã chạy mười phút.
 *
 * Đó cũng là lý do MỌI cột đều `Nullable` — xem ghi chú đầu `typeMap.ts`.
 */
function convert(
  raw: unknown,
  col: IngestColumn,
  rowIndex: number,
  errors: ErrorSink,
): unknown {
  if (raw === null || raw === undefined || raw === '') return null;

  if (col.isDateTime) {
    // §7 lưu ngày dưới dạng CHUỖI (có thể ISO, có thể `31/12/2026`), còn driver
    // MySQL bật `dateStrings` nên `DATETIME`/`TIMESTAMP` cũng về dạng chuỗi.
    // Một đường xử lý cho cả hai.
    const text = raw instanceof Date ? raw.toISOString().replace('T', ' ').slice(0, 23) : String(raw);
    const parsed = toClickHouseDateTime(text);
    if (parsed === null) {
      errors.push({
        rowIndex,
        columnName: col.name,
        rawValue: text,
        reason: 'Không đọc được thành ngày giờ.',
      });
      return null;
    }
    return parsed;
  }

  if (col.isBoolean) {
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    return ['true', '1', 'yes', 'có', 'x'].includes(String(raw).toLowerCase()) ? 1 : 0;
  }

  if (col.isNumber) {
    if (typeof raw === 'number') {
      // `NaN`/`Infinity` không phải JSON hợp lệ và ClickHouse từ chối cả lô.
      if (!Number.isFinite(raw)) {
        errors.push({
          rowIndex,
          columnName: col.name,
          rawValue: String(raw),
          reason: 'Giá trị số không hữu hạn.',
        });
        return null;
      }
      return raw;
    }
    // Chuỗi giữ NGUYÊN, không `Number()`: mysql2 trả `BIGINT`/`DECIMAL` dưới
    // dạng chuỗi chính vì đi qua `Number` là mất chữ số. ClickHouse parse thẳng
    // chuỗi đó vào Int64/Decimal đúng từng chữ số.
    const text = String(raw);
    if (!/^-?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(text)) {
      errors.push({ rowIndex, columnName: col.name, rawValue: text, reason: 'Không đọc được thành số.' });
      return null;
    }
    return text;
  }

  // Cột chuỗi. `Buffer` và mọi thứ lạ đều về chuỗi — không bao giờ mất dữ liệu,
  // cùng lắm §10 phải ép kiểu.
  if (typeof raw === 'string') return raw;
  if (raw instanceof Date) return raw.toISOString();
  if (ArrayBuffer.isView(raw)) return `⟨nhị phân, ${raw.byteLength} byte⟩`;
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

/**
 * Gom ô lỗi, ghi theo lô, và DỪNG GHI khi chạm trần — nhưng vẫn ĐẾM tiếp.
 *
 * Hai con số khác nhau và người dùng cần cả hai: `total` trả lời "hỏng bao
 * nhiêu", còn 100 dòng lưu lại trả lời "hỏng thế nào". Xem `MAX_LOAD_ERRORS`.
 */
class ErrorSink {
  total = 0;
  private saved = 0;
  private buffer: loadsRepo.LoadErrorInput[] = [];

  constructor(private readonly runId: number) {}

  push(error: loadsRepo.LoadErrorInput): void {
    this.total += 1;
    if (this.saved + this.buffer.length >= loadsRepo.MAX_LOAD_ERRORS) return;
    this.buffer.push(error);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await loadsRepo.insertErrors(mysqlPool, this.runId, this.buffer);
    this.saved += this.buffer.length;
    this.buffer = [];
  }
}
