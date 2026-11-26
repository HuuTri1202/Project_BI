import type {
  AnalyzeResultDto,
  ChartType,
  CommitDatasetsInput,
  CreateCanvasReportInput,
  CreateModelReportInput,
  CreateReportInput,
  CreateUploadResultDto,
  DatasetDetailDto,
  PageResult,
  ReportCanvasDataDto,
  ReportConfigDto,
  ReportDataDto,
  ReportDto,
  ReportFolderDto,
  UpdateCanvasReportInput,
  UpdateModelReportInput,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của luồng bộ dữ liệu và báo cáo (§7).
 *
 * Cùng quy ước với `features/tenant/api.ts`: đường dẫn tương đối với
 * `VITE_API_BASE_URL`, token do interceptor tự gắn, không hàm nào nhận
 * `tenantId` (backend lấy từ token), và không hàm nào bắt lỗi — react-query cần
 * thấy Promise bị reject.
 *
 * ⚠️ `uploadUrl` trả về từ `createUpload` KHÔNG được gọi bằng `apiClient`. Nó trỏ
 * thẳng vào S3, và interceptor sẽ gắn `Authorization` của ta vào đó — S3 từ chối
 * vì header đó không nằm trong chữ ký. Việc PUT do Uppy lo, xem `useUppyS3.ts`.
 */

function clean(
  input: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

/**
 * Mọi `ReportDto` đi vào ứng dụng đều qua đây — §10.18.
 *
 * Từ §10.18 mỗi trang của khung có thêm `annotations`, và khung soạn thảo lẫn
 * trang xem đọc thẳng trường đó. Backend mới luôn gửi nó; nhưng một frontend
 * được triển khai TRƯỚC backend sẽ nhận trang không có trường này, và một
 * `page.annotations.filter` trên `undefined` là cả trang báo cáo trắng xoá — cho
 * một tính năng mà báo cáo đó thậm chí chưa dùng tới.
 *
 * Điền ở CỬA VÀO, một lần, thay vì rải `?? []` ở từng nơi đọc: nơi đọc thứ năm
 * thêm vào sau này sẽ không phải nhớ gì cả.
 */
function normalizeReport(report: ReportDto): ReportDto {
  if (report.canvas === null) return report;
  return {
    ...report,
    canvas: {
      ...report.canvas,
      pages: report.canvas.pages.map((page) => ({
        ...page,
        annotations: Array.isArray(page.annotations) ? page.annotations : [],
      })),
    },
  };
}

// ─── Bộ dữ liệu ──────────────────────────────────────────────────────────────
//
// Chỉ luồng TẢI FILE nằm ở đây. Danh sách, chi tiết và xoá bộ dữ liệu dùng chung
// với nguồn `connection` nên sống ở `features/tenant/api.ts` — một trang Kho dữ
// liệu, một bộ hàm gọi API.

export async function createUpload(input: {
  workspaceId: number;
  filename: string;
  fileSize: number;
  /** Thư mục đích — §7.9. `null` = Chung. Ghi vào bản ghi `pending` ngay từ đây. */
  folderId: number | null;
}): Promise<CreateUploadResultDto> {
  const { data } = await apiClient.post<CreateUploadResultDto>('/v1/datasets/uploads', input);
  return data;
}

/**
 * Xin chỗ tải lên một TỆP MỚI cho bộ dữ liệu đã có — §B2.
 *
 * Khác `createUpload` ở chỗ nó KHÔNG tạo bản ghi mới: `id` giữ nguyên, nên mọi
 * mô hình và báo cáo đang trỏ tới bộ này vẫn chạy sau khi dữ liệu được thay.
 */
export async function xinChoCapNhat(
  id: number,
  input: { filename: string; fileSize: number },
): Promise<CreateUploadResultDto> {
  const { data } = await apiClient.post<CreateUploadResultDto>(`/v1/datasets/${id}/uploads`, input);
  return data;
}

/**
 * Đẩy tệp thẳng lên S3 bằng vé đã ký.
 *
 * `fetch` trần chứ KHÔNG dùng `apiClient`: interceptor của nó gắn
 * `Authorization` vào mọi request, mà presigned URL đã ký sẵn một tập header cố
 * định — thêm một header lạ là chữ ký không khớp và S3 trả 403 kèm một thông
 * báo chẳng liên quan gì tới quyền. Cùng lý do khiến `useUppyS3` phải dùng XHR
 * riêng của Uppy.
 */
export async function dayTepLen(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type === '' ? 'application/octet-stream' : file.type },
  });
  if (!res.ok) {
    throw new Error(`Tải tệp lên không thành công (${String(res.status)}).`);
  }
}

