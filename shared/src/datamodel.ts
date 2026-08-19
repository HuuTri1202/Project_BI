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
 * Phép nối hai thước đo trong một thước đo TÍNH TOÁN — §10.6.
 *
 * ─── Vì sao là bốn phép chọn sẵn, không phải một ô nhập công thức ───────────
 *
 * Cả §9 lẫn §10 dựng trên một nguyên tắc: KHÔNG một ký tự nào của người dùng đi
 * vào câu lệnh SQL. Tên bảng sinh từ hai số nguyên, tên cột qua `quoteIdent`,
 * Explorer chỉ nhận ID. Một ô nhập công thức tự do phá đúng nguyên tắc đó, và
 * phá ở chỗ khó vá nhất — biểu thức người dùng gõ phải đi thẳng vào `sql:` của
 * file cube.
 *
 * Bốn phép và hai toán hạng là ID thì công thức dựng hoàn toàn từ dữ liệu của
 * ta. Cái giá: không viết được `CASE WHEN`. Cái được: không có đường nào để một
 * chuỗi lạ chạm tới kho.
 */
export const MEASURE_OPS = ['add', 'sub', 'mul', 'div'] as const;
export type MeasureOp = (typeof MEASURE_OPS)[number];

export const MEASURE_OP_LABELS: Record<MeasureOp, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
};

/** Cách ĐỌC con số, không đổi con số. `percent` hiển thị 0,283 thành 28,3 %. */
export const MEASURE_FORMATS = ['number', 'percent'] as const;
export type MeasureFormat = (typeof MEASURE_FORMATS)[number];

