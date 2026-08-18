import type {
  CalcAgg,
  ColumnRole,
  DataModelDto,
  DataModelMeasureDto,
  DataModelRelationshipDto,
  MeasureAgg,
  RelationshipKind,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Tầng ngữ nghĩa — §10.
 *
 * MỘT file cho cả năm bảng, khác với §8 vốn tách `connections.ts` và
 * `datasets.ts`. Lý do: năm bảng này là MỘT khối — không có thao tác nào chạm
 * vào `datamodel_columns` mà không đi qua một mô hình, và không màn hình nào
 * hiện một quan hệ tách khỏi mô hình chứa nó. Tách ra thành năm file nghĩa là
 * năm chỗ chép lại cùng một câu `WHERE tenant_id = ?` và một cây import vòng
 * quanh, mà không màn hình nào được lợi.
 *
 * Cùng khuôn tenant-scoped với phần còn lại của repo: `db` là tham số đầu tiên
 * và KHÔNG có giá trị mặc định (mặc định `mysqlPool` sẽ âm thầm cho câu lệnh
 * thoát khỏi transaction), `tenantId` ngay sau đó, và mọi câu đều lọc theo nó.
 */

// ─── Mô hình ─────────────────────────────────────────────────────────────────

interface ModelRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  name: string;
  description: string | null;
  dataset_count: number;
  measure_count: number;
  relationship_count: number;
  report_count: number;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Ba phép đếm bằng truy vấn con chứ không bằng ba câu LEFT JOIN.
 *
 * JOIN cả ba bảng con vào một câu sẽ nhân bản dòng: một mô hình có 3 bộ dữ liệu
 * và 4 thước đo cho ra 12 dòng, và `COUNT(*)` trên đó ra số vô nghĩa. Sửa bằng
 * `COUNT(DISTINCT ...)` được, nhưng truy vấn con đọc rõ hơn hẳn và mỗi cái là
 * một lần dò chỉ mục.
 */
const MODEL_SELECT = `SELECT dm.id, dm.workspace_id, dm.name, dm.description,
         (SELECT COUNT(*) FROM datamodel_datasets x
           WHERE x.datamodel_id = dm.id) AS dataset_count,
         (SELECT COUNT(*) FROM datamodel_measures x
           WHERE x.datamodel_id = dm.id AND x.deleted_at IS NULL) AS measure_count,
         (SELECT COUNT(*) FROM datamodel_relationships x
           WHERE x.datamodel_id = dm.id AND x.deleted_at IS NULL) AS relationship_count,
         (SELECT COUNT(*) FROM reports r
            JOIN datamodel_datasets x ON x.dataset_id = r.dataset_id
           WHERE x.datamodel_id = dm.id AND r.deleted_at IS NULL) AS report_count,
         u.full_name AS creator_name, dm.created_at, dm.updated_at
    FROM datamodels dm
    LEFT JOIN users u ON u.id = dm.created_by`;

function toModelDto(row: ModelRow): DataModelDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: row.name,
    description: row.description,
    datasetCount: Number(row.dataset_count),
    measureCount: Number(row.measure_count),
    relationshipCount: Number(row.relationship_count),
    reportCount: Number(row.report_count),
    creatorName: row.creator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type DataModelSortKey = 'name' | 'datasetCount' | 'createdAt' | 'updatedAt';

export const DATAMODEL_SORT_KEYS: readonly DataModelSortKey[] = [
  'name',
  'datasetCount',
  'createdAt',
  'updatedAt',
];

const SORT_SQL: Record<DataModelSortKey, string> = {
  name: 'dm.name',
  datasetCount: 'dataset_count',
  createdAt: 'dm.created_at',
  updatedAt: 'dm.updated_at',
};

export interface DataModelFilter {
  workspaceId: number;
  search?: string | undefined;
  sort: DataModelSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** Dùng chung bởi `count` và `list` để hai bên không thể lệch nhau. */
function where(tenantId: number, filter: DataModelFilter): { sql: string; params: unknown[] } {
  const parts = ['dm.tenant_id = ?', 'dm.workspace_id = ?', 'dm.deleted_at IS NULL'];
  const params: unknown[] = [tenantId, filter.workspaceId];

  if (filter.search !== undefined && filter.search !== '') {
    parts.push("(dm.name LIKE ? ESCAPE '\\\\' OR dm.description LIKE ? ESCAPE '\\\\')");
    const term = `%${escapeLikeTerm(filter.search)}%`;
    params.push(term, term);
  }

  return { sql: parts.join(' AND '), params };
}

export async function count(db: Db, tenantId: number, filter: DataModelFilter): Promise<number> {
  const w = where(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM datamodels dm WHERE ${w.sql}`,
    w.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function list(
  db: Db,
  tenantId: number,
  filter: DataModelFilter,
): Promise<DataModelDto[]> {
  const w = where(tenantId, filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await db.query<ModelRow[]>(
    `${MODEL_SELECT} WHERE ${w.sql}
      ORDER BY ${SORT_SQL[filter.sort]} ${direction}, dm.id ASC
      LIMIT ? OFFSET ?`,
    [...w.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toModelDto);
}

export async function findOne(db: Db, tenantId: number, id: number): Promise<DataModelDto | null> {
  const [rows] = await db.query<ModelRow[]>(
    `${MODEL_SELECT} WHERE dm.tenant_id = ? AND dm.id = ? AND dm.deleted_at IS NULL LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toModelDto(row) : null;
}

export async function create(
  db: Db,
  tenantId: number,
  input: {
    workspaceId: number;
    name: string;
    description: string | null;
    createdBy: number | null;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodels (tenant_id, workspace_id, name, description, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, input.workspaceId, input.name, input.description, input.createdBy],
  );
  return result.insertId;
}

export async function update(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; description: string | null },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodels SET name = ?, description = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.description, tenantId, id],
  );
  return result.affectedRows;
}

