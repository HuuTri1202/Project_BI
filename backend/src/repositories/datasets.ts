import type {
  DatasetColumnDto,
  DatasetDto,
  DatasetStatus,
  FileExt,
  SourceType,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Bộ dữ liệu — §7.
 *
 * Cùng khuôn với `projects.ts`: mọi hàm nhận `tenantId` và mọi câu lệnh mang
 * `WHERE tenant_id = ?`, nên chạm nhầm tổ chức cho ra "không có dòng nào" thay
 * vì "thiếu một câu if". Nơi gọi thấy 0 dòng thì trả 404 — 403 sẽ xác nhận rằng
 * id đó có tồn tại.
 *
 * Bảng `dataset_columns` và `dataset_rows` KHÔNG có `tenant_id`: chúng luôn được
 * truy vấn qua `dataset_id`, mà `datasets` đã bị chặn theo tổ chức. Thêm cột ở
 * đó là thêm một chỗ có thể lệch mà không mua thêm lớp bảo vệ nào — nhưng đổi
 * lại, MỌI hàm dưới đây chạm tới hai bảng con đều phải nhận `datasetId` đã được
 * xác thực trước, không phải id thô từ URL.
 */

export type DatasetSortKey = 'name' | 'createdAt' | 'updatedAt' | 'rowCount';

export const DATASET_SORT_KEYS: readonly DatasetSortKey[] = [
  'name',
  'createdAt',
  'updatedAt',
  'rowCount',
];

const SORT_SQL: Record<DatasetSortKey, string> = {
  name: 'd.name',
  createdAt: 'd.created_at',
  updatedAt: 'd.updated_at',
  rowCount: 'd.row_count',
};

export interface ListDatasetsFilter {
  workspaceId: number;
  search?: string | undefined;
  status?: DatasetStatus | undefined;
  sort: DatasetSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

interface DatasetRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  name: string;
  original_filename: string;
  file_ext: FileExt;
  file_size_bytes: number;
  source_type: SourceType;
  sheet_name: string | null;
  status: DatasetStatus;
  error_message: string | null;
  row_count: number;
  truncated: number;
  column_count: number;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `d.id, d.workspace_id, d.name, d.original_filename, d.file_ext,
            d.file_size_bytes, d.source_type, d.sheet_name, d.status, d.error_message,
            d.row_count, d.truncated, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM dataset_columns c WHERE c.dataset_id = d.id) AS column_count,
            d.created_at, d.updated_at
       FROM datasets d
       LEFT JOIN users u ON u.id = d.created_by`;

function toDto(row: DatasetRow): DatasetDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: row.name,
    originalFilename: row.original_filename,
    fileExt: row.file_ext,
    fileSizeBytes: Number(row.file_size_bytes),
    sourceType: row.source_type,
    sheetName: row.sheet_name,
    status: row.status,
    errorMessage: row.error_message,
    rowCount: Number(row.row_count),
    truncated: row.truncated === 1,
    columnCount: Number(row.column_count),
    creatorName: row.creator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Điều kiện WHERE dùng chung cho `count` và `list`.
 *
 * Hai câu phải khớp nhau tuyệt đối, nếu không thì tổng số và số dòng thật lệch
 * nhau — phân trang hiện "trang 3/5" mà trang 3 trống rỗng.
 *
 * Mặc định CHỈ lấy `status = 'ready'`. Bản ghi `pending` là rác của những lần
 * đóng wizard giữa chừng và không có gì để xem; `failed` thì hiện khi người dùng
 * chủ động lọc, để họ biết vì sao file mình tải lên không dùng được.
 */
function buildWhere(tenantId: number, filter: ListDatasetsFilter): {
  sql: string;
  params: (string | number)[];
} {
  const conditions = ['d.tenant_id = ?', 'd.workspace_id = ?', 'd.deleted_at IS NULL'];
  const params: (string | number)[] = [tenantId, filter.workspaceId];

  if (filter.status) {
    conditions.push('d.status = ?');
    params.push(filter.status);
  } else {
    conditions.push("d.status = 'ready'");
  }

  if (filter.search) {
    conditions.push(`(d.name LIKE ? ESCAPE '\\\\' OR d.original_filename LIKE ? ESCAPE '\\\\')`);
    const term = `%${escapeLikeTerm(filter.search)}%`;
    params.push(term, term);
  }

  return { sql: conditions.join(' AND '), params };
}

export async function countDatasets(
  db: Db,
  tenantId: number,
  filter: ListDatasetsFilter,
): Promise<number> {
  const where = buildWhere(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM datasets d WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listDatasets(
  db: Db,
  tenantId: number,
  filter: ListDatasetsFilter,
): Promise<DatasetDto[]> {
  const where = buildWhere(tenantId, filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';

  // `, d.id ASC` phá hoà: thiếu nó, các dòng trùng khoá sắp xếp đảo chỗ giữa hai
  // trang và một bản ghi xuất hiện hai lần trong khi một bản ghi khác biến mất.
  const [rows] = await db.query<DatasetRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE ${where.sql}
      ORDER BY ${SORT_SQL[filter.sort]} ${direction}, d.id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toDto);
}

/**
 * Tìm theo id, KHÔNG lọc theo `status`.
 *
 * Khác `listDatasets`: wizard phải đọc được bản ghi `pending` của chính nó giữa
 * hai bước, và trang chi tiết phải hiện được bản ghi `failed` kèm lý do.
 */
export async function findById(db: Db, tenantId: number, id: number): Promise<DatasetDto | null> {
  const [rows] = await db.query<DatasetRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE d.tenant_id = ? AND d.id = ? AND d.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

/**
 * Khoá lưu trữ của một dataset.
 *
 * Tách riêng khỏi `findById` vì `s3_key` không thuộc về DTO — nó là chi tiết hạ
 * tầng mà không màn hình nào cần.
 *
 * Nói cho đúng: đây KHÔNG phải một biện pháp bảo mật. Presigned URL bắt buộc
 * chứa khoá trong đường dẫn, nên client đã biết khoá của chính mình từ bước xin
 * URL. Thứ thật sự bảo vệ là khoá do server sinh với một UUID ngẫu nhiên và
 * mang tiền tố tổ chức của người gọi — biết khoá của mình không giúp đoán khoá
 * của người khác. Xem `services/dataset/storageKey.ts`.
 */
export async function findStorageKey(
  db: Db,
  tenantId: number,
  id: number,
): Promise<{ key: string; ext: FileExt } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT s3_key, file_ext FROM datasets
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? { key: String(row['s3_key']), ext: row['file_ext'] as FileExt } : null;
}

export interface CreateDatasetInput {
  workspaceId: number;
  name: string;
  originalFilename: string;
  fileExt: FileExt;
  s3Key: string;
  createdBy: number;
}

export async function createDataset(
  db: Db,
  tenantId: number,
  input: CreateDatasetInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, workspace_id, name, original_filename, file_ext, s3_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.workspaceId,
      input.name,
      input.originalFilename,
      input.fileExt,
      input.s3Key,
      input.createdBy,
    ],
  );
  return result.insertId;
}

export async function markReady(
  db: Db,
  datasetId: number,
  input: { name: string; sheetName: string; rowCount: number; truncated: boolean; fileSize: number },
): Promise<void> {
  await db.query(
    `UPDATE datasets
        SET status = 'ready', name = ?, sheet_name = ?, row_count = ?,
            truncated = ?, file_size_bytes = ?, error_message = NULL
      WHERE id = ?`,
    [
      input.name,
      input.sheetName,
      input.rowCount,
      input.truncated ? 1 : 0,
      input.fileSize,
      datasetId,
    ],
  );
}

/**
 * Ghi lại lý do hỏng thay vì xoá bản ghi.
 *
 * Xoá đi thì người dùng tải file lên, thấy màn hình lỗi, bấm F5 và không còn dấu
 * vết nào của việc vừa xảy ra. Giữ lại kèm lý do thì trang §7.8 lọc `failed` là
 * đọc được chuyện gì đã hỏng.
 */
export async function markFailed(db: Db, datasetId: number, reason: string): Promise<void> {
  await db.query(
    `UPDATE datasets SET status = 'failed', error_message = ? WHERE id = ?`,
    [reason.slice(0, 500), datasetId],
  );
}

export async function softDeleteDataset(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datasets SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}

/** Báo cáo còn sống đang dựng trên bộ dữ liệu này. */
export async function countLiveReports(db: Db, datasetId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM reports WHERE dataset_id = ? AND deleted_at IS NULL',
    [datasetId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

// ─── Cột ─────────────────────────────────────────────────────────────────────

interface ColumnRow extends RowDataPacket {
  id: number;
  column_index: number;
  source_name: string;
  field_name: string;
  data_type: DatasetColumnDto['dataType'];
  field_role: DatasetColumnDto['fieldRole'];
  included: number;
}

export async function listColumns(db: Db, datasetId: number): Promise<DatasetColumnDto[]> {
  const [rows] = await db.query<ColumnRow[]>(
    `SELECT id, column_index, source_name, field_name, data_type, field_role, included
       FROM dataset_columns WHERE dataset_id = ? ORDER BY column_index ASC`,
    [datasetId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    columnIndex: Number(row.column_index),
    sourceName: row.source_name,
    fieldName: row.field_name,
    dataType: row.data_type,
    fieldRole: row.field_role,
    included: row.included === 1,
  }));
}

export interface ColumnInput {
  columnIndex: number;
  sourceName: string;
  fieldName: string;
  dataType: DatasetColumnDto['dataType'];
  fieldRole: DatasetColumnDto['fieldRole'];
  included: boolean;
}

/**
 * Thay toàn bộ cột của một dataset.
 *
 * Xoá hết rồi chèn lại thay vì so sánh từng dòng: cột được chốt đúng MỘT lần ở
 * bước 3 của wizard, nên "cập nhật một phần" là tình huống không tồn tại. PHẢI
 * gọi trong transaction cùng với việc nạp dòng — giữa DELETE và INSERT, dataset
 * không có cột nào.
 */
export async function replaceColumns(
  db: Db,
  datasetId: number,
  columns: readonly ColumnInput[],
): Promise<void> {
  await db.query('DELETE FROM dataset_columns WHERE dataset_id = ?', [datasetId]);
  if (columns.length === 0) return;

  await db.query(
    `INSERT INTO dataset_columns
       (dataset_id, column_index, source_name, field_name, data_type, field_role, included)
     VALUES ?`,
    [
      columns.map((c) => [
        datasetId,
        c.columnIndex,
        c.sourceName,
        c.fieldName,
        c.dataType,
        c.fieldRole,
        c.included ? 1 : 0,
      ]),
    ],
  );
}

// ─── Dòng dữ liệu ────────────────────────────────────────────────────────────

/**
 * Số dòng chèn trong một câu INSERT.
 *
 * Chèn từng dòng cho 50.000 dòng là 50.000 vòng đi về database. Chèn tất cả
 * trong một câu thì vượt `max_allowed_packet` (mặc định 64MB) và MySQL đóng
 * connection với một lỗi không nói được nguyên nhân. 500 là mức mà cả hai vấn đề
 * đều không xảy ra.
 */
const INSERT_CHUNK = 500;

export async function replaceRows(
  db: Db,
  datasetId: number,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  await db.query('DELETE FROM dataset_rows WHERE dataset_id = ?', [datasetId]);

  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK);
    await db.query('INSERT INTO dataset_rows (dataset_id, row_index, data) VALUES ?', [
      chunk.map((row, i) => [datasetId, offset + i, JSON.stringify(row)]),
    ]);
  }
}

/**
 * Đọc toàn bộ dòng của một bộ dữ liệu.
 *
 * ⚠️ THỨ TỰ KHOÁ trong mỗi document KHÔNG phải thứ tự cột trong file. MySQL lưu
 * JSON ở dạng nhị phân đã phân tích sẵn và sắp lại khoá theo ĐỘ DÀI trước, rồi
 * mới tới thứ tự byte — `Khu vuc` (7 ký tự) nằm trước `San pham` (8).
 *
 * Nơi nào cần đúng thứ tự cột thì đọc `dataset_columns` theo `column_index`.
 * Dựa vào `Object.keys()` của kết quả hàm này là sai, và sai một cách im lặng.
 */
export async function readRows(
  db: Db,
  datasetId: number,
): Promise<Record<string, unknown>[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT data FROM dataset_rows WHERE dataset_id = ? ORDER BY row_index ASC',
    [datasetId],
  );
  // mysql2 tự parse cột JSON thành object. Vẫn phòng trường hợp driver trả chuỗi
  // (tuỳ phiên bản và tuỳ cấu hình `jsonStrings`) để không hỏng ở một nơi khác.
  return rows.map((row) => {
    const data = row['data'];
    return (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  });
}