/**
 * Hạn chờ cho hai lời gọi phải ĐỌC CẢ TỆP trước khi trả lời.
 *
 * ═══ Vì sao 15 giây mặc định của `apiClient` là sai ở đúng hai chỗ này ═════
 *
 * Mọi endpoint khác trả lời trong vài chục mili giây, nên 15 giây ở đó là một
 * lưới an toàn rộng rãi. `analyze` thì khác về BẢN CHẤT: nó tải tệp từ kho về,
 * giải nén, dựng từng ô của từng sheet thành đối tượng JavaScript rồi mới đoán
 * được kiểu cột. Thời gian ấy tỉ lệ với kích thước tệp, không với tốc độ mạng.
 *
 * Đo trên chính máy ảo triển khai, tệp `Global-Superstore.xlsx` 7,8 MB —
 * 51.290 dòng × 24 cột × 3 sheet:
 *
 *     12–19 giây  cho riêng `parseFile` + `toPreview`
 *
 * Tức là một tệp hoàn toàn bình thường, nằm thừa trong hạn 50 MB mà chính
 * wizard quảng cáo, vượt hạn 15 giây. Người dùng nhận "Máy chủ không trả lời
 * trong 15 giây" trong khi máy chủ đang làm việc rất chăm chỉ, rồi bấm thử lại
 * — và lần thử lại cũng mất từng ấy giây, cho tới khi họ bỏ cuộc.
 *
 * ⚠️ KHÔNG nới hạn chung của `apiClient`: 15 giây ở đó là thứ khiến một sự cố
 * mạng thật hiện ra sau 15 giây chứ không phải hai phút. Nới riêng hai chỗ
 * thật sự cần, và ghi rõ vì sao.
 *
 * `commitDatasets` cũng nhận hạn này: nó dùng lại bản phân tích đã cache, nhưng
 * cache Redis có hạn 30 phút — wizard mở lâu rồi mới bấm Tiếp tục là nó tự
 * `parseFile` lại từ đầu (xem `services/dataset/commit.ts`).
 *
 * Hai phút là trần của sự KIÊN NHẪN, không phải của tệp lớn nhất đọc nổi: tệp
 * quá lớn sẽ hết bộ nhớ trước khi hết thời gian — xem `docs/trien-khai.md` §5,
 * mục giới hạn bộ nhớ của container `api`.
 */
const HAN_DOC_TEP_MS = 120_000;

export async function analyzeDataset(id: number): Promise<AnalyzeResultDto> {
  const { data } = await apiClient.post<AnalyzeResultDto>(`/v1/datasets/${id}/analyze`, undefined, {
    timeout: HAN_DOC_TEP_MS,
  });
  return data;
}

/**
 * Chốt các sheet đã tích và nạp dữ liệu.
 *
 * Trả về MỘT MẢNG: mỗi sheet được tích thành một bộ dữ liệu riêng (§7.5). Bản
 * ghi `pending` sinh ra lúc xin presigned URL được backend dùng lại cho sheet
 * đầu tiên, nên `id` truyền vào đây nằm trong kết quả.
 *
 * Hạn chờ nới như `analyzeDataset` — lý do đầy đủ ở `HAN_DOC_TEP_MS`.
 */
export async function commitDatasets(
  id: number,
  input: CommitDatasetsInput,
): Promise<DatasetDetailDto[]> {
  const { data } = await apiClient.post<DatasetDetailDto[]>(`/v1/datasets/${id}/commit`, input, {
    timeout: HAN_DOC_TEP_MS,
  });
  return data;
}

// ─── Báo cáo ─────────────────────────────────────────────────────────────────

export interface ReportListQuery {
  workspaceId: number;
  page: number;
  pageSize: number;
  q: string;
  /**
   * Thư mục đang mở — §10.25. Chuỗi rỗng = mọi thư mục, `'chung'` = Chung, còn
   * lại là mã thư mục. `clean` bỏ chuỗi rỗng đi nên nó không lên tới server.
   *
   * Dựng bằng `folderFilterValue`, đọc lại bằng `parseFolderFilter` — cả hai ở
   * @bi/shared, dùng chung với backend.
   */
  folder?: string;
}

export async function fetchReports(query: ReportListQuery): Promise<PageResult<ReportDto>> {
  const { data } = await apiClient.get<PageResult<ReportDto>>('/v1/reports', {
    params: clean({ ...query }),
  });
  return { ...data, items: data.items.map(normalizeReport) };
}

export async function fetchReport(id: number): Promise<ReportDto> {
  const { data } = await apiClient.get<ReportDto>(`/v1/reports/${id}`);
  return normalizeReport(data);
}

export async function fetchReportData(id: number, page = 0): Promise<ReportDataDto> {
  const { data } = await apiClient.get<ReportDataDto>(`/v1/reports/${id}/data`, {
    // Không gửi `page=0`: mọi báo cáo không chia trang sẽ mang thêm một tham số
    // vô nghĩa trong log truy cập, và một tham số vô nghĩa ở khắp nơi là một
    // tham số không ai để ý khi nó bắt đầu có nghĩa.
    ...(page > 0 ? { params: { page } } : {}),
  });
  return data;
}

/**
 * Số liệu của MỘT ô ở một TRANG NHÓM — §10.12, cho hai cái nút ‹ ›.
 *
 * Đường riêng thay vì gọi lại `report-preview`: endpoint kia gác `datamodel:read`
 * mà viewer không có, nên hai cái nút sẽ chết ở đúng người cần chúng nhất.
 */
