/**
 * Hợp đồng dữ liệu của kho dữ liệu — §7 (file tải lên) và §8 (kết nối CSDL).
 *
 * Mô hình:
 *   Connection (một CSDL của khách hàng)
 *        └──< Dataset  ──<  DatasetColumn
 *   File Excel/CSV trên S3
 *        └──< Dataset  ──<  DatasetColumn
 *                      └──< DatasetRow   (chỉ nguồn `file`)
 *
 * MỘT bảng `datasets` cho cả hai, phân biệt bằng cột `source`. Hai bảng riêng
 * nghĩa là hai trang danh sách, hai câu truy vấn cho mọi chỗ đếm, và một câu
 * hỏi "cái nào là cái nào" lặp lại vĩnh viễn — trong khi với người dùng thì cả
 * hai đều là "thứ tôi dựng báo cáo lên được".
 *
 * Báo cáo và biểu đồ nằm ở `report.ts`.
 */

/**
 * Loại CSDL nguồn mà nền tảng kết nối được.
 *
 * Hai loại, và đó là lựa chọn có chủ đích chứ không phải chưa kịp làm: MySQL là
 * CSDL giao dịch phổ biến nhất ở Việt Nam, ClickHouse là CSDL phân tích mà chính
 * hệ thống này hướng tới. Mỗi loại thêm vào là một driver phải bảo trì, một
 * phương ngữ metadata phải kiểm, và một nhánh nữa trong `explainError` — nên
 * danh sách chỉ dài ra khi có người thật cần.
 */
export const CONNECTION_KINDS = ['mysql', 'clickhouse'] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = {
  mysql: 'MySQL',
  clickhouse: 'ClickHouse',
};

/** Một dòng mô tả cho thẻ chọn loại CSDL ở wizard bước 2. */
export const CONNECTION_KIND_DESCRIPTIONS: Record<ConnectionKind, string> = {
  mysql: 'Cơ sở dữ liệu quan hệ phổ biến',
  clickhouse: 'Cơ sở dữ liệu OLAP dạng cột',
};

/**
 * Một kết nối, ở dạng đi ra ngoài API.
 *
 * ⚠️ CỐ Ý KHÔNG có trường mật khẩu, kể cả dạng đã che. Một trường
 * `password: '••••••'` nghe vô hại nhưng nó buộc backend phải mang mật khẩu
 * thật đi qua tầng chuyển đổi, và chỉ cần một lần quên thay bằng dấu chấm là
 * mật khẩu CSDL của khách hàng nằm trong tab Network của trình duyệt.
 */
export interface ConnectionDto {
  id: number;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  /**
   * Bọc kết nối trong TLS.
   *
   * Bắt buộc với mọi CSDL trên Internet công cộng — ClickHouse Cloud chỉ nhận
   * HTTPS ở cổng 8443 và sẽ đóng phăng socket nếu ta gửi HTTP thô vào đó. Đây là
   * TRẠNG THÁI LƯU LẠI chứ không phải suy ra từ số cổng: cổng chỉ là quy ước, và
   * đoán sai thì lỗi hiện ra là "máy chủ đóng kết nối" — câu không chỉ được ai
   * phải sửa gì.
   */
  useSsl: boolean;
  databaseName: string;
  username: string;
  /** Lần kiểm tra gần nhất thành công. `null` = chưa từng kiểm hoặc lần cuối lỗi. */
  lastTestedAt: string | null;
  /** Lý do lần kiểm tra gần nhất thất bại, hoặc `null` nếu đang tốt. */
  lastTestError: string | null;
  /** Số dataset đang trỏ tới kết nối này — dùng để chặn xoá. */
  datasetCount: number;
  createdAt: string;
}

export interface TestConnectionResultDto {
  ok: boolean;
  /** Chỉ có khi `ok` — phiên bản máy chủ, để người dùng thấy mình nối đúng nơi. */
  serverVersion?: string;
  /** Chỉ có khi `!ok` — câu tiếng Việt nói được phải sửa gì. */
  message?: string;
}