export async function softDelete(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodels SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Đánh dấu mô hình vừa đổi — PHẢI gọi từ MỌI thao tác ghi lên bảng con.
 *
 * `updated_at` ở đây không chỉ là sổ sách: nó là `schemaVersion` mà Express ký
 * vào JWT gửi cho Cube. Cube nhớ schema đã biên dịch theo cặp (tổ chức, phiên
 * bản), nên con số này đổi là lần truy vấn tiếp theo buộc phải biên dịch lại.
 *
 * ⚠️ Quên gọi nó sau một lần sửa thước đo nghĩa là Explorer trả KẾT QUẢ CŨ mà
 * không có lỗi nào ở đâu cả — kiểu hỏng tệ nhất trong cả mục này. Đó là lý do
 * nó là một hàm có tên chứ không phải một dòng SQL chép rải rác.
 *
 * Cố ý KHÔNG gọi từ thao tác lưu vị trí canvas: kéo một cái hộp không phải thay
 * đổi ngữ nghĩa, và bắt Cube biên dịch lại vì chuyện đó là phí.
 */
export async function touch(db: Db, tenantId: number, id: number): Promise<void> {
  await db.query(
    `UPDATE datamodels SET updated_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
}

/**
 * Phiên bản schema của cả một tổ chức — xem `touch`.
 *
 * Lấy theo TỔ CHỨC chứ không theo mô hình vì Cube biên dịch cả ngữ cảnh của tổ
 * chức một lần. Đổi một mô hình làm mọi mô hình của tổ chức đó biên dịch lại —
 * hơi thừa, nhưng đúng, và một con số sai theo hướng "biên dịch thừa" thì chỉ
 * chậm, còn sai theo hướng "dùng lại schema cũ" thì trả số sai.
 */
export async function schemaVersion(db: Db, tenantId: number): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(UNIX_TIMESTAMP(updated_at)), 0) AS v
       FROM datamodels WHERE tenant_id = ? AND deleted_at IS NULL`,
    [tenantId],
  );
  return String(rows[0]?.['v'] ?? 0);
}

// ─── Bộ dữ liệu trong mô hình ────────────────────────────────────────────────

export interface ModelDatasetRow extends RowDataPacket {
  id: number;
  datamodel_id: number;
  dataset_id: number;
  dataset_name: string;
  canvas_x: number;
  canvas_y: number;
}

export async function listDatasets(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<ModelDatasetRow[]> {
  const [rows] = await db.query<ModelDatasetRow[]>(
    `SELECT dmd.id, dmd.datamodel_id, dmd.dataset_id, d.name AS dataset_name,
            dmd.canvas_x, dmd.canvas_y
       FROM datamodel_datasets dmd
       JOIN datasets d ON d.id = dmd.dataset_id
      WHERE dmd.tenant_id = ? AND dmd.datamodel_id = ?
      ORDER BY dmd.id ASC`,
    [tenantId, dataModelId],
  );
  return rows;
}

export async function addDataset(
  db: Db,
  tenantId: number,
  input: { dataModelId: number; datasetId: number; canvasX: number; canvasY: number },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_datasets
       (tenant_id, datamodel_id, dataset_id, canvas_x, canvas_y)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, input.dataModelId, input.datasetId, input.canvasX, input.canvasY],
  );
  return result.insertId;
}

