import type { DatasetSource } from './data';
import type { MeasureFormat } from './datamodel';

/**
 * Hợp đồng dữ liệu của báo cáo và biểu đồ (§7.6, mở rộng ở §10.8).
 *
 * Một báo cáo là MỘT biểu đồ dựng trên MỘT nguồn số liệu. Có HAI loại nguồn, và
 * chúng khác nhau ở chỗ sâu hơn cái tên:
 *
 *   `dataset`    — một bộ dữ liệu. Cấu hình trỏ tới cột bằng TÊN, và câu tổng
 *                  hợp do `aggregateWarehouse` dựng thẳng trên bảng kho.
 *   `datamodel`  — một mô hình. Cấu hình trỏ tới chiều và thước đo bằng ID, và
 *                  câu lệnh do Cube sinh — nên nó thừa hưởng cả phép nối lẫn
 *                  thước đo tính toán mà tầng ngữ nghĩa đã khai.
 *
 * Vì sao đáng có cả hai thay vì ép mọi báo cáo qua mô hình: một file vừa tải
 * lên chưa thuộc mô hình nào, và bắt người dùng dựng mô hình trước khi xem được
 * biểu đồ đầu tiên là dựng một bức tường ngay ở bước một.
 *
 * Vì sao báo cáo trên mô hình KHÔNG nhận tên cột: cùng nguyên tắc với §10.7 —
 * trình duyệt gửi ID, backend tra ID trong phạm vi đã lọc theo tổ chức rồi tự
 * dựng tên cube. Một ID bịa ra không trỏ được sang mô hình của người khác.
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

/** Nguồn số liệu của một báo cáo — xem ghi chú đầu file. */
export const REPORT_SOURCES = ['dataset', 'datamodel'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  dataset: 'Bộ dữ liệu',
  datamodel: 'Mô hình dữ liệu',
};

/**
 * Cấu hình biểu đồ dựng trên MÔ HÌNH — §10.8.
 *
 * Toàn ID, không một tên nào. Nhờ vậy đổi tên hiển thị của cột hay của thước đo
 * không làm mồ côi báo cáo, và chuỗi trong cấu hình không bao giờ đi vào câu
 * lệnh — Cube nhận tên do backend dựng từ chính hai ID này.
 *
 * KHÔNG có `aggregate`: phép gộp đã nằm trong định nghĩa của thước đo (tab
 * Schemas, hoặc công thức ở §10.6). Cho phép chọn lại ở đây nghĩa là cùng một
 * thước đo cho hai con số khác nhau tuỳ báo cáo — đúng thứ tầng ngữ nghĩa sinh
 * ra để dẹp.
 */
export interface ReportModelConfigDto {
  dimensionId: number;
  measureId: number;
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
 *
 * ⚠️ Báo cáo dựng trên MÔ HÌNH thì không đi qua trạng thái đó: hộp thoại tạo đã
 * hỏi đủ chiều, thước đo và loại biểu đồ, nên nó ra đời với cấu hình đầy đủ.
 *
 * `datasetId` và `datamodelId` loại trừ nhau — database ép bằng CHECK ở
 * migration 15, không chỉ bằng quy ước. `sourceName` là tên của bên nào đang
 * được dùng, để nơi hiển thị không phải tự phân nhánh chỉ để in một cái tên.
 */
export interface ReportDto {
  id: number;
  workspaceId: number;
  source: ReportSource;
  /** Tên bộ dữ liệu hoặc tên mô hình — tuỳ `source`. */
  sourceName: string;
  datasetId: number | null;
  /** Bộ dữ liệu đến từ đâu — để trang Report nói đúng nguồn của số liệu. */
  datasetSource: DatasetSource | null;
  datamodelId: number | null;
  name: string;
  chartType: ChartType | null;
  /** Chỉ khi `source === 'dataset'`. */
  config: ReportConfigDto | null;
  /** Chỉ khi `source === 'datamodel'`. */
  modelConfig: ReportModelConfigDto | null;
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

/**
 * Tạo báo cáo trên MÔ HÌNH — §10.8. Ngược hẳn `CreateReportInput`: ra đời là đã
 * có biểu đồ.
 *
 * Không phải mâu thuẫn với ghi chú "không đoán hộ cấu hình" ở trên. Ở luồng
 * file, người dùng vừa tải một file lạ lên và hệ thống chưa biết cột nào đáng
 * vẽ — nên nó không đoán. Ở đây họ vừa TỰ chọn chiều và thước đo trong hộp
 * thoại, nên tạo ra một báo cáo rỗng để bắt họ chọn lại là việc thừa.
 */
export interface CreateModelReportInput {
  datamodelId: number;
  name: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
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
  /**
   * Cách ĐỌC con số, không phải cách tính nó — §10.6.
   *
   * Vắng mặt nghĩa là số thường. Có `'percent'` khi thước đo được khai là tỉ lệ:
   * kho lưu 0,283 và chỗ hiển thị phải đọc thành 28,3 %. Đi kèm dữ liệu chứ
   * không tra lại từ mô hình, vì trang xem báo cáo không mở mô hình ra.
   */
  format?: MeasureFormat | undefined;
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
