import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { UsageBar } from '../../../features/billing/UsageBar';
import { dinhDangNgay, dinhDangTien } from '../../../features/billing/format';
import { useBillingSummary, useSubscriptionHistory } from '../../../features/billing/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Tổng quan của trang Thanh toán — §11.
 *
 * Ba khối, theo đúng thứ tự người dùng cần biết: đang ở gói nào và tới bao giờ,
 * đã dùng bao nhiêu, và đã mua những gì.
 */

/**
 * Số ngày còn lại, làm tròn LÊN.
 *
 * Lên chứ không xuống: gói hết hạn lúc 23:00 hôm nay thì "còn 1 ngày" đúng hơn
 * "còn 0 ngày" — con số 0 đọc như đã hết, trong khi người dùng vẫn còn cả buổi
 * tối để gia hạn.
 */
function ngayConLai(periodEnd: string): number {
  const ms = new Date(periodEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Cảnh báo khi gói sắp hết. Một tuần là đủ để kịp làm thủ tục chuyển khoản. */
const NGUONG_SAP_HET = 7;

export default function BillingOverviewPage(): React.ReactElement {
  const { data, isPending, isError, error } = useBillingSummary();
  const history = useSubscriptionHistory();

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending || data === undefined) return <TableSkeleton rows={6} />;

  const { plan, subscription, usage } = data;
  const conLai = subscription === null ? null : ngayConLai(subscription.periodEnd);

  return (
    <div className="space-y-5 overflow-y-auto pr-1">
      {/* ─── Gói hiện tại ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">{plan.name}</h2>
              {/* Gói Free là trạng thái MẶC ĐỊNH, không phải một lựa chọn kém —
                  nên nhãn trung tính, không phải cảnh báo. */}
              <Badge tone={plan.priceVnd === 0 ? 'neutral' : 'brand'}>
                {plan.priceVnd === 0 ? 'Miễn phí' : dinhDangTien(plan.priceVnd)}
              </Badge>
            </div>
            {plan.description !== null && (
              <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
            )}
          </div>

          {subscription === null ? (
            <Link to="/billing/plans">
              <Button variant="primary">Nâng cấp gói</Button>
            </Link>
          ) : (
            <div className="text-right text-sm">
              <p className="text-slate-500">Hiệu lực tới</p>
              <p className="font-medium text-slate-900">
                {dinhDangNgay(subscription.periodEnd)}
              </p>
            </div>
          )}
        </div>

        {/*
          Tổ chức chưa mua gì thì `subscription` là NULL — câu trả lời bình
          thường, không phải lỗi hay trạng thái đang tải. Nói ra bằng một câu
          thay vì để một khoảng trống mà người dùng phải tự diễn giải.
        */}
        {subscription === null ? (
          <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
            Tổ chức đang dùng gói mặc định. Nâng cấp để có thêm workspace, báo cáo và dung lượng.
          </p>
        ) : (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Bắt đầu</span>
              <span className="text-slate-700">{dinhDangNgay(subscription.periodStart)}</span>
            </div>
            {/* Số ngày được cộng thêm phải NÓI RA. Không có nó thì ngày hết hạn
                là một con số rơi từ trên trời xuống, và bộ phận hỗ trợ phải
                tính tay mỗi lần khách hỏi vì sao lại là ngày đó. */}
            {subscription.carriedOverDays > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Cộng thêm từ gói cũ</span>
                <span className="text-slate-700">{subscription.carriedOverDays} ngày</span>
              </div>
            )}
            {subscription.source === 'admin_override' && (
              <p className="text-xs text-slate-500">
                Gói này do quản trị viên hệ thống cấp theo thoả thuận riêng.
              </p>
            )}
            {conLai !== null && conLai <= NGUONG_SAP_HET && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Gói còn <strong>{conLai} ngày</strong>. Gia hạn sớm không mất ngày — số ngày còn
                lại được cộng sang chu kỳ mới.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ─── Mức sử dụng ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Mức sử dụng</h2>
        {/* Câu này trước §11.2 ghi "vượt hạn mức không khoá tính năng nào" — từ
            ngày lớp chặn có thật thì nó là câu nói dối, và một câu nói dối ở
            đúng chỗ người dùng tra cứu trước khi mua là thứ đắt nhất. */}
        <p className="mt-0.5 text-sm text-slate-500">
          So với hạn mức của gói {plan.name}. Chạm hạn mức thì không tạo thêm được, nhưng dữ
          liệu đã có vẫn giữ nguyên và dùng bình thường.
        </p>

        <div className="mt-4 space-y-4">
          <UsageBar label="Workspace" item={usage.workspaces} />
          <UsageBar label="Báo cáo" item={usage.reports} />
          {/* Thành viên đếm theo CHỖ: người bị khoá tạm vẫn tính, người đã gỡ thì
              không — bằng đúng số dòng ở màn hình Thành viên. */}
          <UsageBar label="Thành viên" item={usage.members} />
          <UsageBar label="Dung lượng" item={usage.storageBytes} storage />
        </div>
      </section>

      {/* ─── Lịch sử gói ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Lịch sử gói</h2>

        {history.isPending && <p className="mt-3 text-sm text-slate-500">Đang tải…</p>}

        {history.data !== undefined && history.data.length === 0 && (
          <div className="mt-3">
            <EmptyState
              title="Chưa có gói nào được mua"
              hint="Lịch sử sẽ hiện ở đây sau lần thanh toán đầu tiên."
            />
          </div>
        )}

        {history.data !== undefined && history.data.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {history.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-800">{s.planName}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {dinhDangNgay(s.periodStart)} – {dinhDangNgay(s.periodEnd)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-slate-600">
                    {dinhDangTien(s.priceVnd)}
                  </span>
                  <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
                    {s.status === 'active' ? 'Đang dùng' : 'Đã kết thúc'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
