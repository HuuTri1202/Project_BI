/**
 * Hợp đồng dữ liệu của TẦNG NGỮ NGHĨA — §10.
 *
 * Mô hình:
 *   DataModel  ──<  DataModelDataset  ──<  DataModelColumn
 *        │                   │
 *        │                   └──<  DataModelMeasure
 *        └──<  DataModelRelationship  (nối hai DataModelDataset)
 *
 * ─── Tầng này KHÔNG chứa dữ liệu ────────────────────────────────────────────
 *
 * §9 đã đưa mọi bộ dữ liệu vào một bảng `raw_*` trong ClickHouse. Những gì ở
 * đây chỉ là LỜI MÔ TẢ về dữ liệu nằm ở đó: cột nào để nhóm, cột nào để đo,
 * người dùng muốn gọi nó là gì, và hai bảng nối nhau bằng khoá nào.
 *
 * Express đọc mô tả đó để SINH RA file cube schema cho Cube.js, và Cube mới là
 * thứ dịch một câu hỏi "doanh thu theo khu vực" thành SQL chạy trên ClickHouse.
 */

/**
 * Vai trò của một cột trong mô hình.
 *
 * `hidden` phục vụ HAI việc có cùng hệ quả nên không đáng hai cột:
 *   - `_row_index` — cột hệ thống §9 thêm vào mọi bảng `raw_*`. Nó vẫn đi vào
 *     file cube làm khoá chính (Cube cần khoá chính để JOIN đếm đúng), nhưng
 *     không bao giờ được lọt vào một bộ chọn của người dùng.
 *   - Cột người dùng chủ động bỏ khỏi mô hình.
 *
 * Thứ tự khớp ENUM trong database, và ENUM phải nối giá trị mới vào cuối.
 */
export const COLUMN_ROLES = ['dimension', 'measure', 'hidden'] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  dimension: 'Chiều',
  measure: 'Thước đo',
  hidden: 'Ẩn',
};

/**
 * Kiểu của một chiều theo cách Cube hiểu.
 *
 * ⚠️ TRỰC GIAO với `ColumnRole`, và trộn hai thứ này là lỗi sẽ xảy ra trong
 * vòng một tuần nếu không tách tên rõ ràng ngay từ đầu. Một cột `Float64` chứa
 * mã sản phẩm hoàn toàn có thể mang `role: 'dimension'` mà `cubeType: 'number'`
 * — "dùng để nhóm" và "chứa chữ số" là hai câu khác nhau.
 */
export const CUBE_TYPES = ['string', 'number', 'time', 'boolean'] as const;
export type CubeType = (typeof CUBE_TYPES)[number];

/** Phép tổng hợp của một thước đo (§10.6). Khớp `AGGREGATES` của báo cáo. */
export const MEASURE_AGGS = ['sum', 'avg', 'count', 'min', 'max'] as const;
export type MeasureAgg = (typeof MEASURE_AGGS)[number];

export const MEASURE_AGG_LABELS: Record<MeasureAgg, string> = {
  sum: 'Tổng',
  avg: 'Trung bình',
  count: 'Đếm dòng',
  min: 'Nhỏ nhất',
  max: 'Lớn nhất',
};

/**
 * Hướng của một quan hệ — quyết định Cube sinh JOIN kiểu gì.
 *
 * CỐ Ý không có `many_to_many`: Cube cần một bảng trung gian cho quan hệ đó, và
 * sinh join nhiều-nhiều không có bảng cầu nối cho ra tổng bị NHÂN LÊN trong im
 * lặng — kiểu sai tệ nhất, vì số vẫn ra và trông vẫn hợp lý.
 */
export const RELATIONSHIP_KINDS = ['one_to_many', 'many_to_one', 'one_to_one'] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_KIND_LABELS: Record<RelationshipKind, string> = {
  one_to_many: 'Một → nhiều',
  many_to_one: 'Nhiều → một',
  one_to_one: 'Một → một',
};

/** Nhãn ngắn vẽ trên đường nối của canvas. Luôn là CHỮ, không phải ký hiệu. */
export const RELATIONSHIP_KIND_SHORT: Record<RelationshipKind, string> = {
  one_to_many: '1..n',
  many_to_one: 'n..1',
  one_to_one: '1..1',
};

