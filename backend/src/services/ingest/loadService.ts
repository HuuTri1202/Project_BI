import {
  LOAD_ERROR_CODES,
  type DatasetCellValue,
  type DatasetLoadDto,
  type DatasetLoadErrorDto,
  type WarehousePageDto,
  type WarehouseSchemaDto,
} from '@bi/shared';

import { checkWarehouse, warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as loadsRepo from '../../repositories/datasetLoads';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError, notFound } from '../../utils/httpError';
import { chTableName, ROW_INDEX_COLUMN } from './buildDdl';

/**
 * Tầng giữa HTTP và việc nạp thật (§9.7).
 *
 * Endpoint `POST` chỉ XẾP HÀNG rồi trả về ngay — nạp 50.000 dòng mất nhiều phút,
 * và một request HTTP treo ngần ấy sẽ bị proxy cắt giữa chừng, để lại một lần
 * nạp không ai biết đã xong hay chưa. Vòng lặp nền nhặt việc từ bảng.
 */

export async function queueLoad(
  tenantId: number,
  datasetId: number,
  userId: number | null,
): Promise<DatasetLoadDto> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  // 404 chứ không 403 cho id của tổ chức khác — cùng quy ước với phần còn lại.
  if (!dataset) throw notFound('Không tìm thấy tập dữ liệu này.');

  if (dataset.status !== 'ready') {
    throw new HttpError(
      409,
      LOAD_ERROR_CODES.DATASET_NOT_LOADABLE,
      'Bộ dữ liệu chưa sẵn sàng. Hãy hoàn tất bước nhập file trước khi nạp vào kho phân tích.',
    );
  }

  const columns = await datasetsRepo.listColumns(mysqlPool, datasetId);
  if (columns.filter((c) => c.included).length === 0) {
    throw new HttpError(
      409,
      LOAD_ERROR_CODES.DATASET_NOT_LOADABLE,
      'Bộ dữ liệu không có cột nào được chọn nhập nên không dựng được bảng trong kho.',
    );
  }

  // ─── Kiểm ClickHouse NGAY, không đợi lỗi tự nổ trong vòng lặp nền ─────────
  //
  // Bài học từ vụ MinIO: khi một hạ tầng phía sau không chạy, thứ người dùng
  // thấy là "Có lỗi không xác định" — một câu không dẫn tới hành động nào. Nếu
  // để vòng lặp nền phát hiện thì còn tệ hơn: request này trả 201 "đã xếp hàng"
  // thành công, rồi vài giây sau job âm thầm `failed` ở một chỗ người dùng phải
  // tự đi tìm.
  //
  // Kiểm cả DATABASE chứ không chỉ máy chủ: `/ping` trả "Ok." dựa trên máy chủ,
  // nên nó vẫn xanh khi database kho đã bị xoá — và khi đó lớp kiểm này cho
  // request đi qua để job nền chết ở tầng dưới. Xem `checkWarehouse`.
  const trangThai = await checkWarehouse();

  if (trangThai === 'unreachable') {
    throw new HttpError(
      503,
      LOAD_ERROR_CODES.CLICKHOUSE_UNAVAILABLE,
      'Chưa kết nối được tới kho phân tích (ClickHouse). Hãy chạy "npm run infra:up" rồi thử lại.',
    );
  }

  if (trangThai === 'missing-database') {
    // Nói ĐÚNG việc phải làm, không nói "thử lại": thử lại bao nhiêu lần cũng
    // ra cùng kết quả. Nêu luôn nguyên nhân thường gặp, vì người gặp lỗi này
    // gần như luôn vừa chạy `down -v` và không nối được hai chuyện với nhau.
    throw new HttpError(
      503,
      LOAD_ERROR_CODES.WAREHOUSE_DATABASE_MISSING,
      `Kho phân tích đang chạy nhưng database "${env.CLICKHOUSE_DATABASE}" không tồn tại — ` +
        'thường là do volume ClickHouse đã bị xoá (`docker compose down -v`). ' +
        'Hãy chạy "npm run warehouse:init" để tạo lại, rồi nạp lại các bộ dữ liệu.',
    );
  }

  if (await loadsRepo.hasPendingRun(mysqlPool, tenantId, datasetId)) {
    throw new HttpError(
      409,
      LOAD_ERROR_CODES.LOAD_ALREADY_RUNNING,
      'Bộ dữ liệu này đang có một lần nạp chưa xong. Hãy đợi nó kết thúc.',
    );
  }

  await loadsRepo.enqueue(mysqlPool, tenantId, datasetId, userId);
  await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'queued');

  return getLoadStatus(tenantId, datasetId);
}

