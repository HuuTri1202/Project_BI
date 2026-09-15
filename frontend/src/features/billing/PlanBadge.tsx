import { Link } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { useTenantPlan } from './hooks';

/**
 * Huy hiệu gói trên sidebar — §11.
 *
 * ─── Vì sao đặt cạnh tên sản phẩm, không phải trong bộ chuyển tổ chức ──────
 *
 * Chỗ tự nhiên nhất trông như là `TenantSwitcher`, ngay cạnh tên tổ chức. Nhưng
 * component đó `return null` khi người dùng chỉ thuộc MỘT tổ chức — tức là với
 * phần lớn người dùng, và họ sẽ không bao giờ thấy huy hiệu. Khối tên sản phẩm
 * thì luôn hiện.
 *
 * ─── Hiện cho MỌI thành viên, nhưng chỉ admin bấm được ─────────────────────
 *
 * Bản trước ẩn hẳn huy hiệu với người không có `manageBilling`. Hệ quả: gói gắn
 * với TỔ CHỨC, quản trị viên mua gói Doanh nghiệp, mà creator và viewer của tổ
 * chức đó nhìn sidebar không thấy gói nào — trông như chỉ người mua mới được
 * hưởng. Họ vẫn đang dùng chung gói; họ chỉ không được biết.
 *
 * Nên huy hiệu đọc `GET /v1/billing/plan` (mọi vai trò) thay vì `/billing/me`
 * (chỉ admin). Với người không quản lý thanh toán nó là một nhãn, không phải
 * một link: trang `/billing` trả 403 cho họ, và mời bấm vào đó tệ hơn không mời.
 *
 * Không hiện gì trong lúc đang tải, và cũng không hiện khung xám nhấp nháy: đây
 * là thông tin phụ trên một thanh điều hướng, và một ô nhấp nháy ở đó kéo mắt
 * khỏi thứ người dùng đang định bấm.
 *
 * ─── Luôn một dòng ──────────────────────────────────────────────────────────
 *
 * Dòng đầu sidebar chỉ có 208px. "Open Insight" cộng "CHUYÊN NGHIỆP" giãn chữ
 * `tracking-wide` dài hơn thế 2px, và flex ép cả tên sản phẩm lẫn huy hiệu gãy
 * làm hai dòng. Bỏ giãn chữ thì ba gói có sẵn vừa một dòng. Tên gói do quản trị
 * hệ thống đặt, nên một tên dài hơn bị cắt "…" (tên đủ ở `title`) thay vì đẩy
 * tên sản phẩm xuống dòng.
 */
export function PlanBadge(): React.ReactElement | null {
  const permissions = usePermissions();
  const { data } = useTenantPlan();

  if (data === undefined) return null;

  const mau = data.isPaid ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400';
  const khung = `ml-1.5 min-w-0 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${mau}`;

  if (!permissions.manageBilling) {
    return (
      <span className={khung} title={`Tổ chức đang dùng gói ${data.planName}`}>
        {data.planName}
      </span>
    );
  }

  return (
    <Link
      to="/billing"
      title={`Tổ chức đang dùng gói ${data.planName}`}
      className={`${khung} transition-colors ${
        data.isPaid ? 'hover:bg-brand-500' : 'hover:text-slate-200'
      }`}
    >
      {data.planName}
    </Link>
  );
}
