import { Router, type Request } from 'express';

import { rateLimit } from '../../middleware/rateLimit';
import { handleWebhook, isPaymentProvider } from '../../services/billing/webhook';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest } from '../../utils/httpError';

/**
 * Webhook của cổng thanh toán — §11.
 *
 * ═══ Router NGOÀI `/api/v1`, và đó là điểm mấu chốt ═══════════════════════
 *
 * Nó KHÔNG đi qua `authenticate` hay `requireFreshMembership`: người gọi là máy
 * chủ của cổng thanh toán, họ không có token và không thuộc tổ chức nào. Thứ
 * thay cho phiên đăng nhập là CHỮ KÝ HMAC trên thân request — xem
 * `webhookSignature.ts`.
 *
 * Đã kiểm: `originGuard` cho qua request không mang header `Origin`, và webhook
 * từ máy chủ thì không mang. Nên không cần ngoại lệ nào cho nó.
 *
 * ═══ Vì sao gần như luôn trả 200 ══════════════════════════════════════════
 *
 * Cổng thanh toán coi mọi mã lỗi là "gửi lại". Trả 500 vì đơn không tồn tại
 * nghĩa là nhận lại đúng webhook đó mỗi vài phút trong nhiều ngày, và không lần
 * nào khá hơn lần nào. Ta trả 200 kèm lý do trong thân; lý do cũng nằm trong
 * cột `error` của `payment_webhook_events` để người vận hành đọc.
 *
 * Ngoại lệ duy nhất là 401 cho chữ ký sai — cổng thật cần biết cấu hình lệch,
 * và kẻ dò tìm không được nhận 200 cho một chữ ký bịa.
 */
export const webhookRouter = Router();

/**
 * Giới hạn nhịp RỘNG, và bó theo IP như mọi bộ giới hạn khác của repo.
 *
 * Webhook thật đến từ vài IP cố định của cổng, và một đợt gửi lại hàng loạt sau
 * sự cố mạng có thể dồn hàng trăm request trong ít phút — chặn chúng là tự làm
 * mất tiền của mình. 600 trong 10 phút đủ rộng cho việc đó và vẫn chặn được một
 * vòng lặp dò tìm.
 *
 * `rateLimit` fail-open khi Redis chết, và ở đây đó là hướng ĐÚNG: thà nhận
 * thừa một webhook còn hơn bỏ lỡ một khoản tiền.
 */
webhookRouter.post(
  '/:provider',
  rateLimit({ bucket: 'billing-webhook', max: 600, windowSeconds: 600 }),
  asyncHandler(async (req: Request, res) => {
    const provider = String(req.params['provider'] ?? '');
    if (!isPaymentProvider(provider)) {
      // 400 chứ không 404: đường dẫn có tồn tại, chỉ là tham số sai. Và không
      // liệt kê các cổng hợp lệ trong thông báo — không có lý do gì để nói với
      // người gõ bừa rằng ta hỗ trợ những cổng nào.
      throw badRequest('Cổng thanh toán không hợp lệ.');
    }

    /*
     * `rawBody` do `express.json({ verify })` giữ lại — xem `app.ts`.
     *
     * Thiếu nó thì KHÔNG được rơi về `JSON.stringify(req.body)`: chuỗi dựng lại
     * khác chuỗi gốc ở thứ tự khoá, khoảng trắng và cách viết số, nên chữ ký
     * không bao giờ khớp và ta sẽ đi tìm lỗi ở khoá bí mật. Thà hỏng to.
     */
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (rawBody === undefined) {
      throw new Error(
        'Thiếu rawBody cho webhook — kiểm lại tuỳ chọn `verify` của express.json trong app.ts.',
      );
    }

    const outcome = await handleWebhook({
      provider,
      rawBody,
      headers: req.headers,
    });

    res.status(outcome.status).json({ message: outcome.message });
  }),
);