export async function fetchReportVisualData(
  id: number,
  visualId: string,
  page: number,
): Promise<ReportDataDto> {
  const { data } = await apiClient.get<ReportDataDto>(
    `/v1/reports/${id}/visuals/${encodeURIComponent(visualId)}/data`,
    { params: { page } },
  );
  return data;
}

/**
 * Tạo báo cáo RỖNG — chỉ tên và bộ dữ liệu.
 *
 * Không nhận loại biểu đồ hay cấu hình trục: biểu đồ là việc người dùng dựng
 * trên trang Report, không phải thứ wizard đoán hộ.
 */
export async function createReport(input: CreateReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports', input);
  return normalizeReport(data);
}

/**
 * Tạo báo cáo trên MÔ HÌNH — §10.8. Ngược cái trên: ra đời là đã có biểu đồ.
 *
 * `config` toàn ID. Không một tên cột nào rời trình duyệt, cùng luật với
 * `runQuery` của Explorer.
 */
export async function createModelReport(input: CreateModelReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports/from-datamodel', input);
  return normalizeReport(data);
}

export async function updateReport(
  id: number,
  input: { name: string; chartType: ChartType; config: ReportConfigDto },
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}`, input);
  return normalizeReport(data);
}

/**
 * Sửa báo cáo dựng trên MÔ HÌNH — §10.9.
 *
 * Đường riêng vì `config` là hình dạng khác hẳn: toàn ID thay cho tên cột. Gửi
 * nhầm sang `updateReport` thì backend đọc ra một cấu hình rỗng và báo cáo mất
 * biểu đồ — nên hai vế đều chặn, xem chú thích ở hai route.
 */
export async function updateModelReport(
  id: number,
  input: UpdateModelReportInput,
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}/from-datamodel`, input);
  return normalizeReport(data);
}

/**
 * Số liệu của mọi ô trên MỘT TRANG — một request, xem route cùng tên.
 *
 * `pageId === null` nghĩa là "trang đầu", và backend cũng rơi về đó khi mã trang
 * không còn tồn tại — trang vừa bị người khác xoá thì rơi về đầu chứ không phải
 * ra một màn hình lỗi.
 */
export async function fetchReportCanvasData(
  id: number,
  pageId: string | null,
): Promise<ReportCanvasDataDto> {
  const { data } = await apiClient.get<ReportCanvasDataDto>(`/v1/reports/${id}/canvas-data`, {
    ...(pageId === null ? {} : { params: { pageId } }),
  });
  return data;
}

/** Tạo báo cáo NHIỀU biểu đồ — §10.10. */
export async function createCanvasReport(input: CreateCanvasReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports/canvas', input);
  return normalizeReport(data);
}

/* ─── Thư mục báo cáo — §10.25 ─────────────────────────────────────────────── */

/**
 * `chungCount` đi RIÊNG, không nằm trong `items`.
 *
 * Chung không phải một thư mục (xem `reportFolder.ts` bên @bi/shared), nên nó
 * không có mã để đứng chung một mảng với những cái có mã. Giao diện tự dựng
 * dòng "Chung" từ con số này.
 */
export interface ReportFolderList {
  items: ReportFolderDto[];
  chungCount: number;
}

export async function fetchReportFolders(workspaceId: number): Promise<ReportFolderList> {
  const { data } = await apiClient.get<ReportFolderList>('/v1/report-folders', {
    params: { workspaceId },
  });
  return data;
}

export async function createReportFolder(input: {
  workspaceId: number;
  name: string;
}): Promise<ReportFolderDto> {
  const { data } = await apiClient.post<ReportFolderDto>(
    '/v1/report-folders',
    { name: input.name },
    { params: { workspaceId: input.workspaceId } },
  );
  return data;
}

export async function renameReportFolder(id: number, name: string): Promise<ReportFolderDto> {
  const { data } = await apiClient.patch<ReportFolderDto>(`/v1/report-folders/${id}`, { name });
  return data;
}

export async function deleteReportFolder(id: number): Promise<void> {
  await apiClient.delete(`/v1/report-folders/${id}`);
}

/** Chuyển một báo cáo sang thư mục khác. `folderId: null` = về Chung. */
export async function moveReport(id: number, folderId: number | null): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}/folder`, { folderId });
  return normalizeReport(data);
}

/**
 * Lưu một khung — §10.10.
 *
 * ⚠️ Cũng là đường CHUYỂN ĐỔI: gọi nó trên một báo cáo một-biểu-đồ sẽ biến nó
 * thành báo cáo nhiều biểu đồ, và không có đường ngược lại. Xem route cùng tên.
 */
export async function updateCanvasReport(
  id: number,
  input: UpdateCanvasReportInput,
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}/canvas`, input);
  return normalizeReport(data);
}

export async function deleteReport(id: number): Promise<void> {
  await apiClient.delete(`/v1/reports/${id}`);
}