/** Xoá CỨNG — dòng nối, cascade kéo theo cột, thước đo và quan hệ. */
export async function removeDataset(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'DELETE FROM datamodel_datasets WHERE tenant_id = ? AND id = ?',
    [tenantId, id],
  );
  return result.affectedRows;
}

export async function saveLayout(
  db: Db,
  tenantId: number,
  positions: readonly { id: number; x: number; y: number }[],
): Promise<void> {
  for (const p of positions) {
    await db.query(
      'UPDATE datamodel_datasets SET canvas_x = ?, canvas_y = ? WHERE tenant_id = ? AND id = ?',
      [p.x, p.y, tenantId, p.id],
    );
  }
}

// ─── Cột ─────────────────────────────────────────────────────────────────────

export interface ModelColumnRow extends RowDataPacket {
  id: number;
  datamodel_dataset_id: number;
  column_name: string;
  alias: string | null;
  display_name: string | null;
  description: string | null;
  visible: number;
  role: ColumnRole;
  calc_agg: CalcAgg | null;
  source_column_id: number | null;
  ch_type: string;
  ordinal: number;
}

/**
 * Danh sách cột dùng chung cho mọi câu đọc field.
 *
 * Một hằng số thay vì chép tay: có bốn nơi đọc field, và bốn danh sách cột chép
 * tay là bốn cơ hội để một cột mới lọt ở ba nơi rồi thiếu ở nơi thứ tư.
 */
const FIELD_COLUMNS = `c.id, c.datamodel_dataset_id, c.column_name, c.alias, c.display_name,
         c.description, c.visible, c.role, c.calc_agg, c.source_column_id,
         c.ch_type, c.ordinal`;

