import {
  CANVAS_DEFAULT_H,
  CANVAS_DEFAULT_W,
  CHART_TYPES,
  type ChartType,
  type DatasetSource,
  PAGE_NAME_MAX,
  parseAnnotations,
  type ReportCanvasDto,
  type ReportConfigDto,
  type ReportDto,
  type ReportModelConfigDto,
  type ReportPageDto,
  type ReportVisualDto,
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
  folder_id: number | null;
  folder_name: string | null;
  dataset_id: number | null;
  dataset_name: string | null;
  dataset_source: DatasetSource | null;
  datamodel_id: number | null;
  datamodel_name: string | null;
  name: string;
  chart_type: ChartType | null;
  config: unknown;
  canvas: unknown;
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
            r.folder_id, f.name AS folder_name,
            r.dataset_id, d.name AS dataset_name, d.source AS dataset_source,
            r.datamodel_id, dm.name AS datamodel_name,
            r.name, r.chart_type, r.config, r.canvas, u.full_name AS creator_name,
            r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN datasets d ON d.id = r.dataset_id
       LEFT JOIN datamodels dm ON dm.id = r.datamodel_id
       LEFT JOIN report_folders f ON f.id = r.folder_id
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

  /*
   * Hai trường của §10.9 đọc theo kiểu KHOAN DUNG, ngược với hai ID ở trên.
   *
   * Thiếu `dimensionId` là báo cáo không vẽ được, nên nó làm cả bản ghi hỏng.
   * Còn thiếu `seriesDimensionId` hay `options` thì chỉ là một báo cáo §10.8
   * bình thường — mọi dòng lưu trước bản này đều như vậy. Từ chối chúng ở đây
   * sẽ biến cả kho báo cáo cũ thành "chưa có biểu đồ" chỉ vì ta thêm hai công
   * tắc mới.
   */
  const series = obj.seriesDimensionId;
  const options = obj.options;
  // Cùng luật khoan dung cho `pick`: vắng mặt = `'top'`, tức đúng hành vi của
  // mọi báo cáo lưu trước bản này. Giá trị lạ cũng rơi về `'top'` chứ không
  // làm hỏng bản ghi — nó chỉ là một lựa chọn, không phải một ID.
  const pick = obj.pick === 'bottom' ? 'bottom' : 'top';
  // `overflow` của §10.12–§10.14 cố ý KHÔNG được đọc: từ §10.15 mọi biểu đồ
  // dựng trên mô hình đều chia trang. Bản ghi cũ còn mang trường đó trong cột
  // `config` thì nó nằm im ở đó — dọn nó đòi một migration ghi lại toàn bộ JSON
  // của mọi báo cáo, để đổi lấy đúng một trường không ai đọc nữa.

  return {
    dimensionId: Number(obj.dimensionId),
    measureId: Number(obj.measureId),
    limit: typeof obj.limit === 'number' ? obj.limit : 20,
    pick,
    seriesDimensionId: Number.isInteger(series) ? Number(series) : null,
    // `exactOptionalPropertyTypes` phân biệt "vắng mặt" với "có mà undefined",
    // nên không gán thẳng `options` được — phải chọn một trong hai hình dạng.
    ...(options !== null && typeof options === 'object' ? { options } : {}),
  };
}

/**
 * Đọc cột `canvas` — báo cáo nhiều biểu đồ (§10.10), nhiều TRANG từ §10.12.
 *
 * `null` cho ba trường hợp cùng dẫn tới một kết quả: cột NULL (báo cáo một biểu
 * đồ, tức mọi bản ghi cũ), JSON hỏng, hoặc không còn ô nào đọc được.
 *
 * ⚠️ Ô hỏng bị BỎ QUA chứ không làm hỏng cả khung. Một khung bảy ô mà một ô trỏ
 * vào thước đo đã xoá vẫn phải mở ra được — từ chối cả khung nghĩa là người
 * dùng mất luôn đường vào để sửa đúng cái ô đó. Cùng lập luận với `parseConfig`,
 * chỉ khác là ở đây nó áp cho từng phần tử.
 *
 * ═══ HAI hình dạng trên đĩa, một hình dạng ra ngoài ═════════════════════════
 *
 * Bản ghi lưu ở §10.10 là `{ visuals: [...] }`; bản ghi từ §10.12 là
 * `{ pages: [{ id, name, visuals }] }`. Hàm này nhận cả hai và LUÔN trả về hình
 * dạng nhiều trang, nên không nơi nào khác trong hệ thống phải biết là có hai.
 *
 * Không migrate cột: `reports.canvas` là JSON, một bản ghi cũ vẫn là một bản
 * ghi đúng, và một câu `UPDATE` chạy trên mọi báo cáo của mọi tổ chức để đổi
 * đúng một tầng lồng nhau là rủi ro đổi lấy con số không.
 */