// ─── Bộ dữ liệu trong mô hình ────────────────────────────────────────────────

/**
 * Phép tính của một FIELD TÍNH TOÁN — §8.3.1.
 *
 * Mỗi cột SỐ tự sinh ra bốn field: `<cột>_count`, `<cột>_countDistinct`,
 * `<cột>_sum`, `<cột>_avg`. Chúng CHÍNH LÀ thước đo — không còn một bảng
 * "measures" riêng để hai nơi cùng định nghĩa một thứ.
 */
export const CALC_AGGS = ['count', 'countDistinct', 'sum', 'avg'] as const;
export type CalcAgg = (typeof CALC_AGGS)[number];

export const CALC_AGG_LABELS: Record<CalcAgg, string> = {
  count: 'Count',
  countDistinct: 'Count Distinct',
  sum: 'Sum',
  avg: 'Average',
};

export interface DataModelColumnDto {
  id: number;
  /** Tên cột NGUYÊN VĂN trong ClickHouse, hoặc `<cột>_sum` với field tính toán. */
  columnName: string;
  /** Giữ lại từ §10; `displayName` mới là thứ giao diện dùng. */
  alias: string | null;
  /** Tên hiển thị người dùng đặt. Trống thì lấy `columnName`. */
  displayName: string | null;
  description: string | null;
  /**
   * Tắt = ẩn field khỏi DataModel.
   *
   * TÁCH khỏi `role`: một field có thể là thước đo mà vẫn bị ẩn. Gộp hai thứ
   * lại thì bật lại một field đã ẩn sẽ mất thông tin nó vốn là chiều hay thước
   * đo.
   */
  visible: boolean;
  role: ColumnRole;
  /** `null` = cột thật trong kho. Khác null = field TÍNH TOÁN. */
  calcAgg: CalcAgg | null;
  /** Cột số mà field tính toán này dựng lên. `null` với cột thật. */
  sourceColumnId: number | null;
  /** Kiểu ClickHouse đầy đủ, đọc từ `system.columns` lúc xem. */
  chType: string;
  cubeType: CubeType;
  ordinal: number;
  /**
   * Kiểu đã ĐỔI so với lúc phân loại.
   *
   * Nạp lại bộ dữ liệu có thể biến `Int64` thành `String`, và khi đó một thước
   * đo `sum()` dựng trên cột này đang chạy trên văn bản. Giao diện phải nói ra,
   * không để người dùng tự phát hiện qua một con số lạ.
   */
  typeChanged: boolean;
}

/**
 * Một SCHEMA — §8.3.
 *
 * Sinh ra từ đúng một Dataset (§8.2), nên "Schema" và "bộ dữ liệu trong mô
 * hình" là một khái niệm nhìn từ hai phía. Có trang chi tiết riêng.
 */
export interface DataModelDatasetDto {
  /** Id của DÒNG NỐI, không phải id bộ dữ liệu. Mọi thứ khác trỏ vào cái này. */
  id: number;
  datasetId: number;
  datasetName: string;
  /** Bảng trong ClickHouse — hiện ra để người dùng đối chiếu được. */
  chTable: string;
  canvasX: number;
  canvasY: number;
  /** Cột thật VÀ field tính toán, chung một danh sách. */
  columns: DataModelColumnDto[];
}

/** Một dòng trong bảng danh sách Schema (§8.3). */
export interface SchemaListItemDto {
  id: number;
  datasetId: number;
  name: string;
  chTable: string;
  /** Cột thật đọc được từ kho. */
  columnCount: number;
  /** Field tính toán tự sinh. */
  calcFieldCount: number;
  /** Field đang bật Visibility. */
  visibleCount: number;
}

// ─── Thước đo (§10.6) ────────────────────────────────────────────────────────

export interface DataModelMeasureDto {
  id: number;
  name: string;
  agg: MeasureAgg;
  /** Dòng nối chứa cột được đo. */
  datamodelDatasetId: number;
  datasetName: string;
  /** `null` KHI VÀ CHỈ KHI `agg === 'count'` — đếm dòng không đo cột nào. */
  columnId: number | null;
  columnName: string | null;
  createdAt: string;
}