/** Nuôi bước 1 của wizard: chuẩn bị gì trước khi kết nối. */
export interface ConnectionPrerequisitesDto {
  /** IP mà CSDL của khách hàng sẽ thấy. Họ thêm nó vào tường lửa. */
  egressIp: string;
  /** Quyền tối thiểu cần cấp, theo từng loại CSDL. */
  grants: Record<ConnectionKind, string[]>;
  defaultPorts: Record<ConnectionKind, number>;
  /**
   * Giá trị gợi ý cho ô SSL khi người dùng chọn loại CSDL.
   *
   * Về từ server chứ không cứng ở frontend: nó đi cặp với `defaultPorts`, và hai
   * hằng số phải-khớp-nhau nằm ở hai kho mã khác nhau thì sớm muộn sẽ lệch.
   */
  defaultSsl: Record<ConnectionKind, boolean>;
}

/** Một bảng trong CSDL nguồn, ở hộp thoại chọn bảng để đồng bộ. */
export interface SourceTableDto {
  schema: string;
  table: string;
  /** Đã là dataset trong kho hay chưa — quyết định ô checkbox tích sẵn. */
  imported: boolean;
}

/**
 * Bộ dữ liệu đến từ đâu.
 *
 * MỘT khái niệm "bộ dữ liệu", hai nguồn. Với người dùng thì cả hai đều là "thứ
 * tôi dựng báo cáo lên được", và họ không nên phải nhớ mình đã nạp nó bằng
 * đường nào để tìm lại.
 *
 * `connection` — một bảng đồng bộ từ CSDL của khách hàng (§8). Nền tảng không
 *   giữ dòng nào; mỗi lần xem là một câu SELECT chạy trên CSDL nguồn.
 * `file`       — một sheet trong file Excel/CSV đã tải lên (§7). Dòng được nạp
 *   vào `dataset_rows`.
 *
 * Thứ tự khớp ENUM trong database, và ENUM phải nối giá trị mới vào cuối.
 */
export const DATASET_SOURCES = ['connection', 'file'] as const;
export type DatasetSource = (typeof DATASET_SOURCES)[number];

export const DATASET_SOURCE_LABELS: Record<DatasetSource, string> = {
  connection: 'Từ CSDL',
  file: 'Từ file',
};

/** Kiểu ngữ nghĩa — cột này dùng để nhóm hay để đo. Chỉ nguồn `file` suy ra. */
export const SEMANTIC_TYPES = ['text', 'number', 'date', 'boolean'] as const;
export type SemanticType = (typeof SEMANTIC_TYPES)[number];

export const FIELD_ROLES = ['dimension', 'measure'] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export interface DatasetColumnDto {
  name: string;
  /**
   * Kiểu THÔ của nguồn: `varchar(255)`, `bigint`… với CSDL; với file thì là kiểu
   * đã suy ra, viết dưới dạng chuỗi.
   */
  dataType: string;
  isNullable: boolean;
  ordinal: number;

  /* ─── Tầng ngữ nghĩa. Chỉ nguồn `file` điền, §9 sẽ dùng cho cả hai. ───── */

  /** Tên người dùng muốn thấy trên biểu đồ. Trống thì lấy `name`. */
  fieldName: string | null;
  /** Chữ / số / ngày / đúng-sai — thứ quyết định vẽ được biểu đồ gì. */
  semanticType: SemanticType | null;
  fieldRole: FieldRole | null;
  /** Người dùng có chọn nhập cột này không. */
  included: boolean;
}

/**
 * Một bộ dữ liệu.
 *
 * Các trường của §8 (`connectionId`, `sourceSchema`, `sourceTable`, `syncedAt`)
 * và của §7 (`s3Key`… ẩn, `fileExt`, `sheetName`, `rowCount`) đều CHO PHÉP NULL:
 * mỗi nguồn chỉ điền phần của mình. Đọc `source` trước rồi mới đọc phần tương
 * ứng — đó là lý do trường đó không bao giờ null.
 */
export interface DatasetDto {
  id: number;
  source: DatasetSource;
  name: string;
  /**
   * Workspace sở hữu bộ dữ liệu này.
   *
   * NULL với những bộ dữ liệu §8 tạo TRƯỚC khi hai phần được gộp — lúc đó chúng
   * ở phạm vi cả tổ chức. Giao diện gom chúng vào mục "chưa gán workspace" thay
   * vì bịa một workspace, vì bịa sai là đẩy dữ liệu sang bộ phận khác.
   */
  workspaceId: number | null;
  columnCount: number;