function parseCanvas(raw: unknown): ReportCanvasDto | null {
  const value = readJson(raw);
  if (value === null) return null;

  const obj = value as { pages?: unknown; visuals?: unknown };

  const pages: ReportPageDto[] = Array.isArray(obj.pages)
    ? obj.pages.flatMap((item, i) => {
        const page = parsePage(item, i);
        return page === null ? [] : [page];
      })
    : // Hình dạng §10.10 — một trang duy nhất. Mã trang là hằng chứ không sinh
      // ngẫu nhiên: nó đi vào khoá cache của trang xem, và một mã đổi sau mỗi
      // lần đọc là một lần trượt cache sau mỗi lần đọc.
      Array.isArray(obj.visuals)
      ? [{ id: 'p1', name: 'Trang 1', visuals: parseVisuals(obj.visuals), annotations: [] }]
      : [];

  // Trang RỖNG được giữ lại — người dùng tạo nó ra và chưa kịp dựng gì. Nhưng
  // một khung không còn ô nào ở bất kỳ trang nào thì không phải một khung.
  return pages.length === 0 || pages.every((p) => p.visuals.length === 0) ? null : { pages };
}

function parsePage(raw: unknown, index: number): ReportPageDto | null {
  if (raw === null || typeof raw !== 'object') return null;

  const obj = raw as Partial<ReportPageDto>;
  if (typeof obj.id !== 'string' || obj.id === '') return null;

  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, PAGE_NAME_MAX) : '';

  return {
    id: obj.id,
    // Tên rỗng vẫn phải hiện ra được: một cái thẻ không chữ ở mép dưới màn hình
    // là một cái thẻ người dùng không biết mình đang bấm vào đâu.
    name: name === '' ? `Trang ${index + 1}` : name,
    visuals: Array.isArray(obj.visuals) ? parseVisuals(obj.visuals) : [],
    // Bản ghi trước §10.18 không có trường này; chú thích hỏng bị bỏ qua từng
    // cái một, cùng lập luận với `parseVisuals` ngay dưới.
    annotations: parseAnnotations(obj.annotations),
  };
}

function parseVisuals(list: readonly unknown[]): ReportVisualDto[] {
  return list.flatMap((item) => {
    const visual = parseVisual(item);
    return visual === null ? [] : [visual];
  });
}

function parseVisual(raw: unknown): ReportVisualDto | null {
  if (raw === null || typeof raw !== 'object') return null;

  const obj = raw as Partial<ReportVisualDto>;
  if (typeof obj.id !== 'string' || obj.id === '') return null;
  if (!CHART_TYPES.includes(obj.chartType as ChartType)) return null;

  const config = parseModelConfig(obj.config);
  if (config === null) return null;

  return {
    id: obj.id,
    chartType: obj.chartType as ChartType,
    config,
    // `exactOptionalPropertyTypes`: "vắng mặt" khác "có mà undefined".
    ...(typeof obj.title === 'string' && obj.title !== '' ? { title: obj.title } : {}),
    x: gridUnit(obj.x, 0),
    y: gridUnit(obj.y, 0),
    w: gridUnit(obj.w, CANVAS_DEFAULT_W),
    h: gridUnit(obj.h, CANVAS_DEFAULT_H),
  };
}

/**
 * Một con số toạ độ lưới, hoặc giá trị thay thế.
 *
 * Không kẹp vào biên ở đây: zod đã làm việc đó ở đường ghi, còn đường đọc chỉ
 * cần bảo đảm không trả về `NaN` — một `NaN` lọt vào CSS `grid-column` làm cả ô
 * biến mất mà không có lỗi nào.
 */