// ─── Quan hệ (§10.4, §10.5) ──────────────────────────────────────────────────

export interface RelationshipEndDto {
  /** Id dòng nối `datamodel_datasets`. */
  datasetRef: number;
  datasetName: string;
  columnId: number;
  columnName: string;
}

export interface DataModelRelationshipDto {
  id: number;
  left: RelationshipEndDto;
  right: RelationshipEndDto;
  kind: RelationshipKind;
  createdAt: string;
}

/**
 * Cảnh báo phát ra khi LƯU một quan hệ, không phải khi truy vấn.
 *
 * Nối trên một cột có giá trị TRÙNG ở phía "một" sẽ nhân bản mọi dòng bên kia,
 * và mọi phép SUM sau đó lớn hơn sự thật. Cube không phát hiện được, ClickHouse
 * không phàn nàn, biểu đồ chỉ hiện một con số sai trông rất hợp lý. Đây gần như
 * chắc chắn là nguồn của câu "số bị sai" đầu tiên người dùng gặp ở §10.
 *
 * Cảnh báo chứ KHÔNG chặn: nối qua bảng cầu nối là trường hợp hợp lệ và cũng
 * cho ra khoá trùng.
 */
export interface RelationshipWarningDto {
  /** Khoá bên "một" có giá trị trùng — tổng sau khi nối có thể bị nhân lên. */
  duplicateKeys: boolean;
  /** Số dòng có khoá `NULL`; chúng rơi khỏi kết quả JOIN trong im lặng. */
  nullKeys: number;
}

// ─── Mô hình ─────────────────────────────────────────────────────────────────

export interface DataModelDto {
  id: number;
  workspaceId: number;
  name: string;
  description: string | null;
  /** "Dataset Quantity" ở bảng §8.1 — cũng chính là số Schema. */
  datasetCount: number;
  measureCount: number;
  relationshipCount: number;
  /**
   * "Related Reports" ở bảng §8.1 — số báo cáo dựng trên bộ dữ liệu của mô hình.
   *
   * Đếm qua `datasets` chứ không qua `datamodels`: báo cáo (§7.6) trỏ tới một
   * bộ dữ liệu, chưa trỏ tới mô hình. Con số này trả lời đúng câu người dùng
   * hỏi — "xoá mô hình này thì đụng tới cái gì".
   */
  reportCount: number;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataModelDetailDto extends DataModelDto {
  datasets: DataModelDatasetDto[];
  measures: DataModelMeasureDto[];
  relationships: DataModelRelationshipDto[];
}

// ─── Nạp cho bộ chọn của Explorer (§10.7) ────────────────────────────────────

/**
 * Danh sách phẳng những gì hỏi được, ĐÃ gộp cột và thước đo của mọi bảng.
 *
 * Một request thay vì bắt Explorer tự ghép `/schema` với `/measures` — và quan
 * trọng hơn: frontend KHÔNG BAO GIỜ thấy tên cube. Nó gửi id, Express dựng tên.
 * Nhờ vậy đổi quy ước đặt tên cube không phải là thay đổi phá vỡ API.
 */
export interface ExplorerFieldDto {
  id: number;
  label: string;
  /** Tên bảng, để bộ chọn gom nhóm cho dễ tìm. */
  datasetName: string;
  cubeType: CubeType;
}

export interface ExplorerFieldsDto {
  dimensions: ExplorerFieldDto[];
  measures: ExplorerFieldDto[];
}

export const TIME_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

export const TIME_GRANULARITY_LABELS: Record<TimeGranularity, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};

/**
 * Một câu hỏi gửi tới Explorer.
 *
 * ⚠️ TOÀN BỘ là id của dòng trong MySQL của ta — không một tên cube, tên bảng
 * hay tên cột nào đi từ trình duyệt xuống. Express tra id trong phạm vi mô hình
 * đã được lọc theo tổ chức, rồi TỰ DỰNG tên cube. Đây là lớp chặn chính của
 * việc cách ly tổ chức, cùng nguyên tắc với `aggregateWarehouse`: chuỗi đi vào
 * truy vấn lấy từ database của ta, không phải từ body request.
 */
