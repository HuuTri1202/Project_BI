import { BILLING_ERROR_CODES } from '@bi/shared';
import { Link } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';

/**
 * Ô báo lỗi của form, có thêm lối đi khi lỗi là VƯỢT HẠN MỨC — §11.2.
 *
 * ─── Vì sao không để nguyên câu thông báo của server ───────────────────────
 *
 * Server đã trả một câu đủ nghĩa ("Gói Miễn phí cho tối đa 1 workspace, tổ chức
 * đang có 1. Nâng cấp gói hoặc xoá bớt workspace không còn dùng."). Nhưng chữ
 * "nâng cấp gói" trong một đoạn văn không bấm được là một việc vặt giao lại cho
 * người dùng: họ phải tự đoán trang nào, tự đi tìm trong menu, và tới nơi thì đã
 * quên mình đang định tạo cái gì.
 *
 * ─── Chỉ hiện link cho người BẤM ĐƯỢC ─────────────────────────────────────
 *
 * `manageBilling` chỉ thuộc về admin của tổ chức. Creator chạm hạn mức vẫn cần
 * đọc lý do, nhưng mời họ bấm vào một trang trả 403 thì tệ hơn không có link —
 * cùng lập luận đã ghi ở `PlanBadge`. Với họ, câu của server đã nói đúng việc
 * cần làm: đi hỏi quản trị viên tổ chức.
 */
export function LimitAlert({
  message,
  code,
}: {
  message: string | null;
  code?: string | null;
}): React.ReactElement | null {
  const permissions = usePermissions();

  if (message === null) return null;

  const vuotHanMuc = code === BILLING_ERROR_CODES.LIMIT_EXCEEDED;

  return (
    <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
      {message}
      {vuotHanMuc && permissions.manageBilling && (
        <>
          {' '}
          <Link to="/billing/plans" className="font-semibold underline underline-offset-2">
            Xem các gói
          </Link>
        </>
      )}
    </p>
  );
}
