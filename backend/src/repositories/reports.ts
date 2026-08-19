import type {
  ChartType,
  DatasetSource,
  ReportConfigDto,
  ReportDto,
  ReportModelConfigDto,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Báo cáo — một biểu đồ dựng trên một bộ dữ liệu (§7.6).
 *
 * Cùng khuôn tenant-scoped với `datasets.ts`.
 *
 * `config` lưu dạng JSON. Database không kiểm được nội dung của nó; việc đó do
 * zod ở `api/v1/schemas.ts` lo. Chấp nhận được vì cột này chỉ được đọc bởi đúng
 * một nơi là trình vẽ biểu đồ, nhưng nghĩa là dữ liệu cũ có thể mang một hình
 * dạng `config` không còn hợp lệ sau khi ta đổi kiểu — xem `parseConfig`.
 */

interface ReportRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  dataset_id: number | null;
  dataset_name: string | null;
  dataset_source: DatasetSource | null;
  datamodel_id: number | null;
  datamodel_name: string | null;
  name: string;
  chart_type: ChartType | null;
  config: unknown;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
}

/*
 * ⚠️ LEFT JOIN cho cả hai nguồn, không phải JOIN.
 *
 * `dataset_id` NULL được từ migration 15, nên một `JOIN datasets` bình thường
 * sẽ lặng lẽ nuốt sạch báo cáo dựng trên mô hình — chúng biến mất khỏi mọi danh
 * sách mà không có lỗi nào. Đây là chỗ dễ hỏng nhất khi đọc lướt file này.
 *
 * `CHECK ((dataset_id IS NULL) <> (datamodel_id IS NULL))` bảo đảm đúng một
 * trong hai vế có dữ liệu, nên `COALESCE` dưới đây luôn lấy được một cái tên.
 */
const SELECT_COLUMNS = `r.id, r.workspace_id,
            r.dataset_id, d.name AS dataset_name, d.source AS dataset_source,
            r.datamodel_id, dm.name AS datamodel_name,
            r.name, r.chart_type, r.config, u.full_name AS creator_name,
            r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN datasets d ON d.id = r.dataset_id
       LEFT JOIN datamodels dm ON dm.id = r.datamodel_id
       LEFT JOIN users u ON u.id = r.created_by`;

/**
 * Đọc `config` từ database.
 *
 * Trả `null` cho HAI trường hợp khác nhau về ý nghĩa nhưng giống nhau về cách
 * xử lý:
 *
 *   - Cột thật sự NULL — báo cáo vừa được wizard tạo, chưa ai dựng biểu đồ.
 *     Đây là trạng thái bình thường (§7.6).
 *   - JSON hỏng hoặc thiếu trường bắt buộc — bản ghi cũ còn lại sau một lần đổi
 *     kiểu. Hiếm, nhưng có thật.
 *
 * Cả hai đều dẫn tới cùng một màn hình: lời mời dựng biểu đồ. Ném lỗi cho
 * trường hợp thứ hai sẽ làm hỏng cả trang danh sách vì một bản ghi lỗi, và cướp
 * luôn đường vào để người dùng sửa nó.
 */
function parseConfig(raw: unknown): ReportConfigDto | null {
  const value = readJson(raw);
  if (value === null) return null;

  const obj = value as Partial<ReportConfigDto>;
  if (typeof obj.dimension !== 'string' || obj.dimension === '') return null;

  return {
    dimension: obj.dimension,
    measure: typeof obj.measure === 'string' ? obj.measure : null,
    aggregate: obj.aggregate ?? 'count',
    limit: typeof obj.limit === 'number' ? obj.limit : 20,
  };
}

/**
 * Cùng một cột `config`, cách đọc khác — báo cáo dựng trên mô hình (§10.8).
 *
 * Phân biệt bằng `reports.datamodel_id` chứ KHÔNG bằng một trường `kind` trong
 * JSON: cột thì database ép được (xem CHECK ở migration 15), còn một trường
 * trong JSON thì không, và nó cũng sẽ vắng mặt ở mọi bản ghi có từ trước.
 *
 * Trả `null` khi thiếu ID — cùng lập luận với `parseConfig`: một bản ghi hỏng
 * không được phép làm sập cả trang danh sách.
 */
function parseModelConfig(raw: unknown): ReportModelConfigDto | null {
  const value = readJson(raw);
  if (value === null) return null;

  const obj = value as Partial<ReportModelConfigDto>;
  if (!Number.isInteger(obj.dimensionId) || !Number.isInteger(obj.measureId)) return null;

  return {
    dimensionId: Number(obj.dimensionId),
    measureId: Number(obj.measureId),
    limit: typeof obj.limit === 'number' ? obj.limit : 20,
  };
}

