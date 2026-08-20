import type {
  ColumnRole,
  DataModelDto,
  DataModelMeasureDto,
  DataModelRelationshipDto,
  MeasureAgg,
  MeasureFormat,
  MeasureKind,
  MeasureOp,
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
  /**
   * KHÔNG truyền nghĩa là "cả tổ chức", không phải "workspace đang mở".
   *
   * Cùng lý do đã ghi ở `GET /datasets`: mô hình dữ liệu là lời mô tả về những
   * bộ dữ liệu trong kho, mà kho §8 nằm ở phạm vi TỔ CHỨC. Lọc mô hình theo
   * workspace trong khi nguyên liệu dựng nên nó thì không, tạo ra một cái bẫy
   * rất khó đoán: người dùng chọn bộ dữ liệu thấy được từ mọi workspace, dựng
   * mô hình xong, rồi mô hình ấy biến mất ngay khi họ đổi workspace — trông
   * hệt như dữ liệu bị mất.
   *
   * Cột `workspace_id` vẫn được ghi để biết mô hình sinh ra ở đâu, và bộ lọc
   * này vẫn nhận giá trị khi nơi gọi thật sự muốn thu hẹp phạm vi.
   */
  workspaceId?: number | undefined;
  search?: string | undefined;
  sort: DataModelSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** Dùng chung bởi `count` và `list` để hai bên không thể lệch nhau. */
function where(tenantId: number, filter: DataModelFilter): { sql: string; params: unknown[] } {
  const parts = ['dm.tenant_id = ?', 'dm.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (filter.workspaceId !== undefined) {
    parts.push('dm.workspace_id = ?');
    params.push(filter.workspaceId);
  }

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
  display_name: string | null;
  description: string | null;
  primary_column_id: number | null;
  /** Tên cột khoá chính, giải sẵn để giao diện khỏi phải tự dò. */
  primary_column_name: string | null;
  canvas_x: number;
  canvas_y: number;
}

export async function listDatasets(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<ModelDatasetRow[]> {
  const [rows] = await db.query<ModelDatasetRow[]>(
    // `LEFT JOIN` cho cột khoá chính: chưa đặt thì `primary_column_id` là NULL,
    // và `INNER JOIN` sẽ làm cả BẢNG biến mất khỏi mô hình — đúng loại lỗi chỉ
    // lộ ra với dữ liệu chưa được cấu hình đầy đủ.
    `SELECT dmd.id, dmd.datamodel_id, dmd.dataset_id, d.name AS dataset_name,
            dmd.display_name, dmd.description, dmd.primary_column_id,
            pk.column_name AS primary_column_name,
            dmd.canvas_x, dmd.canvas_y
       FROM datamodel_datasets dmd
       JOIN datasets d ON d.id = dmd.dataset_id
       LEFT JOIN datamodel_columns pk ON pk.id = dmd.primary_column_id
      WHERE dmd.tenant_id = ? AND dmd.datamodel_id = ?
      ORDER BY dmd.id ASC`,
    [tenantId, dataModelId],
  );
  return rows;
}

/**
 * Sửa phần mô tả của một BẢNG trong mô hình — tên hiển thị, mô tả, khoá chính.
 *
 * `WHERE tenant_id = ?` một mình chưa đủ: `refId` do người gọi gửi lên, và một
 * id thuộc mô hình KHÁC trong cùng tổ chức vẫn khớp. Nên câu này kèm luôn ràng
 * buộc "dòng phải thuộc mô hình đang mở" — cùng khuôn với `updateColumn`.
 */
export async function updateDataset(
  db: Db,
  tenantId: number,
  dataModelId: number,
  refId: number,
  input: {
    displayName: string | null;
    description: string | null;
    primaryColumnId: number | null;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE datamodel_datasets
        SET display_name = ?, description = ?, primary_column_id = ?
      WHERE tenant_id = ? AND id = ? AND datamodel_id = ?`,
    [
      input.displayName,
      input.description,
      input.primaryColumnId,
      tenantId,
      refId,
      dataModelId,
    ],
  );
  return result.affectedRows;
}

/**
 * Một cột, tra trong phạm vi ĐÚNG bảng của ĐÚNG mô hình của ĐÚNG tổ chức.
 *
 * Đây là thứ giữ cách ly tổ chức cho `primary_column_id`, vì khoá ngoại của cột
 * đó chỉ là khoá một cột (xem migration 12). Ba tầng lọc trong một câu: id cột
 * của tổ chức khác, của mô hình khác, hay của bảng khác đều cho ra `null`.
 */
export async function findColumnInDataset(
  db: Db,
  tenantId: number,
  dataModelId: number,
  refId: number,
  columnId: number,
): Promise<{ id: number; columnName: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.column_name
       FROM datamodel_columns c
       JOIN datamodel_datasets dmd ON dmd.id = c.datamodel_dataset_id
      WHERE c.tenant_id = ? AND c.id = ? AND dmd.id = ? AND dmd.datamodel_id = ?
      LIMIT 1`,
    [tenantId, columnId, refId, dataModelId],
  );
  const row = rows[0];
  return row ? { id: Number(row['id']), columnName: String(row['column_name']) } : null;
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
  role: ColumnRole;
  ch_type: string;
  ordinal: number;
}

export async function listColumns(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<ModelColumnRow[]> {
  const [rows] = await db.query<ModelColumnRow[]>(
    `SELECT c.id, c.datamodel_dataset_id, c.column_name, c.alias, c.role, c.ch_type, c.ordinal
       FROM datamodel_columns c
       JOIN datamodel_datasets dmd ON dmd.id = c.datamodel_dataset_id
      WHERE c.tenant_id = ? AND dmd.datamodel_id = ?
      ORDER BY c.datamodel_dataset_id ASC, c.ordinal ASC`,
    [tenantId, dataModelId],
  );
  return rows;
}

/** Cột của MỘT bảng trong mô hình — dùng để gieo thước đo ngay sau khi chèn. */
export async function listColumnsOfDataset(
  db: Db,
  tenantId: number,
  datamodelDatasetId: number,
): Promise<ModelColumnRow[]> {
  const [rows] = await db.query<ModelColumnRow[]>(
    `SELECT id, datamodel_dataset_id, column_name, alias, role, ch_type, ordinal
       FROM datamodel_columns
      WHERE tenant_id = ? AND datamodel_dataset_id = ?
      ORDER BY ordinal ASC`,
    [tenantId, datamodelDatasetId],
  );
  return rows;
}

export interface ColumnInput {
  columnName: string;
  alias: string | null;
  role: ColumnRole;
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
       (tenant_id, datamodel_dataset_id, column_name, alias, role, ch_type, ordinal)
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
  expr_kind: MeasureKind;
  expr_op: MeasureOp | null;
  expr_left_id: number | null;
  expr_right_id: number | null;
  /** ⚠️ Trỏ CỘT, khác hẳn `expr_right_id` trỏ THƯỚC ĐO. Xem migration 23. */
  expr_right_column_id: number | null;
  left_name: string | null;
  right_name: string | null;
  right_column_name: string | null;
  display_format: MeasureFormat;
  datamodel_dataset_id: number;
  dataset_name: string;
  column_id: number | null;
  column_name: string | null;
  created_at: Date;
}

// Tự nối hai lần để lấy TÊN hai vế của công thức. Không có nó thì giao diện
// phải tự ghép id với tên, và mọi nơi hiển thị công thức lại tự ghép một lần.
const MEASURE_SELECT = `SELECT m.id, m.name, m.agg, m.datamodel_dataset_id,
         m.expr_kind, m.expr_op, m.expr_left_id, m.expr_right_id,
         m.expr_right_column_id, m.display_format,
         ml.name AS left_name, mr.name AS right_name,
         rc.column_name AS right_column_name,
         d.name AS dataset_name, m.datamodel_column_id AS column_id,
         c.column_name, m.created_at
    FROM datamodel_measures m
    JOIN datamodel_datasets dmd ON dmd.id = m.datamodel_dataset_id
    JOIN datasets d ON d.id = dmd.dataset_id
    LEFT JOIN datamodel_columns c ON c.id = m.datamodel_column_id
    LEFT JOIN datamodel_columns rc ON rc.id = m.expr_right_column_id
    LEFT JOIN datamodel_measures ml ON ml.id = m.expr_left_id
    LEFT JOIN datamodel_measures mr ON mr.id = m.expr_right_id`;

function toMeasureDto(row: MeasureRow): DataModelMeasureDto {
  // Công thức chỉ dựng khi ĐỦ cả ba mảnh. Thiếu một mảnh nghĩa là dòng hỏng —
  // trả `formula: null` để giao diện hiện nó như thước đo thường thay vì vẽ ra
  // một công thức có ô trống.
  const formula =
    row.expr_kind === 'formula' &&
    row.expr_left_id !== null &&
    row.expr_right_id !== null &&
    row.expr_op !== null
      ? {
          leftId: Number(row.expr_left_id),
          leftName: row.left_name ?? '—',
          op: row.expr_op,
          rightId: Number(row.expr_right_id),
          rightName: row.right_name ?? '—',
        }
      : null;

  // Cùng luật "đủ mảnh mới dựng" như `formula`: thiếu một mảnh thì hiện như
  // thước đo thường, đừng vẽ ra một biểu thức có ô trống.
  const rowExpr =
    row.expr_kind === 'rowExpr' && row.expr_right_column_id !== null && row.expr_op !== null
      ? {
          op: row.expr_op,
          rightColumnId: Number(row.expr_right_column_id),
          rightColumnName: row.right_column_name ?? '—',
        }
      : null;

  return {
    id: Number(row.id),
    name: row.name,
    agg: row.agg,
    // Đọc thẳng `expr_kind` chứ không suy từ `formula !== null` — đúng cái bẫy
    // mà ghi chú ở `DataModelMeasureDto.kind` đã cảnh báo khi có kiểu thứ ba.
    kind: rowExpr !== null ? 'rowExpr' : formula !== null ? 'formula' : 'column',
    format: row.display_format,
    formula,
    rowExpr,
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

/**
 * Thước đo CÒN SỐNG nào đang dùng thước đo này làm một vế.
 *
 * Gọi TRƯỚC mọi lần xoá. Không có bước này thì xoá `Sales` sẽ để lại công thức
 * "Biên lợi nhuận" trỏ vào hư không, Cube biên dịch hỏng, và cả tab Explorer
 * chết vì một thao tác trông hoàn toàn vô hại.
 */
export async function measuresUsing(
  db: Db,
  tenantId: number,
  dataModelId: number,
  id: number,
): Promise<string[]> {
  const [rows] = await db.query<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM datamodel_measures
      WHERE tenant_id = ? AND datamodel_id = ? AND deleted_at IS NULL
        AND (expr_left_id = ? OR expr_right_id = ?)
      ORDER BY name ASC`,
    [tenantId, dataModelId, id, id],
  );
  return rows.map((r) => r.name);
}

/**
 * Thước đo dựng trên một CỘT — kể cả bản đã xoá mềm.
 *
 * Lấy cả bản đã xoá là có lý do rất cụ thể: ràng buộc
 * `UNIQUE (datamodel_id, name)` KHÔNG tính tới `deleted_at`. Nên sau khi người
 * dùng gỡ thước đo của cột `Sales` rồi đổi ý, một lệnh INSERT tên "Sales" sẽ
 * đâm vào dòng đã xoá và ném `ER_DUP_ENTRY`. Hồi sinh đúng dòng cũ vừa tránh
 * được điều đó, vừa giữ nguyên `id` — nên công thức nào đang trỏ vào nó vẫn
 * còn nguyên nghĩa.
 */
export async function findMeasureOfColumn(
  db: Db,
  tenantId: number,
  dataModelId: number,
  columnId: number,
): Promise<{ id: number; agg: MeasureAgg; deleted: boolean } | null> {
  const [rows] = await db.query<
    (RowDataPacket & { id: number; agg: MeasureAgg; deleted_at: Date | null })[]
  >(
    `SELECT id, agg, deleted_at FROM datamodel_measures
      WHERE tenant_id = ? AND datamodel_id = ? AND datamodel_column_id = ?
        AND expr_kind = 'column'
      ORDER BY deleted_at IS NULL DESC, id ASC
      LIMIT 1`,
    [tenantId, dataModelId, columnId],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { id: Number(row.id), agg: row.agg, deleted: row.deleted_at !== null };
}

/** Đặt lại phép gộp và tên, đồng thời HỒI SINH nếu dòng đang bị xoá mềm. */
export async function reviveColumnMeasure(
  db: Db,
  tenantId: number,
  dataModelId: number,
  id: number,
  input: { name: string; agg: MeasureAgg },
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE datamodel_measures SET name = ?, agg = ?, deleted_at = NULL
      WHERE tenant_id = ? AND datamodel_id = ? AND id = ?`,
    [input.name, input.agg, tenantId, dataModelId, id],
  );
}

/** Mọi tên thước đo còn sống — để né `UNIQUE (datamodel_id, name)`. */
export async function measureNames(
  db: Db,
  tenantId: number,
  dataModelId: number,
): Promise<Set<string>> {
  const [rows] = await db.query<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM datamodel_measures
      WHERE tenant_id = ? AND datamodel_id = ? AND deleted_at IS NULL`,
    [tenantId, dataModelId],
  );
  return new Set(rows.map((r) => r.name));
}

/**
 * Thước đo TÍNH TOÁN.
 *
 * `agg` vẫn phải điền vì cột đó `NOT NULL` từ migration 6, nhưng nó KHÔNG mang
 * nghĩa gì ở đây — bộ sinh schema đọc `expr_kind` trước và không bao giờ nhìn
 * tới `agg` của dòng công thức. Ghi `sum` như một giá trị giữ chỗ.
 */
export async function createFormulaMeasure(
  db: Db,
  tenantId: number,
  input: {
    dataModelId: number;
    datamodelDatasetId: number;
    name: string;
    op: MeasureOp;
    leftId: number;
    rightId: number;
    format: MeasureFormat;
    createdBy: number | null;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_measures
       (tenant_id, datamodel_id, datamodel_dataset_id, datamodel_column_id, name, agg,
        expr_kind, expr_op, expr_left_id, expr_right_id, display_format, created_by)
     VALUES (?, ?, ?, NULL, ?, 'sum', 'formula', ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.dataModelId,
      input.datamodelDatasetId,
      input.name,
      input.op,
      input.leftId,
      input.rightId,
      input.format,
      input.createdBy,
    ],
  );
  return result.insertId;
}

/**
 * Thước đo GỘP TRÊN BIỂU THỨC DÒNG — `sum(Số lượng × Đơn giá)`.
 *
 * Ngược hẳn `createFormulaMeasure` ở chỗ `agg` là THẬT: nó là phép gộp áp lên
 * kết quả biểu thức, và đổi nó đổi hẳn con số. Hai vế là cột chưa gộp, nên
 * `datamodel_column_id` mang vế trái đúng như thước đo thường.
 */
export async function createRowExprMeasure(
  db: Db,
  tenantId: number,
  input: {
    dataModelId: number;
    datamodelDatasetId: number;
    name: string;
    agg: MeasureAgg;
    leftColumnId: number;
    op: MeasureOp;
    rightColumnId: number;
    format: MeasureFormat;
    createdBy: number | null;
  },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO datamodel_measures
       (tenant_id, datamodel_id, datamodel_dataset_id, datamodel_column_id, name, agg,
        expr_kind, expr_op, expr_right_column_id, display_format, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'rowExpr', ?, ?, ?, ?)`,
    [
      tenantId,
      input.dataModelId,
      input.datamodelDatasetId,
      input.leftColumnId,
      input.name,
      input.agg,
      input.op,
      input.rightColumnId,
      input.format,
      input.createdBy,
    ],
  );
  return result.insertId;
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
