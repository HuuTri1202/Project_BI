import type { BaoCaoChiaSeDto } from '@bi/shared';
import { Router } from 'express';
import { z } from 'zod';

import { mysqlPool } from '../../config/mysql';
import { rateLimit } from '../../middleware/rateLimit';
import * as reportsRepo from '../../repositories/reports';
import * as tenantsRepo from '../../repositories/tenants';
import { soLieuTrangKhung } from '../../services/report/canvasData';
import { moLienKet } from '../../services/report/chiaSe';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError, notFound } from '../../utils/httpError';

/**
 * Bề mặt CÔNG KHAI — mong muốn D5.
 *
 * ═══ Vì sao nó là một router riêng, ngoài `/api/v1` ════════════════════════
 *
 * `v1Router` gắn `authenticate` + `requireFreshMembership` + `authorize` cho
 * mọi route của nó, và đó là một tài sản: không ai thêm được một route vào đó mà
 * quên xác thực. Nhét một route công khai vào giữa nghĩa là phải bỏ guard cho
 * đúng một đường — và từ đó "mọi route trong v1 đều được xác thực" không còn là
 * một câu đúng mà người đọc có thể tin.
 *
 * Cùng lý lẽ đã đặt webhook của cổng thanh toán ra ngoài `/api/v1`: người gọi
 * không có token và không thuộc tổ chức nào. Khác biệt là ở đó thứ thay cho
 * phiên là chữ ký HMAC, còn ở đây là một chuỗi 256 bit trong đường dẫn.
 *
 * ═══ Ba luật của bề mặt này ════════════════════════════════════════════════
 *
 *   1. KHÔNG nhận tham số nào định danh dữ liệu. Chỉ có chuỗi bí mật; tổ chức
 *      và báo cáo đọc từ dòng liên kết (`moLienKet`). Không có `?tenantId=`,
 *      không có `?reportId=` để ai đó thử đổi.
 *   2. Trả về DTO RIÊNG (`BaoCaoChiaSeDto`), không phải `ReportDto`. DTO kia
 *      mang `datamodelId`, `workspaceId`, `folderName`, `creatorName` — cấu
 *      trúc nội bộ của tổ chức, mà người nhận liên kết không có lý do gì để
 *      thấy.
 *   3. Có hạn nhịp. Một đường dẫn công khai là một đường ai cũng gọi được, và
 *      mỗi lượt gọi là một truy vấn thật xuống kho phân tích.
 */
export const publicRouter = Router();

/**
 * Chuỗi 32 byte base64url -> đúng 43 ký tự.
 *
 * Kiểm hình dạng TRƯỚC khi băm và tra database: một chuỗi dài 10.000 ký tự
 * không đáng một vòng SHA-256 và một vòng MySQL.
 */
const chuoiParamSchema = z.object({
  chuoi: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Liên kết không đúng định dạng'),
});

const trangQuerySchema = z.object({ trang: z.string().min(1).max(64).optional() });

publicRouter.get(
  '/reports/:chuoi',
  /*
   * 60 lượt / 10 phút cho mỗi IP, đếm MỌI lượt (không chỉ lượt lỗi).
   *
   * Khác `/auth/login`: ở đó thứ phải chặn là số lần ĐOÁN SAI, còn ở đây mỗi
   * lượt THÀNH CÔNG mới là lượt tốn tài nguyên — nó chạy một `loadModelContext`
   * và n truy vấn Cube. Một người xem thật mở lại trang vài lần là bình thường;
   * 60 lượt thì không.
   */
  rateLimit({ bucket: 'public-report', max: 60, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const { chuoi } = chuoiParamSchema.parse(req.params);
    const { trang } = trangQuerySchema.parse(req.query);

    const lienKet = await moLienKet(chuoi);

    /*
     * Phạm vi dựng TỪ DÒNG LIÊN KẾT, không từ request.
     *
     * `allWorkspaces: true` ở đây không phải là nới quyền: hàm chỉ được gọi với
     * đúng một `reportId` — chính cái id nằm trong dòng liên kết — nên không có
     * đường nào để đọc sang một báo cáo khác. Nó chỉ nói rằng phạm vi workspace
     * không còn ý nghĩa khi không có người dùng nào đang đăng nhập.
     */
    const report = await reportsRepo.findById(
      mysqlPool,
      { tenantId: lienKet.tenantId, userId: lienKet.createdBy, allWorkspaces: true },
      lienKet.reportId,
    );
    // Báo cáo đã bị xoá mềm sau khi liên kết được tạo. Nói như thể liên kết
    // không còn: người nhận không cần biết báo cáo từng tồn tại.
    if (!report) throw notFound('Liên kết này không còn báo cáo nào để xem.');

    if (report.canvas === null) {
      /*
       * Giới hạn đã BIẾT và nói ra: chỉ báo cáo dạng KHUNG chia sẻ được.
       *
       * Báo cáo dựng trực tiếp trên bộ dữ liệu (§7.6) đi một đường số liệu khác
       * (`GET /reports/:id/data`, hai nhánh, cần tra thêm bộ dữ liệu và cột).
       * Mở đường đó ra công khai là nhân đôi bề mặt không xác thực cho một dạng
       * báo cáo mà mọi lối tạo hiện tại đều không sinh ra nữa — trình dựng luôn
       * cho ra khung.
       */
      throw new HttpError(
        409,
        'ShareNotSupported',
        'Báo cáo này chưa chia sẻ được bằng liên kết. Hãy mở báo cáo trong hệ thống để xem.',
      );
    }

    const tenant = await tenantsRepo.findTenantById(lienKet.tenantId);

    const body: BaoCaoChiaSeDto = {
      name: report.name,
      tenantName: tenant?.name ?? '',
      updatedAt: report.updatedAt,
      canvas: report.canvas,
      pageId:
        report.canvas.pages.find((p) => p.id === trang)?.id ?? report.canvas.pages[0]?.id ?? '',
      soLieu: await soLieuTrangKhung({
        tenantId: lienKet.tenantId,
        // Truy vấn ghi vào sổ dưới tên NGƯỜI TẠO liên kết, không phải một người
        // vô danh: họ là người đã quyết định mở báo cáo này ra ngoài.
        userId: lienKet.createdBy,
        report,
        pageId: trang,
      }),
    };
    res.json(body);
  }),
);