export interface ExplorerQueryDto {
  dimensionIds: number[];
  measureIds: number[];
  /**
   * `| undefined` tường minh vì `tsconfig` bật `exactOptionalPropertyTypes`:
   * ở chế độ đó `?:` nghĩa là "vắng mặt", KHÔNG phải "có mặt với giá trị
   * undefined", mà zod thì trả về đúng cái thứ hai.
   */
  timeDimension?: { dimensionId: number; granularity: TimeGranularity } | undefined;
  limit?: number | undefined;
}

/** Kết quả đã dịch ngược về id — Explorer không cần biết Cube gọi chúng là gì. */
export interface ExplorerResultDto {
  columns: { id: number; label: string; kind: 'dimension' | 'measure' }[];
  rows: (string | number | null)[][];
  /** Đã chạm trần số dòng: còn dữ liệu mà truy vấn không lấy hết. */
  truncated: boolean;
}

// ─── Đầu vào ─────────────────────────────────────────────────────────────────

export interface CreateDataModelInput {
  workspaceId?: number;
  name: string;
  description?: string;
  /** Chỉ nhận bộ dữ liệu đã `loadStatus === 'loaded'` — chưa nạp thì chưa có bảng. */
  datasetIds: number[];
}

export interface SaveSchemaInput {
  columns: { columnId: number; alias: string | null; role: ColumnRole }[];
}

/** Sửa một field ở trang chi tiết Schema — §8.3.1. */
export interface UpdateFieldInput {
  visible?: boolean;
  description?: string | null;
  displayName?: string | null;
}

/** Kết quả bấm Sync ở tab Schemas — đọc lại ClickHouse rồi so với bản đã lưu. */
export interface SchemaSyncResultDto {
  added: string[];
  removed: string[];
  typeChanged: string[];
  /** Field tính toán sinh thêm cho những cột số vừa xuất hiện. */
  calcFieldsAdded: number;
}

export interface CreateRelationshipInput {
  leftId: number;
  leftColumnId: number;
  rightId: number;
  rightColumnId: number;
  kind: RelationshipKind;
}

export interface CreateMeasureInput {
  datamodelDatasetId: number;
  name: string;
  agg: MeasureAgg;
  /** Bỏ trống KHI VÀ CHỈ KHI `agg === 'count'`. */
  columnId?: number;
}

export interface SaveLayoutInput {
  positions: { id: number; x: number; y: number }[];
}

export const DATAMODEL_NAME_MAX = 255;
export const MEASURE_NAME_MAX = 255;

export const DATAMODEL_ERROR_CODES = {
  /** Bộ dữ liệu chưa nạp vào kho nên chưa có bảng nào để dựng mô hình. */
  DATASET_NOT_LOADED: 'DatasetNotLoaded',
  /** Quan hệ này tạo thành đường nối thứ hai giữa hai bảng — Cube không chọn được. */
  RELATIONSHIP_CYCLE: 'RelationshipCycle',
  /** Nối một bảng với chính nó; bộ sinh schema không đặt được bí danh cube. */
  RELATIONSHIP_SELF: 'RelationshipSelf',
  /** Quan hệ y hệt đã tồn tại. */
  RELATIONSHIP_DUPLICATE: 'RelationshipDuplicate',
  /** Trường được hỏi không còn trong mô hình — mô hình đã đổi sau khi mở trang. */
  FIELD_UNKNOWN: 'DataModelFieldUnknown',
  /** Không gọi được Cube.js. Thường là chưa chạy `npm run infra:up:bi`. */
  CUBE_UNAVAILABLE: 'CubeUnavailable',
  /** Cube từ chối biên dịch mô hình — hay gặp nhất là quan hệ nối vòng. */
  SCHEMA_INVALID: 'DataModelSchemaInvalid',
  /** Không ghi được file cube schema. Sai `CUBE_SCHEMA_DIR` hoặc thiếu quyền ghi. */
  SCHEMA_UNWRITABLE: 'DataModelSchemaUnwritable',
} as const;

export type DataModelErrorCode =
  (typeof DATAMODEL_ERROR_CODES)[keyof typeof DATAMODEL_ERROR_CODES];
