import type { DatasetSource } from './data';

/**
 * Hợp đồng dữ liệu của báo cáo và biểu đồ (§7.6).
 *
 * Một báo cáo là MỘT biểu đồ dựng trên MỘT bộ dữ liệu — bất kể bộ đó đến từ file
 * hay từ kết nối CSDL. Đó là lợi ích cụ thể của việc gộp hai nguồn vào một bảng:
 * trình dựng báo cáo không cần biết dữ liệu đã vào hệ thống bằng đường nào.
 */

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
  /** Số nhóm tối đa hiện trên biểu đồ; phần còn lại gộp thành "Khác". */
  limit: number;
}

/**
 * Một báo cáo.
 *
 * `chartType` và `config` là `null` khi báo cáo mới được tạo và CHƯA ai dựng
 * biểu đồ. Đó là trạng thái bình thường, không phải dữ liệu hỏng — trang Report
 * hiện lời mời dựng biểu đồ thay vì một biểu đồ mặc định không ai yêu cầu.
 *
 * Hai trường đi CÙNG NHAU: có cấu hình thì có loại biểu đồ, và ngược lại.
 */
export interface ReportDto {
  id: number;
  workspaceId: number;
  datasetId: number;
  datasetName: string;
  /** Bộ dữ liệu đến từ đâu — để trang Report nói đúng nguồn của số liệu. */
  datasetSource: DatasetSource;
  name: string;
  chartType: ChartType | null;
  config: ReportConfigDto | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tạo báo cáo RỖNG — chỉ tên và bộ dữ liệu.
 *
 * Cố ý KHÔNG nhận loại biểu đồ hay cấu hình trục, kể cả tuỳ chọn: một cấu hình
 * đoán bừa trông y hệt một cấu hình người dùng đã chọn, nên không ai biết cái
 * nào là cái nào.
 */
export interface CreateReportInput {
  datasetId: number;
  name: string;
}

/** Dựng hoặc sửa biểu đồ — trang Report, không phải wizard. */
export interface UpdateReportInput {
  name: string;
  chartType: ChartType;
  config: ReportConfigDto;
}

/** Dữ liệu đã tổng hợp sẵn cho biểu đồ — frontend không tính lại gì. */
export interface ReportDataDto {
  rows: { label: string; value: number }[];
  /** Nhãn trục, lấy từ tên field người dùng đặt chứ không phải tên cột gốc. */
  dimensionLabel: string;
  measureLabel: string;
  /** Có nhóm nào bị gộp vào "Khác" không. */
  grouped: boolean;
}

export const REPORT_NAME_MAX = 255;

export const REPORT_ERROR_CODES = {
  /**
   * Báo cáo chưa được dựng biểu đồ, nên chưa có gì để tổng hợp.
   *
   * KHÔNG phải lỗi: đây là trạng thái mọi báo cáo đi qua ngay sau khi được tạo.
   * Giao diện hiện lời mời dựng biểu đồ chứ không hiện màn hình lỗi.
   */
  REPORT_NOT_CONFIGURED: 'ReportNotConfigured',
  /**
   * Bộ dữ liệu chưa nằm trong kho phân tích, nên chưa tổng hợp được.
   *
   * Cũng KHÔNG phải lỗi hỏng: từ khi §7.6 gom nhóm bằng ClickHouse thay vì trong
   * RAM Node, một báo cáo chỉ vẽ được sau khi bộ dữ liệu đã nạp. Trạng thái này
   * kéo dài vài giây sau khi tải file lên, và giao diện hiện tiến độ nạp thay vì
   * một biểu đồ rỗng.
   *
   * Thà 409 còn hơn vẽ trên `dataset_rows`: bảng đó giờ chỉ giữ MẪU, nên tổng
   * hợp trên nó sẽ ra một biểu đồ trông hoàn toàn hợp lý mà sai số liệu.
   */
  DATASET_NOT_LOADED: 'DatasetNotLoaded',
} as const;

export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[keyof typeof REPORT_ERROR_CODES];
