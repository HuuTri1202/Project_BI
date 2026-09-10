import { BILLING_ERROR_CODES, type BillingCycle, type OrderDetailDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as billingRepo from '../../repositories/billing';
import { HttpError, badRequest } from '../../utils/httpError';
import { newOrderCode } from './orderCode';
import { hanThanhToan } from './period';
import { buildVietQrPayload } from './vietqr';

/**
 * Tạo đơn mua gói — §11.
 *
 * ═══ Đơn chốt cứng MỌI thứ tại thời điểm tạo ═══════════════════════════════
 *
 * `amount_vnd`, `plan_code`, `plan_name`, `plan_duration_days` và `qr_payload`
 * đều là ẢNH CHỤP. Người vận hành đổi giá gói Pro chiều nay thì đơn tạo sáng
 * nay vẫn đúng giá sáng nay — không phải nhờ một bảng lịch sử giá, mà nhờ chính
 * những cột này. Đó là lý do `plan_price_history` không cần tồn tại.
 *
 * `qr_payload` cũng vậy: nó đóng băng đúng số tài khoản khách đã quét. Nếu
 * người vận hành đổi tài khoản tuần sau, đơn cũ vẫn hiện thứ khách đã thấy. Đây
 * là bằng chứng, không phải cache.
 */

/**
 * Số ngày của một chu kỳ.
 *
 * Bảng giá lưu `duration_days` cho chu kỳ THÁNG. Chu kỳ năm là 12 lần số đó —
 * không phải 365 ngày, để một gói khai 30 ngày ra đúng 360 ngày và người dùng
 * thấy "12 tháng" đúng nghĩa. Nhân ở đây chứ không thêm một cột `price_yearly`
 * riêng: hai cột giá là hai chỗ để lệch nhau, và giảm giá theo năm là chính
 * sách chứ không phải cấu trúc dữ liệu.
 */
const CYCLE_MULTIPLIER: Record<BillingCycle, number> = {
  monthly: 1,
  yearly: 12,
};

/**
 * Chiết khấu khi trả theo năm: trả 10 tháng, dùng 12.
 *
 * Con số nằm ở đây, một chỗ, chứ không rải trong giao diện — trang bảng giá
 * hiện "tiết kiệm 2 tháng" phải đọc từ cùng nguồn với câu tính tiền, nếu không
 * hai bên nói hai đằng và khách sẽ là người phát hiện.
 */
export const YEARLY_PAID_MONTHS = 10;

export function tinhSoTien(priceVnd: number, cycle: BillingCycle): number {
  return cycle === 'yearly' ? priceVnd * YEARLY_PAID_MONTHS : priceVnd;
}

export function tinhSoNgay(durationDays: number, cycle: BillingCycle): number {
  return durationDays * CYCLE_MULTIPLIER[cycle];
}

export interface CreateOrderInput {
  tenantId: number;
  userId: number;
  planId: number;
  paymentMethodId: number;
  cycle: BillingCycle;
}

/** Số lần thử lại khi mã đơn đụng nhau. Xem ghi chú ở dưới. */
const MAX_CODE_ATTEMPTS = 3;

export async function createOrder(input: CreateOrderInput): Promise<OrderDetailDto> {
  const now = new Date();

  const plan = await billingRepo.findPlanById(mysqlPool, input.planId);
  if (plan === null || !plan.isPublic) {
    throw new HttpError(
      404,
      BILLING_ERROR_CODES.PLAN_UNAVAILABLE,
      'Gói dịch vụ này không còn được bán. Hãy tải lại trang bảng giá.',
    );
  }

  // Gói Free có giá 0 và `durationDays = 0`. Mua nó không có nghĩa gì, và nếu
  // lọt qua thì `tinhChuKy` sẽ ném ở tận tầng dưới với một câu không nói gì về
  // việc người dùng vừa làm.
  if (plan.priceVnd <= 0 || plan.durationDays <= 0) {
    throw badRequest(`Gói "${plan.name}" là gói miễn phí, không cần mua.`);
  }

  const method = await billingRepo.findPaymentMethodById(mysqlPool, input.paymentMethodId);
  if (method === null || !method.isActive) {
    throw new HttpError(
      400,
      BILLING_ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE,
      'Phương thức thanh toán này hiện không dùng được. Hãy chọn phương thức khác.',
    );
  }

  /*
   * Phương thức BẬT nhưng CHƯA cấu hình đủ.
   *
   * Migration gieo sẵn `vietqr_bank` với số tài khoản để TRỐNG — cố ý, vì số
   * tài khoản là dữ liệu vận hành thật chứ không thuộc mã nguồn. Nên đây là
   * trạng thái sẽ gặp ở mọi lần cài mới, không phải trường hợp hiếm.
   *
   * Nói rõ thiếu gì và ai phải sửa. Không có câu này thì khách nhận một mã QR
   * rỗng hoặc một lỗi 500, và không ai biết phải đi hỏi ai.
   */
  if (!method.isConfigured) {
    throw new HttpError(
      409,
      BILLING_ERROR_CODES.PAYMENT_METHOD_NOT_CONFIGURED,
      `Phương thức "${method.name}" chưa được cấu hình đầy đủ, nên chưa tạo được đơn. ` +
        'Hãy báo quản trị viên hệ thống điền thông tin tài khoản nhận tiền.',
    );
  }

  /*
   * Đã có đơn còn hạn cho ĐÚNG gói này thì trả lại chính nó.
   *
   * Người dùng bấm "Nâng cấp" hai lần, hoặc mở hai tab, là chuyện thường. Mỗi
   * đơn là một mã QR khác nhau với một nội dung chuyển khoản khác nhau; hai mã
   * cùng chờ tiền cho một lần mua là thứ người vận hành sẽ phải gỡ tay khi tiền
   * về với mã của đơn kia.
   *
   * Trả lại đơn cũ chứ không báo lỗi: người dùng đang muốn trả tiền, và một
   * thông báo "bạn đã có đơn rồi" bắt họ đi tìm nó là bắt họ làm việc của ta.
   */
  const dangCho = await billingRepo.findLivePendingOrder(mysqlPool, input.tenantId, plan.id, now);
  if (dangCho !== null) return dangCho;

  const amountVnd = tinhSoTien(plan.priceVnd, input.cycle);
  const durationDays = tinhSoNgay(plan.durationDays, input.cycle);
  const expiresAt = hanThanhToan(now);

  /*
   * Vòng thử lại vì MÃ ĐƠN, không vì lỗi mạng.
   *
   * `newOrderCode()` cố ý không kiểm trùng — một câu SELECT kiểm trước rồi
   * INSERT sau để lại đúng khe hở mà hai request song song đi qua cùng lúc.
   * Tính duy nhất do `uq_orders_code` bảo đảm, và ta bắt `ER_DUP_ENTRY` ở đây.
   *
   * Ba lần là quá đủ: mã có 50 bit ngẫu nhiên, nên va chạm là chuyện lý thuyết.
   * Vòng lặp này có mặt để ĐÚNG, không phải để hay dùng.
   *
   * ⚠️ Chỉ nuốt ĐÚNG mã lỗi trùng khoá. Bắt mọi lỗi rồi thử lại sẽ biến một
   * lỗi cấu hình (sai tên cột, thiếu quyền) thành ba lần thử im lặng rồi một
   * thông báo sai hoàn toàn.
   */
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
    const orderCode = newOrderCode();

    const qrPayload =
      method.bankBin !== null && method.bankAccountNo !== null
        ? buildVietQrPayload({
            bankBin: method.bankBin,
            accountNo: method.bankAccountNo,
            amountVnd,
            // Nội dung chuyển khoản LUÔN là mã đơn. Không có chuỗi thứ hai.
            content: orderCode,
          })
        : null;

    try {
      await billingRepo.insertOrder(mysqlPool, {
        tenantId: input.tenantId,
        orderCode,
        planId: plan.id,
        paymentMethodId: method.id,
        amountVnd,
        planCode: plan.code,
        planName: plan.name,
        planDurationDays: durationDays,
        qrPayload,
        expiresAt,
        createdBy: input.userId,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ER_DUP_ENTRY' && attempt < MAX_CODE_ATTEMPTS) continue;
      throw err;
    }

    const created = await billingRepo.findOrderByCode(mysqlPool, input.tenantId, orderCode);
    // Vừa ghi xong mà đọc lại không thấy là chuyện không xảy ra được; ném thay
    // vì trả `null` để nơi gọi không phải xử lý một nhánh không tồn tại.
    if (created === null) throw new Error(`Vừa tạo đơn ${orderCode} nhưng đọc lại không thấy.`);
    return created;
  }

  throw new Error(`Không sinh được mã đơn duy nhất sau ${MAX_CODE_ATTEMPTS} lần thử.`);
}