export async function getLoadStatus(
  tenantId: number,
  datasetId: number,
): Promise<DatasetLoadDto> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  if (!dataset) throw notFound('Không tìm thấy tập dữ liệu này.');

  const run = await loadsRepo.findLatestRun(mysqlPool, tenantId, datasetId);

  // Chưa từng nạp -> KHÔNG phải 404. Giao diện cần một câu trả lời hợp lệ để vẽ
  // nút "Nạp vào kho phân tích"; bắt nó phân biệt 404-nghĩa-là-chưa-nạp với
  // 404-nghĩa-là-không-có-dataset là mời một lỗi vào chỗ không cần thiết.
  if (!run) {
    return {
      runId: null,
      status: null,
      datasetStatus: dataset.loadStatus,
      rowsRead: 0,
      rowsLoaded: 0,
      rowsFailed: 0,
      errorMessage: null,
      chTable: null,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  return { ...run, datasetStatus: dataset.loadStatus };
}

/**
 * Đọc MỘT TRANG của bảng trong ClickHouse — để người dùng KIỂM CHỨNG lần nạp.
 *
 * ─── Khác hẳn tab "Dữ liệu", và khác biệt đó là toàn bộ giá trị của nó ──────
 *
 * Tab "Dữ liệu" (§8.9) đọc từ NGUỒN: một câu SELECT bắn sang CSDL khách hàng,
 * hoặc `dataset_rows` với nguồn file. Nó trả lời "dữ liệu gốc trông thế nào".
 *
 * Hàm này đọc từ ĐÍCH. Nó trả lời một câu khác hẳn và là câu duy nhất chứng minh
 * được lần nạp đã đúng: "thứ NẰM TRONG KHO trông thế nào". Nếu ánh xạ kiểu sai,
 * nếu ngày lệch 7 tiếng, nếu một cột toàn NULL vì tra nhầm khoá — chỉ nhìn vào
 * đây mới thấy. So hai bảng cạnh nhau là cách kiểm chứng rẻ nhất, và không phải
 * mở terminal gõ `clickhouse-client`.
 *
 * Cũng vì thế nó cố ý KHÔNG giấu cột `_row_index`: đó là cầu nối giữa một dòng
 * trong kho và một dòng trong bảng lỗi ở §9.8.
 *
 * Phân trang THẬT (có `total`), không phải cắt ngọn như phía nguồn — lý do nằm ở
 * `WarehousePageDto` và ở chú thích của câu `count()` bên dưới.
 */
export async function previewWarehouse(
  tenantId: number,
  datasetId: number,
  page: number,
  pageSize: number,
): Promise<WarehousePageDto> {
  const table = await requireLoadedTable(tenantId, datasetId);

  try {
    // `{tbl:Identifier}` — ClickHouse tham số hoá được cả ĐỊNH DANH, nên không
    // phải ghép chuỗi nào vào SQL ở đây. (Câu `CREATE TABLE` thì không có may
    // mắn đó — xem `buildDdl.ts`.)
    //
    // `JSONCompactEachRowWithNames`: dòng đầu là tên cột, các dòng sau là mảng
    // giá trị. Giữ đúng thứ tự cột và không nhân tên cột lên 100 lần.
    //
    // `OFFSET` ở đây KHÔNG mang nhược điểm đã ghi ở §9.4 cho CSDL nguồn: bảng
    // được `ORDER BY _row_index`, nên ClickHouse nhảy thẳng tới granule chứa
    // offset thay vì quét từ đầu. Và bảng này bất động giữa hai lần nạp — không
    // có chuyện dòng trôi sang trang khác trong lúc người dùng bấm "Sau".
    const [rs, countRs] = await Promise.all([
      warehouse.query({
        query:
          'SELECT * FROM {db:Identifier}.{tbl:Identifier} ' +
          'ORDER BY {ord:Identifier} LIMIT {n:UInt32} OFFSET {skip:UInt64}',
        query_params: {
          db: env.CLICKHOUSE_DATABASE,
          tbl: table,
          ord: ROW_INDEX_COLUMN,
          n: pageSize,
          skip: (page - 1) * pageSize,
        },
        format: 'JSONCompactEachRowWithNames',
      }),
      warehouse.query({
        // `count()` trên MergeTree đọc từ metadata của part, không quét dòng nào
        // — nên hiện được tổng thật, khác hẳn phía CSDL nguồn nơi `COUNT(*)` là
        // một lần quét toàn bảng trên máy của khách hàng.
        query: 'SELECT count() AS n FROM {db:Identifier}.{tbl:Identifier}',
        query_params: { db: env.CLICKHOUSE_DATABASE, tbl: table },
        format: 'JSONEachRow',
      }),
    ]);

    const lines = await rs.json<unknown[]>();
    const [names, ...data] = lines;
    const counted = await countRs.json<{ n: string | number }>();
    const total = Number(counted[0]?.n ?? 0);

    return {
      columns: Array.isArray(names) ? names.map(String) : [],
      rows: data.map((row) => (Array.isArray(row) ? row.map(toPreviewCell) : [])),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  } catch (err) {
    throw warehouseUnavailable(err);
  }
}

/**
 * Cấu trúc THẬT của bảng trong kho, đọc từ `system.columns`.
 *
 * Vì sao không suy ra từ `dataset_columns`: bảng đó mô tả NGUỒN. Nó không biết
 * `decimal(10,2)` của MySQL thành `Nullable(Decimal(10, 2))`, cũng không biết
 * `_row_index` tồn tại. Muốn trả lời "cột này nằm trong kho dưới dạng gì" thì
 * phải hỏi kho — mọi câu trả lời suy diễn đều có thể lệch với thực tế mà không
 * ai phát hiện, đúng kiểu lỗi cột ngày Excel đã mắc.
 */
export async function warehouseSchema(
  tenantId: number,
  datasetId: number,
): Promise<WarehouseSchemaDto> {
  const table = await requireLoadedTable(tenantId, datasetId);

  try {
    const rs = await warehouse.query({
      query:
        'SELECT name, type, position FROM system.columns ' +
        'WHERE database = {db:String} AND table = {tbl:String} ORDER BY position',
      query_params: { db: env.CLICKHOUSE_DATABASE, tbl: table },
      format: 'JSONEachRow',
    });

    const rows = await rs.json<{ name: string; type: string; position: string | number }>();

    return {
      table,
      columns: rows.map((row) => ({
        // `position` của ClickHouse đếm từ 1; hạ về 0 cho khớp `ordinal` mà phần
        // còn lại của hệ thống dùng.
        ordinal: Number(row.position) - 1,
        name: row.name,
        type: row.type,
        nullable: row.type.startsWith('Nullable('),
      })),
    };
  } catch (err) {
    throw warehouseUnavailable(err);
  }
}

/**
 * Chốt rằng bộ dữ liệu tồn tại, đã nạp, rồi trả về tên bảng.
 *
 * Tên bảng SUY LẠI từ hai id thay vì đọc `datasets.ch_table`. Được phép vì tên
 * là hàm THUẦN của (tenantId, datasetId) — đó chính là lý do quy ước đặt tên
 * không nhận một ký tự nào của người dùng. Suy lại thì không có đường nào để một
 * giá trị lạ trong cột đó đi vào câu truy vấn.
 */
async function requireLoadedTable(tenantId: number, datasetId: number): Promise<string> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  if (!dataset) throw notFound('Không tìm thấy tập dữ liệu này.');

  if (dataset.loadStatus !== 'loaded') {
    throw new HttpError(
      409,
      LOAD_ERROR_CODES.DATASET_NOT_LOADABLE,
      'Bộ dữ liệu chưa được nạp vào kho phân tích nên chưa có gì để xem.',
    );
  }

  return chTableName(tenantId, datasetId);
}

/**
 * Bảng có thể đã bị xoá tay, hoặc ClickHouse vừa tắt. Cả hai đều là chuyện của
 * hạ tầng chứ không phải của request, và câu trả lời phải nói được việc cần làm.
 */
function warehouseUnavailable(cause: unknown): HttpError {
  console.error('[ingest] không đọc được kho phân tích:', cause);
  return new HttpError(
    503,
    LOAD_ERROR_CODES.CLICKHOUSE_UNAVAILABLE,
    'Không đọc được bảng trong kho phân tích. Kiểm tra ClickHouse ("npm run infra:up") rồi thử nạp lại.',
  );
}

/** ClickHouse trả JSON sẵn; chỉ còn phải hạ những kiểu JSON không mang qua được. */
function toPreviewCell(value: unknown): DatasetCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

export async function listLoadErrors(
  tenantId: number,
  datasetId: number,
  page: number,
  pageSize: number,
): Promise<{ items: DatasetLoadErrorDto[]; total: number; savedCap: number }> {
  const run = await loadsRepo.findLatestRun(mysqlPool, tenantId, datasetId);
  if (!run || run.runId === null) {
    return { items: [], total: 0, savedCap: loadsRepo.MAX_LOAD_ERRORS };
  }

  const [items, total] = await Promise.all([
    loadsRepo.listErrors(mysqlPool, run.runId, page, pageSize),
    loadsRepo.countErrors(mysqlPool, run.runId),
  ]);

  // `total` ở đây là số dòng ĐÃ LƯU (tối đa `MAX_LOAD_ERRORS`), còn số ô hỏng
  // THẬT nằm ở `run.rowsFailed`. Giao diện phải nói được cả hai, nếu không người
  // dùng thấy "100 lỗi" cho một file hỏng 12.480 ô và tưởng đã sửa gần xong.
  return { items, total, savedCap: loadsRepo.MAX_LOAD_ERRORS };
}