export async function listColumns(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<ModelColumnRow[]> {
  const [rows] = await db.query<ModelColumnRow[]>(
    `SELECT ${FIELD_COLUMNS}
       FROM datamodel_columns c
       JOIN datamodel_datasets dmd ON dmd.id = c.datamodel_dataset_id
      WHERE c.tenant_id = ? AND dmd.datamodel_id = ?
      ORDER BY c.datamodel_dataset_id ASC, c.ordinal ASC, c.id ASC`,
    [tenantId, dataModelId],
  );
  return rows;
}

/** Field của MỘT Schema — trang chi tiết §8.3.1, và bước sinh field tính toán. */
export async function listColumnsOfDataset(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
): Promise<ModelColumnRow[]> {
  const [rows] = await db.query<ModelColumnRow[]>(
    `SELECT ${FIELD_COLUMNS}
       FROM datamodel_columns c
      WHERE c.tenant_id = ? AND c.datamodel_dataset_id = ?
      ORDER BY c.ordinal ASC, c.id ASC`,
    [tenantId, datamodelDatasetId],
  );
  return rows;
}

/**
 * Sinh bốn field TÍNH TOÁN cho một cột số — §8.3.1.
 *
 * `INSERT IGNORE` chứ không kiểm trước: `UNIQUE (datamodel_dataset_id,
 * column_name)` là thứ thật sự chặn trùng, và giữa một câu SELECT kiểm và câu
 * INSERT luôn có khe hở. Nhờ vậy nút Sync gọi lại được bao nhiêu lần cũng không
 * đẻ thêm bản sao.
 *
 * `ordinal` bám theo cột gốc để bốn field nằm ngay dưới nó trong danh sách, thay
 * vì dồn hết xuống cuối trang.
 */
export async function insertCalcFields(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
  source: { id: number; columnName: string; chType: string; ordinal: number },
): Promise<number> {
  const aggs: CalcAgg[] = ['count', 'countDistinct', 'sum', 'avg'];

  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO datamodel_columns
       (tenant_id, datamodel_dataset_id, column_name, display_name, role,
        calc_agg, source_column_id, ch_type, ordinal, visible)
     VALUES ?`,
    [
      aggs.map((agg) => [
        tenantId,
        datamodelDatasetId,
        `${source.columnName}_${agg}`,
        `${source.columnName}_${agg}`,
        'measure',
        agg,
        source.id,
        source.chType,
        source.ordinal,
        1,
      ]),
    ],
  );
  return result.affectedRows;
}

/** Sửa một field ở trang chi tiết Schema — §8.3.1. */
export async function updateField(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
  fieldId: number,
  // `| undefined` tường minh vì `exactOptionalPropertyTypes` bật: ở chế độ đó
  // `?:` nghĩa là "vắng mặt", còn zod trả về "có mặt với giá trị undefined".
  input: {
    visible?: boolean | undefined;
    description?: string | null | undefined;
    displayName?: string | null | undefined;
  },
): Promise<number> {
  const sets: string[] = [];
  const params: unknown[] = [];

  // Chỉ ghi những gì người gọi THẬT SỰ gửi. `PUT` với một trường nghĩa là sửa
  // đúng trường đó; ghi cả ba sẽ xoá mô tả mỗi lần người dùng gạt công tắc.
  if (input.visible !== undefined) {
    sets.push('visible = ?');
    params.push(input.visible ? 1 : 0);
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(input.description);
  }
  if (input.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(input.displayName);
  }
  if (sets.length === 0) return 0;

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_columns SET ${sets.join(', ')}
      WHERE tenant_id = ? AND datamodel_dataset_id = ? AND id = ?`,
    [...params, tenantId, datamodelDatasetId, fieldId],
  );
  return result.affectedRows;
}

/** Xoá field tính toán của một cột — dùng khi Sync thấy cột đó biến mất. */
export async function deleteColumn(db: Db, tenantId: number, id: number): Promise<void> {
  // Field tính toán CASCADE theo `source_column_id`, không phải xoá tay.
  await db.query('DELETE FROM datamodel_columns WHERE tenant_id = ? AND id = ?', [tenantId, id]);
}

/** Thêm một cột thật vừa xuất hiện trong kho — nút Sync. */
export async function insertOneColumn(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
  input: ColumnInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_columns
       (tenant_id, datamodel_dataset_id, column_name, alias, role, ch_type, ordinal, visible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      datamodelDatasetId,
      input.columnName,
      input.alias,
      input.role,
      input.chType,
      input.ordinal,
      input.visible === false ? 0 : 1,
    ],
  );
  return result.insertId;
}

export interface ColumnInput {
  columnName: string;
  alias: string | null;
  role: ColumnRole;
  /**
   * Mặc định bật, TRỪ cột hệ thống.
   *
   * Migration 11 đặt `visible = 0` cho `_row_index` của những mô hình đã có,
   * nhưng dòng CHÈN MỚI thì lấy `DEFAULT 1` của cột — nên phải truyền tường
   * minh ở đây, nếu không cột hệ thống lại hiện ra với mọi mô hình tạo sau đó.
   */
  visible?: boolean;
  chType: string;
  ordinal: number;
}