  /* ─── Nguồn `connection` ───────────────────────────────────────────────── */
  sourceSchema: string | null;
  sourceTable: string | null;
  syncedAt: string | null;
  connectionId: number | null;
  connectionName: string | null;
  connectionKind: ConnectionKind | null;

  /* ─── Nguồn `file` ─────────────────────────────────────────────────────── */
  /** Tên file người dùng tải lên. `s3_key` cố ý KHÔNG phơi ra ngoài. */
  originalFilename: string | null;
  fileExt: FileExt | null;
  fileSizeBytes: number;
  /** Sheet nào trong file — một file nhiều sheet sinh ra nhiều bộ dữ liệu. */
  sheetName: string | null;
  status: DatasetStatus;
  errorMessage: string | null;
  rowCount: number;
  /**
   * Đã chạm trần số dòng và bị cắt bớt.
   *
   * Giao diện PHẢI hiện điều này. `rowCount` một mình nói dối: 50000 có thể là
   * "file có đúng 50000 dòng" hoặc "file có nửa triệu dòng và ta lấy 50000 đầu".
   * Để người ta tin vào một biểu đồ thiếu chín phần mười dữ liệu là kiểu sai tệ
   * nhất trong một sản phẩm BI.
   */
  truncated: boolean;

  /**
   * Số mô hình dữ liệu đang dùng dataset này.
   *
   * LUÔN bằng 0 cho tới Section 09 — bảng `datamodels` chưa tồn tại. Giữ trường
   * này ngay từ bây giờ để lúc có mô hình thật thì giao diện không phải đổi
   * hợp đồng API.
   */
  datamodelCount: number;
}

export interface DatasetDetailDto extends DatasetDto {
  columns: DatasetColumnDto[];
}

/**
 * Một ô trong bảng xem trước.
 *
 * Chỉ bốn kiểu, vì đây là thứ đã đi qua `JSON.stringify` rồi mới tới trình duyệt.
 * Ngày giờ, số thập phân độ chính xác cao, chuỗi nhị phân… đều được driver ép về
 * chuỗi TRƯỚC khi rời khỏi backend — xem `toCell` trong từng driver.
 */
export type DatasetCellValue = string | number | boolean | null;

/**
 * Vài dòng đầu của bảng nguồn, đọc TRỰC TIẾP lúc người dùng mở trang.
 *
 * ⚠️ Đây KHÔNG phải dữ liệu đã nhập về kho. Nền tảng này không giữ bản sao dòng
 * nào — mỗi lần mở tab "Dữ liệu" là một câu `SELECT … LIMIT` chạy trên CSDL của
 * khách hàng. Vì thế cũng KHÔNG có tổng số dòng: `COUNT(*)` trên một bảng vài
 * chục triệu dòng là một lần quét toàn bảng, và không ai đáng phải trả giá đó
 * chỉ để trang hiện được con số "của 51.290".
 */
export interface DatasetPreviewDto {
  /** Tên cột theo đúng thứ tự CSDL nguồn trả về. */
  columns: string[];
  rows: DatasetCellValue[][];
  /** Số dòng tối đa đã yêu cầu. Nhận đủ chừng này nghĩa là bảng còn nữa. */
  limit: number;
}

/** Kết quả một lần bấm Đồng bộ (§8.8). */
export interface SyncResultDto {
  added: string[];
  updated: string[];
  unchanged: string[];
  failed: { table: string; reason: string }[];
}

// ─── Nguồn `file`: tải lên, phân tích, chốt sheet (§7.2 – §7.6) ──────────────

export const FILE_EXTS = ['csv', 'xlsx'] as const;
export type FileExt = (typeof FILE_EXTS)[number];

/**
 * Vòng đời của một bộ dữ liệu.
 *
 * `pending` chỉ nguồn `file` mới đi qua: bản ghi được tạo lúc xin presigned URL,
 * trước khi biết file có lên tới nơi không. Bộ dữ liệu §8 sinh ra đã `ready`.
 *
 * `failed` giữ lại kèm `errorMessage` thay vì xoá: xoá đi thì người dùng tải
 * file lên, thấy màn hình lỗi, bấm F5 và không còn dấu vết nào của việc vừa xảy
 * ra.
 */
