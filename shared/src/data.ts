/**
 * Hợp đồng dữ liệu của §8 — Kết nối CSDL & Kho dữ liệu.
 *
 * Mô hình:
 *   Connection (một CSDL của khách hàng)
 *        └──< Dataset (một bảng nguồn)
 *                 └──< DatasetColumn
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

export interface DatasetColumnDto {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinal: number;
}

export interface DatasetDto {
  id: number;
  name: string;
  sourceSchema: string;
  sourceTable: string;
  columnCount: number;
  syncedAt: string | null;
  connectionId: number;
  connectionName: string;
  connectionKind: ConnectionKind;
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

export const CONNECTION_ERROR_CODES = {
  /** Kết nối còn dataset nên không xoá được. */
  CONNECTION_IN_USE: 'ConnectionInUse',
  /** Host trỏ vào mạng nội bộ hoặc không phân giải được. */
  INVALID_HOST: 'InvalidHost',
  /** Không mở được kết nối tới CSDL nguồn. */
  CONNECTION_FAILED: 'ConnectionFailed',
} as const;