export async function insertColumns(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
  columns: readonly ColumnInput[],
): Promise<void> {
  if (columns.length === 0) return;
  await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_columns
       (tenant_id, datamodel_dataset_id, column_name, alias, role, ch_type, ordinal, visible)
     VALUES ?`,
    [
      columns.map((c) => [
        tenantId,
        datamodelDatasetId,
        c.columnName,
        c.alias,
        c.role,
        c.chType,
        c.ordinal,
        c.visible === false ? 0 : 1,
      ]),
    ],
  );
}

/**
 * Sửa alias và vai trò — §10.3.
 *
 * `WHERE tenant_id = ?` một mình chưa đủ ở đây: người gọi truyền vào một mảng id
 * cột, và một id thuộc mô hình KHÁC trong cùng tổ chức vẫn khớp. Nên câu này
 * kèm luôn ràng buộc "cột phải thuộc mô hình đang mở" bằng một truy vấn con.
 */
export async function updateColumn(
  db: Db,
  tenantId: number,
  dataModelId: number,
  input: { columnId: number; alias: string | null; role: ColumnRole },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_columns c
       JOIN datamodel_datasets dmd ON dmd.id = c.datamodel_dataset_id
        SET c.alias = ?, c.role = ?
      WHERE c.tenant_id = ? AND c.id = ? AND dmd.datamodel_id = ?`,
    [input.alias, input.role, tenantId, input.columnId, dataModelId],
  );
  return result.affectedRows;
}

/** Đồng bộ lại `ch_type` sau khi đọc `system.columns` — phát hiện lệch kiểu. */
export async function syncColumnType(
  db: Db,
  tenantId: number,
  columnId: number,
  chType: string,
): Promise<void> {
  await db.query('UPDATE datamodel_columns SET ch_type = ? WHERE tenant_id = ? AND id = ?', [
    chType,
    tenantId,
    columnId,
  ]);
}

// ─── Thước đo ────────────────────────────────────────────────────────────────

interface MeasureRow extends RowDataPacket {
  id: number;
  name: string;
  agg: MeasureAgg;
  datamodel_dataset_id: number;
  dataset_name: string;
  column_id: number | null;
  column_name: string | null;
  created_at: Date;
}

const MEASURE_SELECT = `SELECT m.id, m.name, m.agg, m.datamodel_dataset_id,
         d.name AS dataset_name, m.datamodel_column_id AS column_id,
         c.column_name, m.created_at
    FROM datamodel_measures m
    JOIN datamodel_datasets dmd ON dmd.id = m.datamodel_dataset_id
    JOIN datasets d ON d.id = dmd.dataset_id
    LEFT JOIN datamodel_columns c ON c.id = m.datamodel_column_id`;

function toMeasureDto(row: MeasureRow): DataModelMeasureDto {
  return {
    id: Number(row.id),
    name: row.name,
    agg: row.agg,
    datamodelDatasetId: Number(row.datamodel_dataset_id),
    datasetName: row.dataset_name,
    columnId: row.column_id === null ? null : Number(row.column_id),
    columnName: row.column_name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listMeasures(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<DataModelMeasureDto[]> {
  const [rows] = await db.query<MeasureRow[]>(
    `${MEASURE_SELECT}
      WHERE m.tenant_id = ? AND m.datamodel_id = ? AND m.deleted_at IS NULL
      ORDER BY m.id ASC`,
    [tenantId, dataModelId],
  );
  return rows.map(toMeasureDto);
}

export async function createMeasure(
  db: Db,
  tenantId: number,
  input: {
    dataModelId: number;
    datamodelDatasetId: number;
    columnId: number | null;
    name: string;
    agg: MeasureAgg;
    createdBy: number | null;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_measures
       (tenant_id, datamodel_id, datamodel_dataset_id, datamodel_column_id, name, agg, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.dataModelId,
      input.datamodelDatasetId,
      input.columnId,
      input.name,
      input.agg,
      input.createdBy,
    ],
  );
  return result.insertId;
}

export async function updateMeasure(
  db: Db,
  tenantId: number,
  dataModelId: number,
  id: number,
  input: { name: string; agg: MeasureAgg; columnId: number | null },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_measures
        SET name = ?, agg = ?, datamodel_column_id = ?
      WHERE tenant_id = ? AND datamodel_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.agg, input.columnId, tenantId, dataModelId, id],
  );
  return result.affectedRows;
}

export async function softDeleteMeasure(
  db: Db,
  tenantId: number,
  dataModelId: number,
  id: number,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_measures SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND datamodel_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, dataModelId, id],
  );
  return result.affectedRows;
}

// ─── Quan hệ ─────────────────────────────────────────────────────────────────

