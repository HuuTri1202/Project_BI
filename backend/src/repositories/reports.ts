import type { ChartType, ReportConfigDto, ReportDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Báo cáo — một biểu đồ dựng trên một bộ dữ liệu (§7.6).
 *
 * Cùng khuôn tenant-scoped với `projects.ts` và `datasets.ts`.
 *
 * `config` lưu dạng JSON. Database không kiểm được nội dung của nó; việc đó do
 * zod ở `api/v1/schemas.ts` lo. Chấp nhận được vì cột này chỉ được đọc bởi đúng
 * một nơi là trình vẽ biểu đồ, nhưng nghĩa là dữ liệu cũ có thể mang một hình
 * dạng `config` không còn hợp lệ sau khi ta đổi kiểu — xem `parseConfig`.
 */

interface ReportRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  dataset_id: number;
  dataset_name: string;
  name: string;
  chart_type: ChartType | null;
  config: unknown;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `r.id, r.workspace_id, r.dataset_id, d.name AS dataset_name,
            r.name, r.chart_type, r.config, u.full_name AS creator_name,
            r.created_at, r.updated_at
       FROM reports r
       JOIN datasets d ON d.id = r.dataset_id
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
  if (raw === null || raw === undefined) return null;

  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (value === null || typeof value !== 'object') return null;

  const obj = value as Partial<ReportConfigDto>;
  if (typeof obj.dimension !== 'string' || obj.dimension === '') return null;

  return {
    dimension: obj.dimension,
    measure: typeof obj.measure === 'string' ? obj.measure : null,
    aggregate: obj.aggregate ?? 'count',
    limit: typeof obj.limit === 'number' ? obj.limit : 20,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toDto(row: ReportRow): ReportDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    datasetId: Number(row.dataset_id),
    datasetName: row.dataset_name,
    name: row.name,
    chartType: row.chart_type,
    config: parseConfig(row.config),
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
  // `d.deleted_at IS NULL`: bộ dữ liệu bị xoá mềm thì báo cáo dựa trên nó không
  // vẽ được nữa, nên đừng hiện. Khoá ngoại là RESTRICT nên tình huống này chỉ
  // xảy ra qua xoá mềm, và xoá mềm không kích hoạt ràng buộc nào.
  const conditions = [
    'r.tenant_id = ?',
    'r.workspace_id = ?',
    'r.deleted_at IS NULL',
    'd.deleted_at IS NULL',
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
       JOIN datasets d ON d.id = r.dataset_id
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
        AND r.deleted_at IS NULL AND d.deleted_at IS NULL
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