function gridUnit(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : fallback;
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
    // `null` = Chung, và đó là một câu trả lời ĐỦ — xem `reportFolder.ts`.
    folderId: row.folder_id === null ? null : Number(row.folder_id),
    folderName: row.folder_name,
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
    canvas: onModel ? parseCanvas(row.canvas) : null,
    creatorName: row.creator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListReportsFilter {
  workspaceId: number;
  search?: string | undefined;
  /**
   * Lọc theo thư mục — §10.25. BA trạng thái, và chúng khác nhau thật sự:
   *
   *   `undefined` → mọi thư mục
   *   `null`      → chỉ Chung (`folder_id IS NULL`)
   *   số          → đúng thư mục đó
   *
   * Vì `null` ở đây là một lựa chọn CÓ NGHĨA, chỗ đọc nó không được viết theo
   * lối quen tay `if (filter.folderId)`: phép kiểm chân trị gộp `null` vào với
   * "không lọc", và người bấm vào Chung sẽ nhận nguyên cả danh sách.
   */
  folderId?: number | null | undefined;
  page: number;
  pageSize: number;
}

function buildWhere(
  tenantId: number,
  filter: ListReportsFilter,
): {
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

  // `!== undefined`, không phải phép kiểm chân trị — xem `ListReportsFilter`.
  if (filter.folderId !== undefined) {
    if (filter.folderId === null) {
      conditions.push('r.folder_id IS NULL');
    } else {
      conditions.push('r.folder_id = ?');
      params.push(filter.folderId);
    }
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
  /** Thư mục đích — §10.25. `null` = Chung. */
  folderId: number | null;
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
    `INSERT INTO reports (tenant_id, workspace_id, folder_id, dataset_id, name, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, input.workspaceId, input.folderId, input.datasetId, input.name, input.createdBy],
  );
  return result.insertId;
}

export interface CreateModelReportRow {
  workspaceId: number;
  datamodelId: number;
  name: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
  /** Thư mục đích — §10.25. `null` = Chung. */
  folderId: number | null;
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
       (tenant_id, workspace_id, folder_id, datamodel_id, name, chart_type, config, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.workspaceId,
      input.folderId,
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

/**
 * Cùng ba cột, cấu hình khác hình dạng — báo cáo trên mô hình (§10.9).
 *
 * Hàm riêng chứ không thêm một tham số kiểu union vào `updateReport`: hai bên
 * gọi ở hai nhánh router khác nhau, và một chữ ký nhận cả hai hình dạng sẽ cho
 * phép ghi `ReportConfigDto` vào một báo cáo trên mô hình. Kết quả của lần ghi
 * đó là `parseModelConfig` đọc ra `null` — báo cáo trở lại trạng thái "chưa có
 * biểu đồ" và mất luôn cấu hình cũ.
 *
 * `AND datamodel_id IS NOT NULL` là chốt cuối cùng cho đúng chuyện đó, đứng
 * độc lập với lần kiểm ở router. Rẻ, và nó biến một lỗi mất dữ liệu thành một
 * lần ghi trượt trả về 0 dòng.
 */
export async function updateModelReport(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; chartType: ChartType; config: ReportModelConfigDto },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reports SET name = ?, chart_type = ?, config = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL AND datamodel_id IS NOT NULL`,
    [input.name, input.chartType, JSON.stringify(input.config), tenantId, id],
  );
  return result.affectedRows;
}

export interface CanvasReportRow {
  workspaceId: number;
  datamodelId: number;
  name: string;
  canvas: ReportCanvasDto;
  /** Thư mục đích — §10.25. `null` = Chung. */
  folderId: number | null;
  createdBy: number;
}

/**
 * Ba cột đi CÙNG NHAU cho một báo cáo nhiều biểu đồ — §10.10.
 *
 * `canvas` là bản gốc. `chart_type` và `config` là BẢN SAO của ô đầu tiên, và
 * chúng tồn tại vì đúng một lý do: mọi thứ viết trước §10.10 vẫn đang đọc hai
 * cột đó — `GET /reports/:id/data`, huy hiệu loại biểu đồ trong danh sách, và
 * bất kỳ client cũ nào chưa biết tới `canvas`. Để chúng NULL nghĩa là một báo
 * cáo vừa lưu xong hiện ra là "Chưa có biểu đồ" ở trang danh sách.
 *
 * ⚠️ Một chiều, không bao giờ ngược lại. Sửa `chart_type`/`config` mà không sửa
 * `canvas` là tạo ra hai sự thật; mọi đường ghi của báo cáo nhiều biểu đồ vì vậy
 * phải đi qua đúng hai hàm dưới đây.
 */
function mirrorOfFirst(canvas: ReportCanvasDto): {
  chartType: ChartType | null;
  config: string | null;
} {
  // Ô đầu tiên của TRANG đầu tiên có ô. Một trang đầu để trống là chuyện bình
  // thường từ §10.12, và soi đúng `pages[0].visuals[0]` khi đó sẽ ghi `NULL` vào
  // `chart_type` — báo cáo vừa lưu xong hiện ra "Chưa có biểu đồ" ở danh sách.
  const first = canvas.pages.flatMap((p) => p.visuals)[0];
  if (first === undefined) return { chartType: null, config: null };
  return { chartType: first.chartType, config: JSON.stringify(first.config) };
}

export async function createCanvasReport(
  db: Db,
  tenantId: number,
  input: CanvasReportRow,
): Promise<number> {
  const mirror = mirrorOfFirst(input.canvas);
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO reports
       (tenant_id, workspace_id, folder_id, datamodel_id, name, chart_type, config, canvas,
        created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.workspaceId,
      input.folderId,
      input.datamodelId,
      input.name,
      mirror.chartType,
      mirror.config,
      JSON.stringify(input.canvas),
      input.createdBy,
    ],
  );
  return result.insertId;
}

