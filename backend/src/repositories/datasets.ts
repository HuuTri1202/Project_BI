import type {
  ConnectionKind,
  DatasetColumnDto,
  DatasetDto,
  DatasetLoadStatus,
  DatasetSource,
  DatasetStatus,
  FieldRole,
  FileExt,
  SemanticType,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Kho dữ liệu — MỘT khái niệm dataset, HAI nguồn.
 *
 *   source = 'connection'  một bảng đồng bộ từ CSDL khách hàng (§8.5). Nền tảng
 *                          KHÔNG giữ dòng nào; mỗi lần xem là một câu SELECT
 *                          chạy trên CSDL nguồn.
 *   source = 'file'        một sheet trong file Excel/CSV đã tải lên (§7). Dòng
 *                          được nạp vào `dataset_rows`.
 *
 * Cùng quy ước với `connections.ts`: executor trước, `tenantId` ngay sau, mọi
 * câu lệnh lọc theo nó.
 *
 * ─── Hai chỗ dễ sai khi đọc file này ────────────────────────────────────────
 *
 * 1. JOIN tới `connections` phải là LEFT. Dataset nguồn `file` không có kết nối
 *    nào, nên INNER JOIN sẽ lặng lẽ loại chúng khỏi MỌI danh sách và mọi phép
 *    đếm — không lỗi, chỉ là dữ liệu biến mất.
 *
 * 2. Cột của nguồn kia luôn NULL. Đọc `sourceTable` của một dataset nguồn `file`
 *    là đọc `null`; kiểm `source` trước.
 */

interface DatasetRow extends RowDataPacket {
  id: number;
  source: DatasetSource;
  /** `NOT NULL` từ migration 11 — mọi bộ dữ liệu đều thuộc một workspace. */
  workspace_id: number;
  name: string;
  column_count: number;
  // nguồn `connection`
  source_schema: string | null;
  source_table: string | null;
  synced_at: Date | null;
  connection_id: number | null;
  connection_name: string | null;
  connection_kind: ConnectionKind | null;
  // nguồn `file`
  original_filename: string | null;
  file_ext: FileExt | null;
  file_size_bytes: number;
  sheet_name: string | null;
  status: DatasetStatus;
  error_message: string | null;
  row_count: number;
  truncated: number;
  // §9 — kho phân tích
  load_status: DatasetLoadStatus;
  loaded_row_count: number;
  loaded_at: Date | null;
  datamodel_count: number | null;
  datamodel_id: number | null;
}

const SELECT_LIST = `
  SELECT d.id, d.source, d.workspace_id, d.name, d.column_count,
         d.source_schema, d.source_table, d.synced_at, d.connection_id,
         c.name AS connection_name, c.kind AS connection_kind,
         d.original_filename, d.file_ext, d.file_size_bytes, d.sheet_name,
         d.status, d.error_message, d.row_count, d.truncated,
         d.load_status, d.loaded_row_count, d.loaded_at,
         (SELECT COUNT(*) FROM datamodel_datasets x
            JOIN datamodels m ON m.id = x.datamodel_id AND m.deleted_at IS NULL
           WHERE x.dataset_id = d.id) AS datamodel_count,
         -- Mô hình CŨ NHẤT: thường chính là cái §10 tự tạo ngay sau khi nạp
         -- xong, nên bấm vào bộ dữ liệu là về đúng mô hình của riêng nó thay vì
         -- rơi vào một mô hình nhiều bảng người dùng dựng sau đó.
         (SELECT MIN(x.datamodel_id) FROM datamodel_datasets x
            JOIN datamodels m ON m.id = x.datamodel_id AND m.deleted_at IS NULL
           WHERE x.dataset_id = d.id) AS datamodel_id
    FROM datasets d
    LEFT JOIN connections c ON c.id = d.connection_id AND c.tenant_id = d.tenant_id`;

function toDto(row: DatasetRow): DatasetDto {
  return {
    id: Number(row.id),
    source: row.source,
    workspaceId: Number(row.workspace_id),
    name: row.name,
    columnCount: Number(row.column_count),

    sourceSchema: row.source_schema,
    sourceTable: row.source_table,
    syncedAt: row.synced_at?.toISOString() ?? null,
    connectionId: row.connection_id === null ? null : Number(row.connection_id),
    connectionName: row.connection_name,
    connectionKind: row.connection_kind,

    originalFilename: row.original_filename,
    fileExt: row.file_ext,
    fileSizeBytes: Number(row.file_size_bytes),
    sheetName: row.sheet_name,
    status: row.status,
    errorMessage: row.error_message,
    rowCount: Number(row.row_count),
    truncated: row.truncated === 1,

    datamodelCount: Number(row.datamodel_count ?? 0),
    datamodelId: row.datamodel_id === null || row.datamodel_id === undefined
      ? null
      : Number(row.datamodel_id),

    loadStatus: row.load_status,
    loadedRowCount: Number(row.loaded_row_count),
    loadedAt: row.loaded_at?.toISOString() ?? null,
  };
}

export type DatasetSortKey =
  | 'name'
  | 'sourceTable'
  | 'columnCount'
  | 'syncedAt'
  | 'rowCount'
  | 'createdAt';

export const DATASET_SORT_KEYS: readonly DatasetSortKey[] = [
  'name',
  'sourceTable',
  'columnCount',
  'syncedAt',
  'rowCount',
  'createdAt',
];

const SORT_SQL: Record<DatasetSortKey, string> = {
  name: 'd.name',
  sourceTable: 'd.source_table',
  columnCount: 'd.column_count',
  syncedAt: 'd.synced_at',
  rowCount: 'd.row_count',
  createdAt: 'd.created_at',
};

export interface DatasetFilter {
  search?: string | undefined;
  connectionId?: number | undefined;
  /** Lọc theo workspace đang mở. Bỏ trống = cả tổ chức. */
  workspaceId?: number | undefined;
  source?: DatasetSource | undefined;
  status?: DatasetStatus | undefined;
  /**
   * Trạng thái NẠP VÀO KHO (§9) — khác hẳn `status` ngay trên.
   *
   * Bộ chọn bộ dữ liệu của §10.2 lọc `loaded`: bộ chưa nạp thì chưa có bảng nào
   * trong ClickHouse, nên không có cấu trúc nào để dựng mô hình lên.
   */
  loadStatus?: DatasetLoadStatus | undefined;
  sort: DatasetSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function where(tenantId: number, filter: DatasetFilter): { sql: string; params: unknown[] } {
  const conditions = ['d.tenant_id = ?', 'd.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  // Kết nối bị xoá mềm thì dataset của nó cũng khuất. Với nguồn `file` thì
  // `c.deleted_at` là NULL do LEFT JOIN không khớp dòng nào — nên điều kiện này
  // đúng cho cả hai mà không cần rẽ nhánh.
  conditions.push('c.deleted_at IS NULL');

  if (filter.connectionId !== undefined) {
    conditions.push('d.connection_id = ?');
    params.push(filter.connectionId);
  }
  if (filter.workspaceId !== undefined) {
    conditions.push('d.workspace_id = ?');
    params.push(filter.workspaceId);
  }
  if (filter.source !== undefined) {
    conditions.push('d.source = ?');
    params.push(filter.source);
  }
  if (filter.loadStatus !== undefined) {
    conditions.push('d.load_status = ?');
    params.push(filter.loadStatus);
  }

  // Mặc định CHỈ lấy `ready`. Bản ghi `pending` là rác của những lần đóng wizard
  // giữa chừng và không có gì để xem; `failed` hiện khi người dùng chủ động lọc,
  // để họ biết vì sao file mình tải lên không dùng được.
  if (filter.status !== undefined) {
    conditions.push('d.status = ?');
    params.push(filter.status);
  } else {
    conditions.push("d.status = 'ready'");
  }

  if (filter.search) {
    // Escape thủ công `%` và `_`: người dùng gõ "doanh_thu" mà không escape thì
    // `_` thành ký tự đại diện và kết quả trả về cả "doanhXthu".
    const like = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      `(d.name LIKE ? ESCAPE '\\\\' OR d.source_table LIKE ? ESCAPE '\\\\'` +
        ` OR d.original_filename LIKE ? ESCAPE '\\\\')`,
    );
    params.push(like, like, like);
  }
  return { sql: conditions.join(' AND '), params };
}

export async function count(db: Db, tenantId: number, filter: DatasetFilter): Promise<number> {
  const w = where(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM datasets d
       LEFT JOIN connections c ON c.id = d.connection_id AND c.tenant_id = d.tenant_id
      WHERE ${w.sql}`,
    w.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function list(db: Db, tenantId: number, filter: DatasetFilter): Promise<DatasetDto[]> {
  const w = where(tenantId, filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';

  const [rows] = await db.query<DatasetRow[]>(
    // `, d.id ASC` là tiêu chí phá hoà: thiếu nó, các dòng trùng giá trị sắp xếp
    // đảo chỗ giữa hai lần truy vấn và một bản ghi hiện hai lần ở hai trang.
    //
    // `SORT_SQL[...]` chứ không nội suy trực tiếp giá trị từ client: ORDER BY
    // không tham số hoá được, nên whitelist là lớp phòng thủ duy nhất.
    `${SELECT_LIST}
      WHERE ${w.sql}
      ORDER BY ${SORT_SQL[filter.sort]} ${direction}, d.id ASC
      LIMIT ? OFFSET ?`,
    [...w.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toDto);
}

/**
 * Tìm theo id, KHÔNG lọc `status`.
 *
 * Khác `list`: wizard phải đọc được bản ghi `pending` của chính nó giữa hai
 * bước, và trang chi tiết phải hiện được bản ghi `failed` kèm lý do.
 */
export async function findOne(db: Db, tenantId: number, id: number): Promise<DatasetDto | null> {
  const [rows] = await db.query<DatasetRow[]>(
    `${SELECT_LIST} WHERE d.tenant_id = ? AND d.id = ? AND d.deleted_at IS NULL LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

export async function listColumns(db: Db, datasetId: number): Promise<DatasetColumnDto[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT name, data_type, is_nullable, ordinal, field_name, semantic_type, field_role, included
       FROM dataset_columns WHERE dataset_id = ? ORDER BY ordinal ASC`,
    [datasetId],
  );
  return rows.map((r) => ({
    name: String(r['name']),
    dataType: String(r['data_type']),
    isNullable: Number(r['is_nullable']) === 1,
    ordinal: Number(r['ordinal']),
    fieldName: r['field_name'] === null ? null : String(r['field_name']),
    semanticType: (r['semantic_type'] as SemanticType | null) ?? null,
    fieldRole: (r['field_role'] as FieldRole | null) ?? null,
    included: Number(r['included']) === 1,
  }));
}

/** Cặp (schema, table) đã có trong kho — nuôi ô tích sẵn của hộp thoại đồng bộ. */
export async function listImportedTables(
  db: Db,
  tenantId: number,
  connectionId: number,
): Promise<{ schema: string; table: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT source_schema, source_table FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND deleted_at IS NULL`,
    [tenantId, connectionId],
  );
  return rows.map((r) => ({
    schema: String(r['source_schema']),
    table: String(r['source_table']),
  }));
}

/**
 * Tạo hoặc hồi sinh một dataset cho một bảng nguồn (nguồn `connection`).
 *
 * `ON DUPLICATE KEY UPDATE` dựa vào `uq_datasets_source` — chính là thứ biến
 * "đồng bộ lần hai" thành cập nhật thay vì nhân đôi kho dữ liệu.
 *
 * Nhánh UPDATE cố ý KHÔNG ghi đè `name`: người dùng có thể đã đổi tên hiển thị
 * ở mục 8.9, và một lần đồng bộ định kỳ không được xoá công sức đó. Nhưng nó CÓ
 * đặt `deleted_at = NULL` — đồng bộ lại một bảng từng bị xoá là cách hồi sinh
 * nó, và giữ nguyên id thì mọi thứ trỏ tới dataset đó vẫn còn nguyên.
 *
 * Trả về `{ id, isNew }`: `affectedRows` của MySQL là 1 khi INSERT và 2 khi
 * UPDATE có thay đổi — nhưng là 0 khi UPDATE mà không đổi giá trị nào, nên
 * không dùng nó để phân biệt được. Đọc lại bằng SELECT là cách duy nhất chắc.
 */
export async function upsert(
  db: Db,
  tenantId: number,
  input: {
    connectionId: number;
    sourceSchema: string;
    sourceTable: string;
    name: string;
    columnCount: number;
    /**
     * Workspace nhận bảng này — BẮT BUỘC từ migration 11.
     *
     * Trước đó chỗ này nhận `null` và `syncDatasets` luôn truyền `null`, nên
     * bảng đồng bộ từ kết nối hiện ở MỌI workspace của tổ chức.
     */
    workspaceId: number;
  },
): Promise<{ id: number; isNew: boolean }> {
  const [existing] = await db.query<RowDataPacket[]>(
    // Điều kiện phải TRÙNG KHỚP `uq_datasets_source` (migration 11 đã đưa
    // `workspace_id` vào khoá đó). Thiếu một cột của khoá thì hàm này tìm thấy
    // dòng của workspace khác và trả về id sai — mọi thứ sau đó ghi nhầm chỗ.
    `SELECT id FROM datasets
      WHERE tenant_id = ? AND workspace_id = ? AND connection_id = ?
        AND source_schema = ? AND source_table = ?
      LIMIT 1`,
    [tenantId, input.workspaceId, input.connectionId, input.sourceSchema, input.sourceTable],
  );
  const found = existing[0];

  await db.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, connection_id, source_schema, source_table,
        name, column_count, synced_at, status)
     VALUES (?, 'connection', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), 'ready')
     ON DUPLICATE KEY UPDATE
       column_count = VALUES(column_count),
       workspace_id = VALUES(workspace_id),
       synced_at    = CURRENT_TIMESTAMP(3),
       deleted_at   = NULL`,
    [
      tenantId,
      input.workspaceId,
      input.connectionId,
      input.sourceSchema,
      input.sourceTable,
      input.name,
      input.columnCount,
    ],
  );

  if (found) return { id: Number(found['id']), isNew: false };

  const [rows] = await db.query<RowDataPacket[]>(
    // Điều kiện phải TRÙNG KHỚP `uq_datasets_source` (migration 11 đã đưa
    // `workspace_id` vào khoá đó). Thiếu một cột của khoá thì hàm này tìm thấy
    // dòng của workspace khác và trả về id sai — mọi thứ sau đó ghi nhầm chỗ.
    `SELECT id FROM datasets
      WHERE tenant_id = ? AND workspace_id = ? AND connection_id = ?
        AND source_schema = ? AND source_table = ?
      LIMIT 1`,
    [tenantId, input.workspaceId, input.connectionId, input.sourceSchema, input.sourceTable],
  );
  const row = rows[0];
  if (!row) throw new Error('Vừa tạo dataset xong nhưng đọc lại không thấy');
  return { id: Number(row['id']), isNew: true };
}

/**
 * Thay toàn bộ danh sách cột của một dataset.
 *
 * Xoá sạch rồi chèn lại, KHÔNG so từng cột để tìm khác biệt. Bảng nguồn đổi
 * schema thì cột có thể bị đổi tên, đổi thứ tự, đổi kiểu và biến mất cùng lúc —
 * viết thuật toán khớp cho ngần ấy trường hợp là công sức cho một thứ chạy vài
 * lần một ngày trên vài chục dòng.
 *
 * An toàn vì `dataset_columns` chỉ là ẢNH CHỤP schema nguồn, không ai trỏ vào id
 * của nó. Đến Section 09 khi mô hình dữ liệu tham chiếu tới cột thì cách này
 * phải đổi — ghi lại ở đây để lúc đó không ai xoá nhầm.
 *
 * PHẢI gọi trong transaction cùng việc nạp dòng: giữa DELETE và INSERT, dataset
 * không có cột nào.
 */
export interface ColumnInput {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinal: number;
  /* Tầng ngữ nghĩa — chỉ nguồn `file` điền, nguồn `connection` để trống. */
  fieldName?: string | null;
  semanticType?: SemanticType | null;
  fieldRole?: FieldRole | null;
  included?: boolean;
}

export async function replaceColumns(
  db: Db,
  datasetId: number,
  columns: ColumnInput[],
): Promise<void> {
  await db.query<ResultSetHeader>('DELETE FROM dataset_columns WHERE dataset_id = ?', [datasetId]);
  if (columns.length === 0) return;

  await db.query<ResultSetHeader>(
    `INSERT INTO dataset_columns
       (dataset_id, name, data_type, is_nullable, ordinal,
        field_name, semantic_type, field_role, included)
     VALUES ?`,
    [
      columns.map((c) => [
        datasetId,
        c.name,
        c.dataType,
        c.isNullable ? 1 : 0,
        c.ordinal,
        c.fieldName ?? null,
        c.semanticType ?? null,
        c.fieldRole ?? null,
        c.included === false ? 0 : 1,
      ]),
    ],
  );
}

export async function rename(
  db: Db,
  tenantId: number,
  id: number,
  name: string,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datasets SET name = ? WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [name, tenantId, id],
  );
  return result.affectedRows;
}

export async function softDelete(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datasets SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}

// ─── Nguồn `file` (§7) ───────────────────────────────────────────────────────

export interface CreateFileDatasetInput {
  workspaceId: number;
  name: string;
  originalFilename: string;
  fileExt: FileExt;
  s3Key: string;
  createdBy: number;
}

/** Bản ghi `pending` sinh ra lúc xin presigned URL, trước khi file lên tới nơi. */
export async function createFileDataset(
  db: Db,
  tenantId: number,
  input: CreateFileDatasetInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, name, original_filename, file_ext, s3_key,
        status, created_by)
     VALUES (?, 'file', ?, ?, ?, ?, ?, 'pending', ?)`,
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

/**
 * Khoá lưu trữ của một dataset nguồn `file`.
 *
 * Tách riêng khỏi `findOne` vì `s3_key` không thuộc về DTO — nó là chi tiết hạ
 * tầng mà không màn hình nào cần.
 *
 * Nói cho đúng: đây KHÔNG phải một biện pháp bảo mật. Presigned URL bắt buộc
 * chứa khoá trong đường dẫn, nên client đã biết khoá của chính mình từ bước xin
 * URL. Thứ thật sự bảo vệ là khoá do server sinh với một UUID ngẫu nhiên và mang
 * tiền tố tổ chức của người gọi.
 */
export async function findStorageKey(
  db: Db,
  tenantId: number,
  id: number,
): Promise<{ key: string; ext: FileExt } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT s3_key, file_ext FROM datasets
      WHERE tenant_id = ? AND id = ? AND source = 'file' AND deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  if (!row || row['s3_key'] === null) return null;
  return { key: String(row['s3_key']), ext: row['file_ext'] as FileExt };
}

/**
 * Ai tạo ra bộ dữ liệu này.
 *
 * KHÔNG nằm trong `DatasetDto`: không màn hình nào hiện nó, và một trường chỉ
 * để phục vụ một tác vụ nền thì không đáng đi ra tận API. `null` khi người tạo
 * đã bị xoá khỏi hệ thống — `created_by` là `ON DELETE SET NULL`.
 */
export async function findCreatorId(
  db: Db,
  tenantId: number,
  id: number,
): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT created_by FROM datasets WHERE tenant_id = ? AND id = ? LIMIT 1',
    [tenantId, id],
  );
  const value = rows[0]?.['created_by'];
  return value === null || value === undefined ? null : Number(value);
}

