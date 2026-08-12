/**
 * Hợp đồng dữ liệu của luồng "tải file lên → bộ dữ liệu → báo cáo" (§7).
 *
 * Mô hình:
 *   Workspace ──< Dataset ──< DatasetColumn      (schema + tầng ngữ nghĩa)
 *                    │    └──< DatasetRow        (dữ liệu thật, JSON)
 *                    └──────< Report             (một biểu đồ dựng trên nó)
 *
 * §7.6 vẽ ba tầng Dataset → DataModel → Report. DataModel KHÔNG có bảng riêng:
 * phần nó đóng góp là ánh xạ "cột trong file → field nghiệp vụ" cùng việc phân
 * loại chiều/thước đo, và cả hai nằm trên `DatasetColumnDto`. Một bảng riêng chỉ
 * để trỏ tới dataset là một tầng rỗng. Xem ghi chú đầy đủ ở migration 6.
 */

/** Bốn kiểu suy luận được từ nội dung file. Cố ý ít — đây không phải SQL. */
export const DATA_TYPES = ['text', 'number', 'date', 'boolean'] as const;
export type DataType = (typeof DATA_TYPES)[number];

/**
 * Vai trò của một cột trong biểu đồ.
 *
 * `dimension` để nhóm và đặt lên trục ngang (tên sản phẩm, tháng).
 * `measure` để cộng/đếm và đặt lên trục dọc (doanh thu, số lượng).
 *
 * Đây là phần "DataModel" của §7.6, và là lý do bước 2 của wizard không chỉ là
 * một danh sách ô tích: người dùng đang mô tả Ý NGHĨA của cột, không chỉ chọn
 * giữ hay bỏ.
 */
export const FIELD_ROLES = ['dimension', 'measure'] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const DATASET_STATUSES = ['pending', 'ready', 'failed'] as const;
export type DatasetStatus = (typeof DATASET_STATUSES)[number];

export const FILE_EXTS = ['csv', 'xlsx'] as const;
export type FileExt = (typeof FILE_EXTS)[number];

/**
 * Nguồn file. Ứng dụng CHỈ sinh ra `device` — file từ máy người dùng.
 *
 * Google Drive, OneDrive và SharePoint đã bị bỏ khỏi §7.2 và không còn giao diện
 * nào tạo ra chúng.
 *
 * ⚠️ Cột `datasets.source_type` trong database vẫn khai đủ bốn giá trị. Cố ý
 * KHÔNG thu hẹp lại: migration 6 đã chạy trên các máy có sẵn, và sửa một
 * migration đã áp dụng là cách làm hai máy ra hai schema khác nhau mà không ai
 * biết — đúng điều cảnh báo ở đầu `db/migrations.ts`. Ba giá trị thừa không tốn
 * gì (MySQL lưu ENUM theo số thứ tự) và để sẵn chỗ nếu sau này mở lại.
 *
 * Danh sách ở đây hẹp hơn database là ĐÚNG hướng: nó chặn ở tầng validate, nên
 * không đường nào ghi được một giá trị mà giao diện không tạo ra.
 */
export const SOURCE_TYPES = ['device'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'table'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Biểu đồ cột',
  line: 'Biểu đồ đường',
  area: 'Biểu đồ miền',
  pie: 'Biểu đồ tròn',
  table: 'Bảng số liệu',
};

/** Phép tổng hợp khi nhiều dòng rơi vào cùng một nhóm. */
export const AGGREGATES = ['sum', 'avg', 'count', 'min', 'max'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  sum: 'Tổng',
  avg: 'Trung bình',
  count: 'Đếm',
  min: 'Nhỏ nhất',
  max: 'Lớn nhất',
};

// ─── Cột ─────────────────────────────────────────────────────────────────────

export interface DatasetColumnDto {
  id: number;
  /** Vị trí trong file gốc, đếm từ 0. */
  columnIndex: number;
  /** Tên nguyên văn ở hàng tiêu đề, ví dụ `SL_BAN`. */
  sourceName: string;
  /** Tên người dùng đặt lại, ví dụ `Số lượng bán` (§7.5). */
  fieldName: string;
  dataType: DataType;
  fieldRole: FieldRole;
  /** Người dùng có chọn nhập cột này không (§7.5). */
  included: boolean;
}

// ─── Bộ dữ liệu ──────────────────────────────────────────────────────────────