/**
 * `AND datamodel_id IS NOT NULL` cùng lý do với `updateModelReport`: chốt cuối
 * để một lần gọi nhầm thành lần ghi trượt trả về 0 dòng, chứ không thành một báo
 * cáo trên bộ dữ liệu mang cấu hình dạng ID mà không ai đọc được.
 */
export async function updateCanvasReport(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; canvas: ReportCanvasDto },
): Promise<number> {
  const mirror = mirrorOfFirst(input.canvas);
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reports SET name = ?, chart_type = ?, config = ?, canvas = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL AND datamodel_id IS NOT NULL`,
    [input.name, mirror.chartType, mirror.config, JSON.stringify(input.canvas), tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Chuyển một báo cáo sang thư mục khác — §10.25. `folderId = null` là về Chung.
 *
 * Trả về số dòng ĐỤNG TỚI, và nơi gọi phải đọc con số đó: 0 nghĩa là báo cáo
 * không thuộc tổ chức này hoặc đã bị xoá mềm, và cả hai đều phải ra 404 chứ
 * không phải một câu "đã chuyển" cho một việc chưa xảy ra.
 *
 * ⚠️ Câu này KHÔNG tự kiểm thư mục đích có cùng workspace với báo cáo hay
 * không — khoá ngoại chỉ buộc thư mục tồn tại, không buộc nó đúng chỗ. Việc đó
 * do route làm trước khi gọi, vì chỉ ở đó mới có đủ ngữ cảnh để trả về một câu
 * lỗi đọc được. Thiếu bước ấy thì một báo cáo biến mất khỏi mọi danh sách: nó
 * nằm trong một thư mục thuộc workspace mà người dùng đang không mở.
 */
export async function moveReport(
  db: Db,
  tenantId: number,
  id: number,
  folderId: number | null,
): Promise<number> {
  /*
   * `updated_at = updated_at` GIỮ NGUYÊN mốc sửa đổi, và đó là chủ ý.
   *
   * Cột này khai `ON UPDATE CURRENT_TIMESTAMP(3)`, nên một câu UPDATE bình
   * thường sẽ dập mốc cũ. Nhưng cột hiện ra ở tab Báo cáo tên là "Cập nhật lần
   * cuối" và người đọc hiểu nó là "lần cuối ai đó SỬA báo cáo này" — xếp lại
   * mười báo cáo vào thư mục không phải là sửa mười báo cáo. Để mặc thì danh
   * sách (sắp theo `updated_at DESC`) xáo tung ngay sau một buổi dọn dẹp, và
   * lịch sử sửa thật bị xoá mà không ai đổi lấy được gì.
   *
   * Gán tường minh chính nó là cách MySQL cho phép chặn `ON UPDATE`.
   */
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE reports SET folder_id = ?, updated_at = updated_at
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [folderId, tenantId, id],
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
