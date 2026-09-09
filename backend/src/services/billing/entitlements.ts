import type { BillingSummaryDto, BillingUsageDto, PlanDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as billingRepo from '../../repositories/billing';
import * as usageRepo from '../../repositories/usage';

/**
 * Gói đang hiệu lực và mức sử dụng của một tổ chức — §11.
 *
 * ═══ "Không có subscription nào" = ĐANG Ở FREE ═════════════════════════════
 *
 * Đây là luật trung tâm của cả mục, và nó thay cho việc chèn một dòng
 * subscription Free mồi mỗi lần tạo tổ chức. Lý do đã ghi ở migration 30, tóm
 * lại: bất biến "mọi tổ chức đều có một dòng" phải được móc vào MỌI đường tạo
 * tổ chức (form đăng ký, tổ chức cá nhân, script seed, helper của test) và sẽ
 * hỏng ở đường bị quên — nên nhánh "không có dòng" dù sao cũng phải viết. Viết
 * đúng một nhánh thì rẻ hơn viết hai.
 *
 * Hệ quả: `BillingSummaryDto.subscription` là `null` cho phần lớn tổ chức, và
 * đó KHÔNG phải lỗi hay trạng thái đang tải. `plan` thì luôn có mặt.
 */

/** Mã gói mặc định. Phải khớp dòng gieo ở migration 30. */
export const FREE_PLAN_CODE = 'free';

/**
 * Gói Free, và cái giá của việc nó biến mất.
 *
 * Ném lỗi thay vì trả về một gói rỗng bịa ra tại chỗ: nếu dòng `free` không còn
 * trong bảng thì mọi hạn mức hiển thị đều sai, và một gói bịa sẽ khiến màn hình
 * trông bình thường trong khi con số nó hiện không đến từ đâu cả. Hỏng to và
 * hỏng sớm còn hơn hỏng nhỏ và im lặng.
 */
async function requireFreePlan(): Promise<PlanDto> {
  const plan = await billingRepo.findPlanByCode(mysqlPool, FREE_PLAN_CODE);
  if (plan === null) {
    throw new Error(
      `Không tìm thấy gói '${FREE_PLAN_CODE}' trong bảng plans. ` +
        'Nó được gieo ở migration 30 — hãy chạy "npm run -w backend migrate".',
    );
  }
  return plan;
}

/**
 * Gói đang có hiệu lực. Dùng cho mọi nơi cần biết hạn mức của một tổ chức.
 *
 * ⚠️ Hạn mức đọc SỐNG từ `plans` qua `plan_id`, không lấy từ ảnh chụp trong
 * `subscriptions`. Ảnh chụp ở đó chỉ giữ GIÁ — một sự kiện đã xảy ra. Hạn mức
 * là chính sách hiện hành, nên khi người vận hành nới gói Pro thì khách đang
 * dùng Pro được hưởng ngay.
 *
 * Điều đó cắt cả hai chiều, và phải nói ra: SIẾT gói Pro cũng ảnh hưởng ngay
 * tới khách đang giữa chu kỳ họ đã trả tiền. Chấp nhận được khi hạn mức chỉ
 * hiển thị; ngày nó bắt đầu CHẶN thao tác thì quyết định này phải xem lại.
 */
export async function resolveCurrentPlan(tenantId: number, now: Date): Promise<PlanDto> {
  const sub = await billingRepo.findActiveSubscription(mysqlPool, tenantId, now);
  if (sub === null) return requireFreePlan();

  const plan = await billingRepo.findPlanById(mysqlPool, sub.planId);
  // Gói bị xoá mềm trong khi vẫn còn subscription trỏ vào — không nên xảy ra
  // (`fk_subscriptions_plan` là RESTRICT nên không xoá CỨNG được), nhưng xoá
  // mềm thì vẫn lọt. Rơi về Free là hướng an toàn: hiện hạn mức thấp hơn thực
  // tế còn hơn cho khách một màn hình lỗi.
  return plan ?? requireFreePlan();
}

function toUsage(
  used: { workspaces: number; reports: number; storageBytes: number },
  plan: PlanDto,
): BillingUsageDto {
  return {
    workspaces: { used: used.workspaces, limit: plan.maxWorkspaces },
    reports: { used: used.reports, limit: plan.maxReports },
    storageBytes: { used: used.storageBytes, limit: plan.maxStorageBytes },
  };
}

/** Toàn bộ trang Billing trong một lần gọi. */
export async function buildBillingSummary(
  tenantId: number,
  now: Date,
): Promise<BillingSummaryDto> {
  /*
   * Cho hết hạn TRƯỚC khi đọc — kiểm lười.
   *
   * Con cron chạy mỗi vài phút, nên một đơn vừa quá hạn ba giây vẫn mang trạng
   * thái `pending` trong database. Không có dòng này thì màn hình hiện "đang
   * chờ thanh toán" cho một đơn đã chết, và người dùng ngồi đợi một mã QR không
   * còn tác dụng.
   *
   * Rẻ: câu UPDATE dùng `idx_orders_status_expires` và gần như luôn khớp 0 dòng.
   */
  await billingRepo.expireOverdueOrders(mysqlPool, now, tenantId);

  // Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và tiết kiệm
  // vài mili-giây bằng cách chiếm gấp ba connection là đổi chác sai chiều —
  // cùng lập luận đã ghi ở `GET /admin/overview`.
  const subscription = await billingRepo.findActiveSubscription(mysqlPool, tenantId, now);
  const plan =
    subscription === null
      ? await requireFreePlan()
      : ((await billingRepo.findPlanById(mysqlPool, subscription.planId)) ??
        (await requireFreePlan()));
  const used = await usageRepo.fetchTenantUsage(mysqlPool, tenantId);

  return {
    plan,
    // Bỏ `planId` khỏi DTO — nó là chi tiết nội bộ của repository, không phải
    // thứ giao diện cần biết.
    subscription:
      subscription === null
        ? null
        : {
            id: subscription.id,
            planCode: subscription.planCode,
            planName: subscription.planName,
            status: subscription.status,
            source: subscription.source,
            priceVnd: subscription.priceVnd,
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
            carriedOverDays: subscription.carriedOverDays,
          },
    usage: toUsage(used, plan),
  };
}
