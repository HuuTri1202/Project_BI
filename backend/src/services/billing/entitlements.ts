import type { BillingSummaryDto, BillingUsageDto, PlanDto } from '@bi/shared';

import * as billingRepo from '../../repositories/billing';
import type { Db } from '../../repositories/db';
import * as usageRepo from '../../repositories/usage';
import { FREE_PLAN_CODE, hanMucHieuLuc, type HanMucHieuLuc } from './limits';

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
 *
 * ═══ §11.2: hạn mức KHÔNG còn đọc sống từ bảng giá ═════════════════════════
 *
 * `resolveCurrentPlan` từng sống ở file này và đọc hạn mức thẳng từ `plans`.
 * Docblock của nó kết thúc bằng một điều kiện: "ngày nó bắt đầu CHẶN thao tác
 * thì quyết định này phải xem lại". Ngày đó đã tới, nên hàm đó bị gỡ — nó không
 * còn nơi gọi nào, và để lại một hàm mang chính sách đã bị thay là để lại một
 * cái bẫy cho người sửa sau. Nguồn hạn mức duy nhất giờ là `limits.ts`.
 */

export { FREE_PLAN_CODE };

/**
 * Ghép hạn mức HIỆU LỰC vào bản mô tả gói.
 *
 * ⚠️ Đây là chỗ giữ cho MỘT payload không chứa hai con số trái ngược nhau.
 * `BillingSummaryDto` có hạn mức ở hai nơi — `plan.maxWorkspaces` và
 * `usage.workspaces.limit` — và giao diện đọc cả hai. Nếu một bên đọc sống từ
 * bảng giá còn bên kia đọc ảnh chụp thì màn hình hiện "3/10" trong khi API chặn
 * ở 5, và bộ phận hỗ trợ không giải thích được cho khách.
 *
 * Nên cả hai lấy từ cùng một nguồn, ngay tại đây.
 */
function apHanMuc(plan: PlanDto, hanMuc: HanMucHieuLuc): PlanDto {
  return {
    ...plan,
    maxWorkspaces: hanMuc.workspaces,
    maxReports: hanMuc.reports,
    maxMembers: hanMuc.members,
    maxStorageBytes: hanMuc.storageBytes,
  };
}

function toUsage(used: usageRepo.TenantUsage, plan: PlanDto): BillingUsageDto {
  return {
    workspaces: { used: used.workspaces, limit: plan.maxWorkspaces },
    reports: { used: used.reports, limit: plan.maxReports },
    members: { used: used.members, limit: plan.maxMembers },
    storageBytes: { used: used.storageBytes, limit: plan.maxStorageBytes },
  };
}

/** Toàn bộ trang Billing trong một lần gọi. */
export async function buildBillingSummary(
  db: Db,
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
  await billingRepo.expireOverdueOrders(db, now, tenantId);

  // Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và tiết kiệm
  // vài mili-giây bằng cách chiếm gấp ba connection là đổi chác sai chiều —
  // cùng lập luận đã ghi ở `GET /admin/overview`.
  const subscription = await billingRepo.findActiveSubscription(db, tenantId, now);
  const goc =
    subscription === null
      ? await requireFreePlan(db)
      : ((await billingRepo.findPlanById(db, subscription.planId)) ?? (await requireFreePlan(db)));

  // Hạn mức đi qua `limits.ts`, không đọc thẳng `goc.max*` — xem `apHanMuc`.
  const plan = apHanMuc(goc, await hanMucHieuLuc(db, tenantId, now));
  const used = await usageRepo.fetchTenantUsage(db, tenantId);

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

/**
 * Bản mô tả gói Free, dùng khi tổ chức chưa mua gì.
 *
 * Ném lỗi thay vì trả về một gói rỗng bịa ra tại chỗ: nếu dòng `free` không còn
 * trong bảng thì mọi hạn mức hiển thị đều sai, và một gói bịa sẽ khiến màn hình
 * trông bình thường trong khi con số nó hiện không đến từ đâu cả. Hỏng to và
 * hỏng sớm còn hơn hỏng nhỏ và im lặng.
 */
async function requireFreePlan(db: Db): Promise<PlanDto> {
  const plan = await billingRepo.findPlanByCode(db, FREE_PLAN_CODE);
  if (plan === null) {
    throw new Error(
      `Không tìm thấy gói '${FREE_PLAN_CODE}' trong bảng plans. ` +
        'Nó được gieo ở migration 30 — hãy chạy "npm run -w backend migrate".',
    );
  }
  return plan;
}