export interface DatasetDto {
  id: number;
  workspaceId: number;
  name: string;
  originalFilename: string;
  fileExt: FileExt;
  fileSizeBytes: number;
  sourceType: SourceType;
  sheetName: string | null;
  status: DatasetStatus;
  errorMessage: string | null;
  rowCount: number;
  /**
   * Đã chạm trần `DATASET_MAX_ROWS` và bị cắt bớt.
   *
   * Giao diện PHẢI hiện điều này. `rowCount` một mình nói dối: 50000 có thể là
   * "file có đúng 50000 dòng" hoặc "file có nửa triệu dòng và ta lấy 50000 đầu".
   * Để người ta tin vào một biểu đồ thiếu chín phần mười dữ liệu là kiểu sai tệ
   * nhất trong một sản phẩm BI.
   */
  truncated: boolean;
  /** Số cột đã nhập. Cùng `rowCount` và `sheetName` tạo thành metadata của §7.6. */
  columnCount: number;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Bộ dữ liệu kèm schema — dùng ở bước 2 của wizard và ở trang chi tiết. */
export interface DatasetDetailDto {
  dataset: DatasetDto;
  columns: DatasetColumnDto[];
}

// ─── Bước 1 → 2: xin URL rồi phân tích file ──────────────────────────────────

export interface CreateUploadResultDto {
  datasetId: number;
  /** Presigned URL. Trình duyệt PUT thẳng vào đây, không qua backend. */
  uploadUrl: string;
  expiresAt: string;
}

/** Một cột như nó xuất hiện trong file, TRƯỚC khi người dùng chỉnh sửa. */
export interface SheetColumnDto {
  columnIndex: number;
  sourceName: string;
  /** Kiểu do hệ thống ĐOÁN. Người dùng sửa được ở bước 2 — xem ghi chú dưới. */
  dataType: DataType;
  /** Vài giá trị đầu, để người dùng đối chiếu bằng mắt xem đoán có đúng không. */
  samples: string[];
}

export interface SheetPreviewDto {
  name: string;
  columns: SheetColumnDto[];
  /** Số dòng dữ liệu (không tính hàng tiêu đề). */
  rowCount: number;
  /** Vài dòng đầu để dựng bảng xem trước. */
  previewRows: string[][];
}

/**
 * Kết quả phân tích file. KHÔNG ghi gì vào database.
 *
 * Trả về MỌI sheet cùng lúc — bước 2 cho người dùng tích nhiều sheet một lúc,
 * nên tất cả phải có mặt để hiện danh sách kèm số cột, số dòng và bảng xem
 * trước. Tải lại file 50MB từ S3 rồi parse lại cho mỗi lần bấm là không chấp
 * nhận được.
 */
export interface AnalyzeResultDto {
  sheets: SheetPreviewDto[];
  /** Vượt trần thì chỉ những dòng đầu được đọc — nói ngay từ bước xem trước. */
  truncated: boolean;
  maxRows: number;
  /**
   * Số dòng có trong `previewRows`.
   *
   * Đây là trần của việc XEM TRƯỚC, không phải của việc nhập: khi chốt, toàn bộ
   * dòng được nạp (tới `maxRows`). Hai con số khác nhau và giao diện phải nói rõ
   * bằng dòng chữ "Đang xem 100 dòng đầu" — nếu không, người dùng thấy 100 rồi
   * tin rằng hệ thống chỉ nhập chừng đó.
   */
  previewRowLimit: number;
}

// ─── Bước 2 → 3: chốt sheet rồi nạp dữ liệu ─────────────────────────────────

/**
 * Yêu cầu nhập dữ liệu.
 *
 * MỖI SHEET được tích thành MỘT bộ dữ liệu riêng (§7.5). Cùng một file trên S3
 * sẽ có nhiều bản ghi `datasets` trỏ vào — xem migration 7.
 *
 * Cố ý KHÔNG có danh sách cột: từ bản cập nhật của §7.5, mọi cột đều được nhập
 * và kiểu do hệ thống suy luận. Bỏ bước chọn cột làm wizard ngắn hẳn, đổi lại
 * người dùng không sửa được kiểu đoán sai ngay tại đây — màn hình sửa lại kiểu
 * ở trang chi tiết bộ dữ liệu là việc còn NỢ.
 */
export interface CommitDatasetsInput {
  /** Tên sheet được tích. Ít nhất một. */
  sheets: string[];
  /**
   * Tên gốc cho các bộ dữ liệu. Nhiều sheet thì hệ thống nối thêm tên sheet để
   * chúng phân biệt được trong danh sách.
   */
  name: string;
}

// ─── Báo cáo ─────────────────────────────────────────────────────────────────

/**
 * Cấu hình biểu đồ.
 *
 * Lưu thành JSON chứ không trải ra thành cột: mỗi loại biểu đồ cần một bộ tham
 * số khác nhau, và biểu đồ tròn không có trục X. Trải thành cột nghĩa là phần
 * lớn cột luôn NULL, và thêm một loại biểu đồ là một migration.
 */
export interface ReportConfigDto {
  /** Cột dùng để nhóm — trục ngang, hoặc lát cắt của biểu đồ tròn. */
  dimension: string;
  /** Cột được đo — trục dọc. `null` khi phép tổng hợp là `count`. */
  measure: string | null;
  aggregate: Aggregate;
  /** Số nhóm tối đa hiện trên biểu đồ, phần còn lại gộp thành "Khác". */
  limit: number;
}

/**
 * Một báo cáo.
 *
 * `chartType` và `config` là `null` khi báo cáo mới được wizard tạo ra và CHƯA
 * ai dựng biểu đồ (§7.6). Đó là trạng thái bình thường, không phải dữ liệu
 * hỏng — trang Report hiện lời mời dựng biểu đồ thay vì một biểu đồ trống.
 *
 * Hai trường đi CÙNG NHAU: có cấu hình thì có loại biểu đồ, và ngược lại. Không
 * có tình huống một cái null một cái không.
 */
export interface ReportDto {
  id: number;
  workspaceId: number;
  datasetId: number;
  datasetName: string;
  name: string;
  chartType: ChartType | null;
  config: ReportConfigDto | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tạo báo cáo cho MỘT bộ dữ liệu.
 *
 * CHỈ có `datasetId` và `name` — §7.6 nói rõ wizard tạo "bản ghi Report rỗng,
 * chưa có biểu đồ". Loại biểu đồ và cấu hình trục là việc người dùng làm sau
 * trên trang Report, qua `UpdateReportInput`.
 *
 * Cố ý KHÔNG cho gửi kèm cấu hình ở đây, kể cả tuỳ chọn: mỗi sheet có bộ cột
 * riêng nên wizard không thể đoán hộ, và một cấu hình đoán bừa trông y hệt một
 * cấu hình người dùng đã chọn.
 */
export interface CreateReportInput {
  datasetId: number;
  name: string;
}

/** Dựng hoặc sửa biểu đồ của một báo cáo — trang Report, không phải wizard. */
export interface UpdateReportInput {
  name: string;
  chartType: ChartType;
  config: ReportConfigDto;
}

/** Dữ liệu đã tổng hợp sẵn cho biểu đồ — frontend không tính lại gì. */
export interface ReportDataDto {
  rows: { label: string; value: number }[];
  /** Nhãn trục, lấy từ `fieldName` người dùng đã đặt chứ không phải tên cột gốc. */
  dimensionLabel: string;
  measureLabel: string;
  /** Có nhóm nào bị gộp vào "Khác" không. */
  grouped: boolean;
}

// ─── Mã lỗi ──────────────────────────────────────────────────────────────────

export const DATASET_ERROR_CODES = {
  /** File vượt trần dung lượng. */
  FILE_TOO_LARGE: 'FileTooLarge',
  /** Đuôi file hoặc nội dung thật không phải csv/xlsx. */
  UNSUPPORTED_FORMAT: 'UnsupportedFormat',
  /** Đọc được file nhưng nội dung hỏng, hoặc không có hàng tiêu đề. */
  CORRUPT_FILE: 'CorruptFile',
  /** Chưa tải file lên mà đã gọi phân tích. */
  UPLOAD_NOT_FINISHED: 'UploadNotFinished',
  /** Bỏ chọn hết cột thì không còn gì để nhập. */
  NO_COLUMNS_SELECTED: 'NoColumnsSelected',
  /** Bộ dữ liệu chưa ở trạng thái `ready` nên chưa dựng báo cáo được. */
  DATASET_NOT_READY: 'DatasetNotReady',
  /**
   * Báo cáo chưa được dựng biểu đồ, nên chưa có gì để tổng hợp.
   *
   * KHÔNG phải lỗi: đây là trạng thái mọi báo cáo đi qua ngay sau khi wizard tạo
   * ra nó. Giao diện hiện lời mời dựng biểu đồ chứ không hiện màn hình lỗi.
   */
  REPORT_NOT_CONFIGURED: 'ReportNotConfigured',
} as const;

export type DatasetErrorCode =
  (typeof DATASET_ERROR_CODES)[keyof typeof DATASET_ERROR_CODES];

// ─── Luật từng trường, dùng chung hai đầu ───────────────────────────────────

/**
 * Theo luật ghi trong `auth.ts`: shared chỉ chứa RULE của từng trường, không
 * chứa schema request và không chứa transform. Backend ghép chúng lại trong
 * `api/v1/schemas.ts`, frontend dùng cho react-hook-form.
 */
export const DATASET_NAME_MAX = 255;
export const REPORT_NAME_MAX = 255;

/** Trần mặc định, khớp `UPLOAD_MAX_BYTES` phía backend. */
export const UPLOAD_MAX_BYTES = 52_428_800;

export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'] as const;

/**
 * `accept` cho thẻ `<input type="file">`.
 *
 * Cả kiểu MIME lẫn đuôi file, vì Windows báo kiểu MIME của .xlsx và .csv rất
 * thất thường — Excel đã cài thì .csv thành `application/vnd.ms-excel`, chưa cài
 * thì `text/csv`, và đôi khi là chuỗi rỗng. Liệt kê đuôi file là thứ luôn đúng.
 *
 * Đây CHỈ là gợi ý cho hộp thoại chọn file. Kiểm tra thật nằm ở
 * `services/dataset/detectFormat.ts` phía server, đọc magic bytes.
 */
export const FILE_ACCEPT_ATTR = [
  '.csv',
  '.xlsx',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');