export const DATASET_STATUSES = ['pending', 'ready', 'failed'] as const;
export type DatasetStatus = (typeof DATASET_STATUSES)[number];

export interface CreateUploadResultDto {
  datasetId: number;
  /** Presigned URL. Trình duyệt PUT thẳng vào đây, không qua backend. */
  uploadUrl: string;
  expiresAt: string;
}

/** Một cột như nó xuất hiện trong file, TRƯỚC khi người dùng chốt. */
export interface SheetColumnDto {
  columnIndex: number;
  sourceName: string;
  /** Kiểu do hệ thống ĐOÁN. */
  semanticType: SemanticType;
  /** Vài giá trị đầu, để người dùng đối chiếu bằng mắt xem đoán có đúng không. */
  samples: string[];
}

export interface SheetPreviewDto {
  name: string;
  columns: SheetColumnDto[];
  /** Số dòng dữ liệu, không tính hàng tiêu đề. */
  rowCount: number;
  previewRows: string[][];
}

/**
 * Kết quả phân tích file. KHÔNG ghi gì vào database.
 *
 * Trả MỌI sheet cùng lúc: bước 2 cho tích nhiều sheet, nên tất cả phải có mặt.
 * Tải lại file 50MB từ S3 rồi parse lại cho mỗi lần bấm là không chấp nhận được.
 */
export interface AnalyzeResultDto {
  sheets: SheetPreviewDto[];
  /** Vượt trần thì chỉ những dòng đầu được đọc — nói ngay từ bước xem trước. */
  truncated: boolean;
  maxRows: number;
  /**
   * Số dòng có trong `previewRows`.
   *
   * Đây là trần của việc XEM, không phải của việc nhập. Hai con số khác nhau và
   * giao diện phải nói rõ — thấy 100 rồi tin rằng hệ thống chỉ nhập chừng đó là
   * hiểu nhầm rất dễ xảy ra.
   */
  previewRowLimit: number;
}

/**
 * Chốt các sheet đã tích.
 *
 * MỖI SHEET thành MỘT bộ dữ liệu riêng. Cùng một file trên S3 sẽ có nhiều bản
 * ghi `datasets` trỏ vào — nên xoá một bộ dữ liệu KHÔNG được xoá file.
 *
 * Cố ý không có danh sách cột: mọi cột đều được nhập và kiểu do hệ thống suy
 * luận. Bỏ bước chọn cột làm wizard ngắn hẳn; đổi lại kiểu đoán sai phải sửa ở
 * trang chi tiết — việc còn NỢ.
 */
export interface CommitDatasetsInput {
  sheets: string[];
  name: string;
}

export const DATASET_NAME_MAX = 255;

/** Trần mặc định, khớp `UPLOAD_MAX_BYTES` phía backend. */
export const UPLOAD_MAX_BYTES = 52_428_800;

export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'] as const;

export const DATASET_ERROR_CODES = {
  FILE_TOO_LARGE: 'FileTooLarge',
  UNSUPPORTED_FORMAT: 'UnsupportedFormat',
  CORRUPT_FILE: 'CorruptFile',
  UPLOAD_NOT_FINISHED: 'UploadNotFinished',
  NO_COLUMNS_SELECTED: 'NoColumnsSelected',
  DATASET_NOT_READY: 'DatasetNotReady',
  /**
   * Thao tác chỉ dành cho một nguồn.
   *
   * Ví dụ: đọc dòng của một bộ dữ liệu nguồn `connection` — nền tảng không giữ
   * dòng nào của nó.
   */
  WRONG_DATASET_SOURCE: 'WrongDatasetSource',
} as const;

export type DatasetErrorCode = (typeof DATASET_ERROR_CODES)[keyof typeof DATASET_ERROR_CODES];

export const CONNECTION_ERROR_CODES = {
  /** Kết nối còn dataset nên không xoá được. */
  CONNECTION_IN_USE: 'ConnectionInUse',
  /** Host trỏ vào mạng nội bộ hoặc không phân giải được. */
  INVALID_HOST: 'InvalidHost',
  /** Không mở được kết nối tới CSDL nguồn. */
  CONNECTION_FAILED: 'ConnectionFailed',
} as const;
