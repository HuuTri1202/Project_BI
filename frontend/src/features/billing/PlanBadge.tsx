import { Link } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { useBillingSummary } from './hooks';

/**
 * Huy hiệu gói trên sidebar — §11.
 *
 * ─── Vì sao đặt cạnh "BI Platform", không phải trong bộ chuyển tổ chức ─────
 *
 * Chỗ tự nhiên nhất trông như là `TenantSwitcher`, ngay cạnh tên tổ chức. Nhưng
 * component đó `return null` khi người dùng chỉ thuộc MỘT tổ chức — tức là với
 * phần lớn người dùng, và họ sẽ không bao giờ thấy huy hiệu. Khối tên sản phẩm
 * thì luôn hiện.
 *
 * ─── Ẩn hoàn toàn khi không có quyền ───────────────────────────────────────
 *
 * `manageBilling` chỉ thuộc về admin của tổ chức. Hiện huy hiệu cho creator sẽ
 * vừa lộ thông tin thương mại, vừa mời họ bấm vào một trang trả 403.
 *
 * Không hiện gì trong lúc đang tải, và cũng không hiện khung xám nhấp nháy: đây
 * là thông tin phụ trên một thanh điều hướng, và một ô nhấp nháy ở đó kéo mắt
 * khỏi thứ người dùng đang định bấm.
 */
export function PlanBadge(): React.ReactElement | null {
  const permissions = usePermissions();
  const { data } = useBillingSummary();

  if (!permissions.manageBilling || data === undefined) return null;

  const traPhi = data.plan.priceVnd > 0;

  return (
    <Link
      to="/billing"
      title={`Tổ chức đang dùng gói ${data.plan.name}`}
      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase transition-colors ${
        traPhi
          ? 'bg-brand-600 text-white hover:bg-brand-500'
          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {data.plan.name}
    </Link>
  );
}
