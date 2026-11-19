import { REPORT_ERROR_CODES, type ReportCanvasDataDto, type ReportDto } from '@bi/shared';

import { loadModelContext } from '../datamodel/explorer';
import { aggregateFromModel } from '../datamodel/modelReportData';
import { HttpError } from '../../utils/httpError';

/**
 * Số liệu của MỘT TRANG khung, dùng chung cho hai bề mặt.
 *
 * ═══ Vì sao tách ra khỏi route ═════════════════════════════════════════════
 *
 * Từ mong muốn D5 có hai đường tới cùng một phép tính: `GET
 * /v1/reports/:id/canvas-data` cho người đã đăng nhập, và
 * `GET /api/public/reports/:chuoi` cho người cầm liên kết chia sẻ. Hai bản cài
 * đặt của một phép tính thì lệch nhau ở lần sửa đầu tiên — và ở đây "lệch" nghĩa
 * là người xem qua liên kết thấy một con số khác người xem trong app, trên cùng
 * một báo cáo. Không có lỗi nào báo chuyện đó.
 *
 * Mọi lý lẽ bên trong (một `loadModelContext` cho cả trang, `allSettled` để một
 * ô hỏng không xoá cả khung, câu lỗi nội bộ KHÔNG đi ra ngoài) giữ nguyên như
 * khi nó còn nằm trong route — chỉ đổi chỗ, không đổi luật.
 */
export async function soLieuTrangKhung(input: {
  /** Đọc từ phiên đăng nhập, hoặc từ dòng liên kết chia sẻ. Không bao giờ từ client. */
  tenantId: number;
  /** Người "chịu trách nhiệm" cho truy vấn: người đang xem, hoặc người đã tạo liên kết. */
  userId: number;
  report: ReportDto;
  /** Vắng mặt hoặc trỏ vào trang đã xoá -> lấy trang đầu. */
  pageId?: string | undefined;
}): Promise<ReportCanvasDataDto> {
  const { report } = input;

  if (report.canvas === null || report.datamodelId === null) {
    throw new HttpError(
      409,
      REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
      'Báo cáo này không phải khung nhiều biểu đồ.',
    );
  }

  const datamodelId = report.datamodelId;
  const page = report.canvas.pages.find((p) => p.id === input.pageId) ?? report.canvas.pages[0];
  const cells = page?.visuals ?? [];

  // Chỉ mục mô hình nạp MỘT lần cho cả trang — §10.14. Nạp TRƯỚC `allSettled`
  // chứ không để ô đầu tiên nạp hộ: các ô chạy song song.
  const ctx = await loadModelContext(input.tenantId, datamodelId);

  const settled = await Promise.allSettled(
    cells.map((visual) =>
      aggregateFromModel(input.tenantId, input.userId, datamodelId, visual.config, 0, ctx),
    ),
  );

  return {
    visuals: cells.map((visual, index) => {
      const outcome = settled[index];
      if (outcome !== undefined && outcome.status === 'fulfilled') {
        return { visualId: visual.id, data: outcome.value };
      }
      const reason = outcome?.status === 'rejected' ? outcome.reason : undefined;
      return {
        visualId: visual.id,
        data: null,
        // Câu chữ của lỗi nghiệp vụ (`HttpError` mang câu tiếng Việt) đi thẳng
        // ra. Lỗi không lường trước thì KHÔNG: thông điệp của nó là chi tiết nội
        // bộ, và một ô biểu đồ không phải chỗ để rò rỉ chúng.
        error:
          reason instanceof HttpError
            ? reason.message
            : 'Không đọc được số liệu cho ô này. Thử mở lại báo cáo.',
      };
    }),
  };
}