export const MEASURE_FORMAT_LABELS: Record<MeasureFormat, string> = {
  number: 'Số thường',
  percent: 'Phần trăm',
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

export interface DataModelColumnDto {
  id: number;
  /** Tên cột NGUYÊN VĂN trong ClickHouse. Đây là thứ đi vào SQL. */
  columnName: string;
  /** Tên người dùng muốn thấy. Trống thì lấy `columnName`. */
  alias: string | null;
  role: ColumnRole;
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

export interface DataModelDatasetDto {
  /** Id của DÒNG NỐI, không phải id bộ dữ liệu. Mọi thứ khác trỏ vào cái này. */
  id: number;
  datasetId: number;
  /** Tên của BỘ DỮ LIỆU, dùng chung cho mọi mô hình. */
  datasetName: string;
  /**
   * Tên hiển thị RIÊNG trong mô hình này.
   *
   * Tách khỏi `datasetName` vì cùng một bộ dữ liệu có thể đóng hai vai khác nhau
   * ở hai mô hình, và đổi tên ở đây không được đụng tới tên trong Kho dữ liệu.
   */
  displayName: string | null;
  description: string | null;
  /**
   * Khoá chính NGHIỆP VỤ — cột mà các bảng khác nối tới.
   *
   * ⚠️ KHÔNG phải `primary_key` mà Cube dùng. Cube nhận `_row_index` (§9), vốn
   * chắc chắn duy nhất, để đếm đúng qua JOIN. Cột khai ở đây chỉ nói "muốn nối
   * tới bảng này thì nối vào cột này" — giao diện dùng nó để điền sẵn form quan
   * hệ. Tách hai vai để một lựa chọn sai của người dùng không làm hỏng số liệu.
   */
  primaryColumnId: number | null;
  primaryColumnName: string | null;
  /** Bảng trong ClickHouse — hiện ra để người dùng đối chiếu được. */
  chTable: string;
  canvasX: number;
  canvasY: number;
  columns: DataModelColumnDto[];
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
  /**
   * `column` = gộp một cột (`sum(Sales)`). `formula` = ghép hai thước đo khác.
   *
   * Một trường thay vì đoán qua `formula !== null`: mã đọc dữ liệu này nằm ở
   * bốn chỗ, và "suy ra kiểu từ việc một trường có null hay không" là thứ sẽ
   * lệch nhau ngay khi thêm kiểu thứ ba.
   */
  kind: 'column' | 'formula';
  format: MeasureFormat;
  /** Chỉ có khi `kind === 'formula'`. Tên hai vế kèm sẵn để khỏi tra lại. */
  formula: {
    leftId: number;
    leftName: string;
    op: MeasureOp;
    rightId: number;
    rightName: string;
  } | null;
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
/**
 * Cảnh báo phát ra khi ĐẶT khoá chính cho một bảng — §10.3.
 *
 * Cùng họ với `RelationshipWarningDto` nhưng xuất hiện sớm hơn một bước: khoá
 * chính sai làm mọi quan hệ nối vào nó nhân bản dòng, và hậu quả là những con số
 * lớn hơn sự thật mà không có lỗi nào báo ra.
 */
export interface PrimaryKeyWarningDto {
  /** Tên cột vừa khai. Cảnh báo phải nói RÕ nó là cột nào, không bắt đi tra lại. */
  columnName: string;
  /** Cột có giá trị TRÙNG — nó không phải khoá, dù người dùng vừa khai là khoá. */
  duplicateValues: boolean;
  /**
   * Số giá trị KHÁC NHAU.
   *
   * Đi kèm `rowCount` và `nullValues` là ra được số dòng dôi ra — thứ quyết định
   * MỨC ĐỘ nghiêm trọng. Một bảng 1.173 dòng dôi 1 dòng là dữ liệu nguồn có lỗi
   * nhỏ, sửa được; 51.290 dòng chỉ có 25.035 giá trị nghĩa là cột đó vốn dĩ
   * không phải khoá và phải chọn cột khác. Chỉ đưa `rowCount` thì hai ca đó đọc
   * lên giống hệt nhau.
   */
  distinctValues: number;
  /** Số dòng mang giá trị trống; chúng rơi khỏi kết quả khi nối. */
  nullValues: number;
  rowCount: number;
}

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
  datasetCount: number;
  measureCount: number;
  relationshipCount: number;
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
/**
 * Câu lệnh Cube sinh ra cho một truy vấn — §10.7.
 *
 * Tồn tại để tầng ngữ nghĩa thôi là hộp đen: người dùng chọn hai trường và nhận
 * một con số, còn phép nối nào tạo ra con số đó thì không nhìn thấy. Khi số
 * trông sai, đây là bằng chứng phân biệt "mô hình khai sai" với "dữ liệu vốn
 * thế" — thứ mà không cảnh báo nào thay được.
 */
export interface ExplorerSqlDto {
  /** SQL gửi xuống ClickHouse. Tham số còn ở dạng `?`. */
  sql: string;
  /** Giá trị thay vào các dấu `?`, theo thứ tự. */
  params: (string | number)[];
  /** Truy vấn Cube (JSON) — tầng trung gian giữa lựa chọn và SQL. */
  cubeQuery: string;
}

export interface ExplorerResultDto {
  columns: {
    id: number;
    label: string;
    kind: 'dimension' | 'measure';
    /** Chỉ có ở thước đo — quyết định cách ĐỌC con số, không đổi con số. */
    format?: MeasureFormat;
  }[];
  rows: (string | number | null)[][];
  /** Đã chạm trần số dòng: còn dữ liệu mà truy vấn không lấy hết. */
  truncated: boolean;
}

// ─── Đầu vào ─────────────────────────────────────────────────────────────────

export interface CreateDataModelInput {
  /**
   * BẮT BUỘC, dù zod phía backend vẫn nhận thiếu.
   *
   * Mỗi workspace có nội dung riêng, nên mô hình phải nằm đúng workspace người
   * dùng đang đứng. Backend có nhánh dự phòng `resolveWorkspace(undefined)`
   * nhưng nhánh đó chọn workspace ĐẦU TIÊN THEO TÊN (`ORDER BY w.name ASC`) —
   * không liên quan gì tới nơi người dùng đang làm việc.
   *
   * Hậu quả của một lần quên: mô hình rơi vào workspace khác và biến mất khỏi
   * danh sách ngay sau khi tạo. Tổ chức một workspace thì hai thứ đó tình cờ
   * trùng nhau nên lỗi không lộ ra cho tới khi có workspace thứ hai.
   *
   * Bắt buộc ở đây là để TRÌNH BIÊN DỊCH chặn, thay vì trông vào việc nhớ.
   */
  workspaceId: number;
  name: string;
  description?: string;
  /** Chỉ nhận bộ dữ liệu đã `loadStatus === 'loaded'` — chưa nạp thì chưa có bảng. */
  datasetIds: number[];
}

export interface SaveSchemaInput {
  columns: {
    columnId: number;
    alias: string | null;
    role: ColumnRole;
    /**
     * Phép gộp của thước đo dựng trên cột này.
     *
     * `null` = không có thước đo nào cho cột này. `undefined` = không đụng tới.
     * Ba trạng thái chứ không hai, vì "bỏ thước đo đi" và "để nguyên" là hai ý
     * định khác nhau và cả hai đều phải nói được.
     */
    measureAgg?: MeasureAgg | null;
  }[];
}

export interface CreateFormulaMeasureInput {
  name: string;
  leftId: number;
  op: MeasureOp;
  rightId: number;
  format: MeasureFormat;
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
  /** Thước đo đang là một vế của thước đo tính toán khác — xoá sẽ làm gãy công thức. */
  MEASURE_IN_USE: 'MeasureInUse',
  /** Hai vế của công thức thuộc hai bảng khác nhau; ghép chéo bảng cho ra tỉ lệ sai. */
  MEASURE_CROSS_DATASET: 'MeasureCrossDataset',
} as const;

export type DataModelErrorCode =
  (typeof DATAMODEL_ERROR_CODES)[keyof typeof DATAMODEL_ERROR_CODES];