export async function markReady(
  db: Db,
  datasetId: number,
  input: {
    name: string;
    sheetName: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    fileSize: number;
  },
): Promise<void> {
  await db.query(
    `UPDATE datasets
        SET status = 'ready', name = ?, sheet_name = ?, row_count = ?, column_count = ?,
            truncated = ?, file_size_bytes = ?, synced_at = CURRENT_TIMESTAMP(3),
            error_message = NULL
      WHERE id = ?`,
    [
      input.name,
      input.sheetName,
      input.rowCount,
      input.columnCount,
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
 * vết nào của việc vừa xảy ra.
 */
export async function markFailed(db: Db, datasetId: number, reason: string): Promise<void> {
  await db.query(`UPDATE datasets SET status = 'failed', error_message = ? WHERE id = ?`, [
    reason.slice(0, 500),
    datasetId,
  ]);
}

/** Báo cáo còn sống đang dựng trên bộ dữ liệu này. */
export async function countLiveReports(db: Db, datasetId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM reports WHERE dataset_id = ? AND deleted_at IS NULL',
    [datasetId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

// ─── Dòng dữ liệu (chỉ nguồn `file`) ─────────────────────────────────────────

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
 * Đọc toàn bộ dòng của một bộ dữ liệu nguồn `file`.
 *
 * ⚠️ THỨ TỰ KHOÁ trong mỗi document KHÔNG phải thứ tự cột trong file. MySQL lưu
 * JSON ở dạng nhị phân đã phân tích sẵn và sắp lại khoá theo ĐỘ DÀI trước, rồi
 * mới tới thứ tự byte — `Khu vuc` (7 ký tự) nằm trước `San pham` (8).
 *
 * Nơi nào cần đúng thứ tự cột thì đọc `dataset_columns` theo `ordinal`. Dựa vào
 * `Object.keys()` của kết quả hàm này là sai, và sai một cách im lặng.
 */
export async function readRows(
  db: Db,
  datasetId: number,
  /** Bỏ trống = đọc hết. Bảng xem trước truyền vào để không kéo 50.000 dòng. */
  limit?: number,
): Promise<Record<string, unknown>[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT data FROM dataset_rows WHERE dataset_id = ? ORDER BY row_index ASC${
      limit === undefined ? '' : ' LIMIT ?'
    }`,
    limit === undefined ? [datasetId] : [datasetId, limit],
  );
  // mysql2 tự parse cột JSON thành object. Vẫn phòng trường hợp driver trả chuỗi
  // (tuỳ phiên bản và tuỳ cấu hình `jsonStrings`) để không hỏng ở một nơi khác.
  return rows.map((row) => {
    const data = row['data'];
    return (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  });
}

/**
 * Đọc dòng theo LÔ để nạp vào kho phân tích (§9.5).
 *
 * ─── Vì sao quét theo khoá chứ không `OFFSET` ───────────────────────────────
 *
 * `(dataset_id, row_index)` là khoá chính GHÉP, và với InnoDB khoá chính cũng
 * chính là khoá gom cụm — dữ liệu nằm SẴN theo thứ tự đó trên đĩa. Nên mỗi lô là
 * một lần định vị B-tree rồi đọc tuần tự.
 *
 * `OFFSET` thì quét lại từ đầu ở mỗi lô: nạp 50.000 dòng theo lô 5.000 sẽ đọc
 * tổng cộng khoảng 275.000 dòng thay vì 50.000. Cùng lý do đã ghi ở
 * `Driver.readAllRows`, chỉ khác là ở đây ta CÓ khoá để quét nên không cần tới
 * stream.
 *
 * Không giữ transaction, và không cần: `dataset_rows` là bất biến sau khi
 * `commit.ts` ghi xong. Giữ một transaction suốt cả lần nạp là chiếm một trong
 * mười connection của pool trong nhiều phút.
 *
 * Trả kèm `rowIndex` vì §9.8 cần nói được "dòng nào" — và với nguồn `file` thì
 * con số đó khớp đúng số dòng người dùng thấy trong Excel (trừ hàng tiêu đề).
 */
export async function readRowsAfter(
  db: Db,
  datasetId: number,
  afterRowIndex: number,
  limit: number,
): Promise<{ rowIndex: number; data: Record<string, unknown> }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT row_index, data FROM dataset_rows
      WHERE dataset_id = ? AND row_index > ?
      ORDER BY row_index ASC LIMIT ?`,
    [datasetId, afterRowIndex, limit],
  );
  return rows.map((row) => {
    const data = row['data'];
    return {
      rowIndex: Number(row['row_index']),
      data: (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>,
    };
  });
}

// ─── Trạng thái nạp vào kho phân tích (§9) ───────────────────────────────────

/**
 * Thông tin tối thiểu để chạy một lần nạp.
 *
 * Tách khỏi `DatasetDto` vì đây là thứ chỉ tầng nạp cần: `sourceSchema`/
 * `sourceTable` cho nguồn `connection`, `connectionId` để lấy bí mật. DTO thì đi
 * ra giao diện và không nên mang theo những trường này dưới dạng bắt buộc.
 */
export async function markLoadStatus(
  db: Db,
  datasetId: number,
  status: 'idle' | 'queued' | 'running' | 'loaded' | 'failed',
  loaded?: { chTable: string; rowCount: number },
): Promise<void> {
  if (loaded) {
    await db.query<ResultSetHeader>(
      `UPDATE datasets
          SET load_status = ?, ch_table = ?, loaded_row_count = ?,
              loaded_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [status, loaded.chTable, loaded.rowCount, datasetId],
    );
    return;
  }
  await db.query<ResultSetHeader>('UPDATE datasets SET load_status = ? WHERE id = ?', [
    status,
    datasetId,
  ]);
}


/**
 * Mọi id bộ dữ liệu MySQL còn biết tới — nguồn sự thật của janitor §9.
 *
 * Bao gồm CẢ bộ đã xoá mềm và bộ thuộc kết nối đã xoá. Đó là thay đổi so với
 * bản trước (`listLiveIds`, chỉ đếm bộ người dùng còn thấy), và nó theo sau việc
 * xoá dataset thôi không drop bảng trong kho nữa:
 *
 *   - Xoá mềm giờ giữ nguyên bảng `raw_*` để khôi phục là gỡ một cột `deleted_at`
 *     ra là xong. Nếu janitor vẫn coi bộ đã xoá mềm là "chết", nó sẽ drop đúng
 *     cái bảng ấy sau một giờ — và việc xoá mềm lại thành không hoàn tác được,
 *     chỉ chậm hơn một tiếng.
 *   - Nên "mồ côi" giờ có nghĩa hẹp và đúng nghĩa đen: bảng mà MySQL KHÔNG CÒN
 *     dòng nào nhận. Thực tế chỉ xảy ra khi dòng `datasets` bị xoá cứng theo
 *     dây chuyền, ví dụ một tổ chức bị xoá cứng.
 *
 * Không lọc theo `tenant_id`: janitor là tác vụ của toàn hệ thống, không chạy
 * dưới danh nghĩa tổ chức nào. Đây là NGOẠI LỆ duy nhất của quy ước "mọi hàm
 * tenant-scoped phải nhận `tenantId` đầu tiên".
 */
export async function listKnownIds(db: Db): Promise<Set<number>> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM datasets');
  return new Set(rows.map((r) => Number(r['id'])));
}