interface RelationshipRow extends RowDataPacket {
  id: number;
  kind: RelationshipKind;
  left_id: number;
  left_name: string;
  left_column_id: number;
  left_column: string;
  right_id: number;
  right_name: string;
  right_column_id: number;
  right_column: string;
  created_at: Date;
}

const RELATIONSHIP_SELECT = `SELECT r.id, r.kind, r.created_at,
         r.left_id, ld.name AS left_name, r.left_column_id, lc.column_name AS left_column,
         r.right_id, rd.name AS right_name, r.right_column_id, rc.column_name AS right_column
    FROM datamodel_relationships r
    JOIN datamodel_datasets ldm ON ldm.id = r.left_id
    JOIN datasets ld ON ld.id = ldm.dataset_id
    JOIN datamodel_columns lc ON lc.id = r.left_column_id
    JOIN datamodel_datasets rdm ON rdm.id = r.right_id
    JOIN datasets rd ON rd.id = rdm.dataset_id
    JOIN datamodel_columns rc ON rc.id = r.right_column_id`;

function toRelationshipDto(row: RelationshipRow): DataModelRelationshipDto {
  return {
    id: Number(row.id),
    kind: row.kind,
    left: {
      datasetRef: Number(row.left_id),
      datasetName: row.left_name,
      columnId: Number(row.left_column_id),
      columnName: row.left_column,
    },
    right: {
      datasetRef: Number(row.right_id),
      datasetName: row.right_name,
      columnId: Number(row.right_column_id),
      columnName: row.right_column,
    },
    createdAt: row.created_at.toISOString(),
  };
}

export async function listRelationships(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<DataModelRelationshipDto[]> {
  const [rows] = await db.query<RelationshipRow[]>(
    `${RELATIONSHIP_SELECT}
      WHERE r.tenant_id = ? AND r.datamodel_id = ? AND r.deleted_at IS NULL
      ORDER BY r.id ASC`,
    [tenantId, dataModelId],
  );
  return rows.map(toRelationshipDto);
}

export async function createRelationship(
  db: Db,
  tenantId: number,
  input: {
    dataModelId: number;
    leftId: number;
    leftColumnId: number;
    rightId: number;
    rightColumnId: number;
    kind: RelationshipKind;
    createdBy: number;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_relationships
       (tenant_id, datamodel_id, left_id, left_column_id, right_id, right_column_id, kind, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.dataModelId,
      input.leftId,
      input.leftColumnId,
      input.rightId,
      input.rightColumnId,
      input.kind,
      input.createdBy,
    ],
  );
  return result.insertId;
}

export async function softDeleteRelationship(
  db: Db,
  tenantId: number,
  dataModelId: number,
  id: number,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_relationships SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND datamodel_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, dataModelId, id],
  );
  return result.affectedRows;
}

/**
 * Bộ dữ liệu này đã nằm trong mô hình nào chưa.
 *
 * Chặn việc mỗi lần nạp lại lại đẻ thêm một mô hình, và cũng chặn việc sinh
 * thêm mô hình riêng cho một bộ dữ liệu người dùng đã tự đưa vào mô hình nhiều
 * bảng của họ.
 */
export async function countModelsUsingDataset(
  db: Db,
  tenantId: number,
  datasetId: number,
): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM datamodel_datasets dmd
       JOIN datamodels dm ON dm.id = dmd.datamodel_id AND dm.deleted_at IS NULL
      WHERE dmd.tenant_id = ? AND dmd.dataset_id = ?`,
    [tenantId, datasetId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

/** Mọi tổ chức có mô hình còn sống — dùng để sinh lại toàn bộ file lúc boot. */
export async function listTenantsWithModels(db: Db): Promise<number[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT DISTINCT tenant_id FROM datamodels WHERE deleted_at IS NULL',
  );
  return rows.map((r) => Number(r['tenant_id']));
}

/** Id mọi mô hình còn sống của một tổ chức — bộ sinh file cần danh sách đầy đủ. */
export async function listLiveModelIds(db: Db, tenantId: number): Promise<number[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id FROM datamodels WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY id ASC',
    [tenantId],
  );
  return rows.map((r) => Number(r['id']));
}