/** `config` ra khỏi database dưới dạng object hoặc chuỗi, tuỳ driver. */
function readJson(raw: unknown): object | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  return value !== null && typeof value === 'object' ? value : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toDto(row: ReportRow): ReportDto {
  const onModel = row.datamodel_id !== null;

  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    source: onModel ? 'datamodel' : 'dataset',
    // Nguồn đã bị xoá CỨNG là chuyện khoá ngoại RESTRICT không cho xảy ra. Vẫn
    // đỡ ở đây để một bản ghi lệch cho ra một cái tên xấu, không phải `null`
    // rơi thẳng vào giao diện.
    sourceName: (onModel ? row.datamodel_name : row.dataset_name) ?? 'Không rõ',
    datasetId: row.dataset_id === null ? null : Number(row.dataset_id),
    datasetSource: row.dataset_source,
    datamodelId: row.datamodel_id === null ? null : Number(row.datamodel_id),
    name: row.name,
    chartType: row.chart_type,
    config: onModel ? null : parseConfig(row.config),
    modelConfig: onModel ? parseModelConfig(row.config) : null,
    creatorName: row.creator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListReportsFilter {
  workspaceId: number;
  search?: string | undefined;
  page: number;
  pageSize: number;
}

function buildWhere(tenantId: number, filter: ListReportsFilter): {
  sql: string;
  params: (string | number)[];
} {
  // Nguồn bị xoá mềm thì báo cáo dựa trên nó không vẽ được nữa, nên đừng hiện.
  // Khoá ngoại là RESTRICT nên tình huống này chỉ xảy ra qua xoá mềm, và xoá
  // mềm không kích hoạt ràng buộc nào.
  //
  // Hai điều kiện này CHỈ đúng nhờ LEFT JOIN: với báo cáo dựng trên mô hình thì
  // không có dòng `datasets` nào, `d.deleted_at` ra NULL, và `IS NULL` cho TRUE
  // — tức là điều kiện tự bỏ qua đúng vế không liên quan. Đổi sang `JOIN` hay
  // viết thành `d.deleted_at IS NULL OR ...` đều làm hỏng tính chất đó.
  const conditions = [
    'r.tenant_id = ?',
    'r.workspace_id = ?',
    'r.deleted_at IS NULL',
    'd.deleted_at IS NULL',
    'dm.deleted_at IS NULL',
  ];
  const params: (string | number)[] = [tenantId, filter.workspaceId];

  if (filter.search) {
    conditions.push(`r.name LIKE ? ESCAPE '\\\\'`);
    params.push(`%${escapeLikeTerm(filter.search)}%`);
  }

  return { sql: conditions.join(' AND '), params };
}

export async function countReports(
  db: Db,
  tenantId: number,
  filter: ListReportsFilter,
): Promise<number> {
  const where = buildWhere(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM reports r
       LEFT JOIN datasets d ON d.id = r.dataset_id
       LEFT JOIN datamodels dm ON dm.id = r.datamodel_id
      WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listReports(
  db: Db,
  tenantId: number,
  filter: ListReportsFilter,
): Promise<ReportDto[]> {
  const where = buildWhere(tenantId, filter);
  const [rows] = await db.query<ReportRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE ${where.sql}
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toDto);
}

export async function findById(db: Db, tenantId: number, id: number): Promise<ReportDto | null> {
  const [rows] = await db.query<ReportRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE r.tenant_id = ? AND r.id = ? AND r.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

/** Báo cáo mới đụng tới gần đây nhất — khối "Báo cáo gần đây" của trang Home. */
export async function listRecent(
  db: Db,
  tenantId: number,
  workspaceId: number,
  limit: number,
): Promise<ReportDto[]> {
  const [rows] = await db.query<ReportRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE r.tenant_id = ? AND r.workspace_id = ?
        AND r.deleted_at IS NULL AND d.deleted_at IS NULL AND dm.deleted_at IS NULL
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ?`,
    [tenantId, workspaceId, limit],
  );
  return rows.map(toDto);
}

export interface CreateReportInput {
  workspaceId: number;
  datasetId: number;
  name: string;
  createdBy: number;
}

/**
 * Tạo bản ghi báo cáo RỖNG — chưa có biểu đồ (§7.6).
 *
 * `chart_type` và `config` để NULL. Wizard không đoán hộ người dùng muốn vẽ gì;
 * việc đó do chính họ làm trên trang Report qua `updateReport`.
 */
export async function createReport(
  db: Db,
  tenantId: number,
  input: CreateReportInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO reports (tenant_id, workspace_id, dataset_id, name, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, input.workspaceId, input.datasetId, input.name, input.createdBy],
  );
  return result.insertId;
}

export interface CreateModelReportRow {
  workspaceId: number;
  datamodelId: number;
  name: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
  createdBy: number;
}

/**
 * Tạo báo cáo trên mô hình — ra đời là đã CÓ biểu đồ (§10.8).
 *
 * Khác `createReport` ở đúng chỗ đó, và lý do nằm ở `CreateModelReportInput`
 * bên `shared`: người dùng vừa tự chọn chiều với thước đo trong hộp thoại, nên
 * tạo một bản ghi rỗng chỉ để bắt họ chọn lại là việc thừa.
 */
export async function createModelReport(
  db: Db,
  tenantId: number,
  input: CreateModelReportRow,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO reports
       (tenant_id, workspace_id, datamodel_id, name, chart_type, config, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.workspaceId,
      input.datamodelId,
      input.name,
      input.chartType,
      JSON.stringify(input.config),
      input.createdBy,
    ],
  );
  return result.insertId;
}

export async function updateReport(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; chartType: ChartType; config: ReportConfigDto },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reports SET name = ?, chart_type = ?, config = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.chartType, JSON.stringify(input.config), tenantId, id],
  );
  return result.affectedRows;
}

export async function softDeleteReport(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reports SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}
