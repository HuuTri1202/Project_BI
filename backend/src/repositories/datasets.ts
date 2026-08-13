import type { ConnectionKind, DatasetColumnDto, DatasetDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Kho dữ liệu (§8.5) — mỗi bảng nguồn là một dataset.
 *
 * Cùng quy ước với `connections.ts`: executor trước, `tenantId` ngay sau, mọi
 * câu lệnh lọc theo nó.
 */

interface DatasetRow extends RowDataPacket {
  id: number;
  name: string;
  source_schema: string;
  source_table: string;
  column_count: number;
  synced_at: Date | null;
  connection_id: number;
  connection_name: string;
  connection_kind: ConnectionKind;
}

const SELECT_LIST = `
  SELECT d.id, d.name, d.source_schema, d.source_table, d.column_count, d.synced_at,
         d.connection_id, c.name AS connection_name, c.kind AS connection_kind
    FROM datasets d
    JOIN connections c ON c.id = d.connection_id AND c.tenant_id = d.tenant_id`;

function toDto(row: DatasetRow): DatasetDto {
  return {
    id: Number(row.id),
    name: row.name,
    sourceSchema: row.source_schema,
    sourceTable: row.source_table,
    columnCount: Number(row.column_count),
    syncedAt: row.synced_at?.toISOString() ?? null,
    connectionId: Number(row.connection_id),
    connectionName: row.connection_name,
    connectionKind: row.connection_kind,
    // Luôn 0 cho tới Section 09 — chưa có bảng `datamodels` để đếm. Xem ghi chú
    // trong `DatasetDto`.
    datamodelCount: 0,
  };
}

export type DatasetSortKey = 'name' | 'sourceTable' | 'columnCount' | 'syncedAt';
export const DATASET_SORT_KEYS: readonly DatasetSortKey[] = [
  'name',
  'sourceTable',
  'columnCount',
  'syncedAt',
];

const SORT_SQL: Record<DatasetSortKey, string> = {
  name: 'd.name',
  sourceTable: 'd.source_table',
  columnCount: 'd.column_count',
  syncedAt: 'd.synced_at',
};

export interface DatasetFilter {
  search?: string | undefined;
  connectionId?: number | undefined;
  sort: DatasetSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function where(tenantId: number, filter: DatasetFilter): { sql: string; params: unknown[] } {
  const conditions = ['d.tenant_id = ?', 'd.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (filter.connectionId !== undefined) {
    conditions.push('d.connection_id = ?');
    params.push(filter.connectionId);
  }
  if (filter.search) {
    // Escape thủ công `%` và `_`: người dùng gõ "doanh_thu" mà không escape thì
    // `_` thành ký tự đại diện và kết quả trả về cả "doanhXthu".
    const like = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(`(d.name LIKE ? ESCAPE '\\\\' OR d.source_table LIKE ? ESCAPE '\\\\')`);
    params.push(like, like);
  }
  return { sql: conditions.join(' AND '), params };
}

export async function count(db: Db, tenantId: number, filter: DatasetFilter): Promise<number> {
  const w = where(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM datasets d
       JOIN connections c ON c.id = d.connection_id AND c.tenant_id = d.tenant_id
      WHERE ${w.sql}`,
    w.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function list(
  db: Db,
  tenantId: number,
  filter: DatasetFilter,
): Promise<DatasetDto[]> {
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
    `SELECT name, data_type, is_nullable, ordinal
       FROM dataset_columns WHERE dataset_id = ? ORDER BY ordinal ASC`,
    [datasetId],
  );
  return rows.map((r) => ({
    name: String(r['name']),
    dataType: String(r['data_type']),
    isNullable: Number(r['is_nullable']) === 1,
    ordinal: Number(r['ordinal']),
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
 * Tạo hoặc hồi sinh một dataset cho một bảng nguồn.
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
  },
): Promise<{ id: number; isNew: boolean }> {
  const [existing] = await db.query<RowDataPacket[]>(
    `SELECT id FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND source_schema = ? AND source_table = ?
      LIMIT 1`,
    [tenantId, input.connectionId, input.sourceSchema, input.sourceTable],
  );
  const found = existing[0];

  await db.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, connection_id, source_schema, source_table, name, column_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       column_count = VALUES(column_count),
       synced_at    = CURRENT_TIMESTAMP(3),
       deleted_at   = NULL`,
    [
      tenantId,
      input.connectionId,
      input.sourceSchema,
      input.sourceTable,
      input.name,
      input.columnCount,
    ],
  );

  if (found) return { id: Number(found['id']), isNew: false };

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND source_schema = ? AND source_table = ?
      LIMIT 1`,
    [tenantId, input.connectionId, input.sourceSchema, input.sourceTable],
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
 */
export async function replaceColumns(
  db: Db,
  datasetId: number,
  columns: { name: string; dataType: string; isNullable: boolean; ordinal: number }[],
): Promise<void> {
  await db.query<ResultSetHeader>('DELETE FROM dataset_columns WHERE dataset_id = ?', [datasetId]);
  if (columns.length === 0) return;

  await db.query<ResultSetHeader>(
    `INSERT INTO dataset_columns (dataset_id, name, data_type, is_nullable, ordinal) VALUES ?`,
    [columns.map((c) => [datasetId, c.name, c.dataType, c.isNullable ? 1 : 0, c.ordinal])],
  );
}

export async function rename(
  db: Db,
  tenantId: number,
  id: number,
  name: string,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'UPDATE datasets SET name = ? WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL',
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
