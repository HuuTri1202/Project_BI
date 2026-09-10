import type { BillingCycle, PlanDto } from '@bi/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ErrorState, TableSkeleton } from '../../../components/ui/states';
import { dinhDangHanMuc, dinhDangTien } from '../../../features/billing/format';
import {
  useBillingSummary,
  usePaymentMethods,
  usePlans,
} from '../../../features/billing/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Bảng giá — §11.
 *
 * Gói lấy từ DATABASE, không hardcode: người vận hành đổi giá hay thêm gói ở
 * console và trang này đổi theo, không cần build lại.
 */

/**
 * Trả 10 tháng, dùng 12 — phải KHỚP `YEARLY_PAID_MONTHS` ở backend.
 *
 * Chép tay có chủ ý: đây là hằng số của chính sách giá, và backend là nơi TÍNH
 * TIỀN thật. Con số ở đây chỉ để hiện trước cho người dùng thấy, còn số tiền
 * trên đơn luôn do backend chốt — nên hai bên lệch nhau thì người dùng thấy giá
 * khác lúc bấm, chứ không bị tính sai tiền.
 */
const YEARLY_PAID_MONTHS = 10;

function giaTheoChuKy(plan: PlanDto, cycle: BillingCycle): number {
  return cycle === 'yearly' ? plan.priceVnd * YEARLY_PAID_MONTHS : plan.priceVnd;
}

function PlanCard({
  plan,
  cycle,
  dangDung,
  onChon,
  disabled,
}: {
  plan: PlanDto;
  cycle: BillingCycle;
  dangDung: boolean;
  onChon: () => void;
  disabled: boolean;
}): React.ReactElement {
  const mienPhi = plan.priceVnd === 0;
  const gia = giaTheoChuKy(plan, cycle);

  return (
    <div
      className={`flex flex-col rounded-xl border bg-white p-5 ${
        plan.isFeatured ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
        {plan.isFeatured && <Badge tone="brand">Phổ biến</Badge>}
        {dangDung && <Badge tone="success">Đang dùng</Badge>}
      </div>

      {plan.description !== null && (
        <p className="mt-1 min-h-10 text-sm text-slate-500">{plan.description}</p>
      )}

      <p className="mt-3">
        <span className="text-2xl font-bold tabular-nums text-slate-900">
          {mienPhi ? 'Miễn phí' : dinhDangTien(gia)}
        </span>
        {!mienPhi && (
          <span className="ml-1 text-sm text-slate-500">
            /{cycle === 'yearly' ? 'năm' : 'tháng'}
          </span>
        )}
      </p>

      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-600">
        <li>{dinhDangHanMuc(plan.maxWorkspaces)} workspace</li>
        <li>{dinhDangHanMuc(plan.maxReports)} báo cáo</li>
        <li>{dinhDangHanMuc(plan.maxMembers)} thành viên</li>
        <li>{dinhDangHanMuc(plan.maxStorageBytes, true)} dung lượng</li>
      </ul>

      <div className="mt-5">
        {mienPhi ? (
          // Gói mặc định không mua được, và nói ra vì sao thay vì để một nút mờ
          // không giải thích gì.
          <p className="text-center text-sm text-slate-400">Gói mặc định</p>
        ) : dangDung ? (
          <Button onClick={onChon} disabled={disabled}>
            Gia hạn
          </Button>
        ) : (
          <Button variant="primary" onClick={onChon} disabled={disabled}>
            Nâng cấp ngay
          </Button>
        )}
      </div>
    </div>
  );
}

export default function PlansPage(): React.ReactElement {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const navigate = useNavigate();

  const { data: plans, isPending, isError, error } = usePlans();
  const summary = useBillingSummary();
  const methods = usePaymentMethods();

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending || plans === undefined) return <TableSkeleton rows={3} />;

  /*
   * Không có phương thức nào DÙNG ĐƯỢC thì nói ngay ở đây.
   *
   * Migration cố ý gieo phương thức chuyển khoản với số tài khoản để trống, nên
   * đây là trạng thái của mọi lần cài mới — không phải trường hợp hiếm. Để
   * người dùng bấm "Nâng cấp" rồi mới nhận lỗi ở màn thanh toán là bắt họ đi
   * hết một quãng đường cụt.
   */
  const sanSang = (methods.data ?? []).filter((m) => m.isConfigured);
  const chuaCauHinh = methods.data !== undefined && sanSang.length === 0;

  return (
    <div className="space-y-4 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Chọn gói phù hợp với quy mô của tổ chức. Nâng cấp có hiệu lực ngay.
        </p>

        {/* Nhóm hai nút thay vì một select: chỉ có hai lựa chọn, và người dùng
            cần THẤY cả hai để so sánh giá. */}
        <div
          role="group"
          aria-label="Chu kỳ thanh toán"
          className="flex rounded-lg border border-slate-300 p-0.5"
        >
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                cycle === c ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {c === 'monthly' ? 'Theo tháng' : `Theo năm (giảm ${12 - YEARLY_PAID_MONTHS} tháng)`}
            </button>
          ))}
        </div>
      </div>

      {chuaCauHinh && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hệ thống <strong>chưa cấu hình phương thức thanh toán</strong> nên chưa đặt mua được.
          Hãy báo quản trị viên hệ thống điền thông tin tài khoản nhận tiền.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            cycle={cycle}
            dangDung={summary.data?.plan.code === plan.code}
            disabled={chuaCauHinh}
            // Chuyển sang màn thanh toán mang theo lựa chọn, thay vì tạo đơn
            // ngay tại đây: người dùng còn phải chọn phương thức, và một đơn
            // tạo ra rồi bỏ dở là một mã QR chờ tiền mà không ai định trả.
            onChon={() => navigate(`/billing/checkout/${String(plan.id)}?cycle=${cycle}`)}
          />
        ))}
      </div>
    </div>
  );
}
