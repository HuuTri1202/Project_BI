import { TENANT_ROLE_LABELS } from '@bi/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { getApiError } from '../../services/apiClient';
import { SidebarSwitcher, type SwitcherOption } from './SidebarSwitcher';

/**
 * Bộ chuyển TỔ CHỨC — §5.1.
 *
 * Khác hẳn bộ chuyển workspace ở một điểm quyết định: `tenantId` được KÝ trong
 * JWT, nên đổi tổ chức là một request thật (`POST /auth/switch-tenant`) cấp lại
 * token, không phải một phép đổi state cục bộ.
 *
 * Hệ quả cho giao diện:
 *
 *   - Có trạng thái chờ. Đổi workspace là tức thì; đổi tổ chức đi qua mạng và
 *     phải khoá nút trong lúc đó, nếu không hai lần bấm nhanh sẽ cấp hai token
 *     và token về sau chưa chắc là tổ chức người dùng bấm cuối.
 *   - Có trạng thái lỗi. Người dùng có thể vừa bị gỡ khỏi tổ chức đó trong lúc
 *     dropdown còn hiện tên nó — backend trả 403 và ta phải nói ra.
 *   - Sau khi đổi phải về `/home`. Đang đứng ở `/members` của công ty A mà đổi
 *     sang công ty B thì URL vẫn là `/members`, nhưng nếu ở B họ chỉ là viewer
 *     thì `TenantAdminRoute` đá sang trang 403 ngay khi vừa đổi — một màn hình
 *     lỗi cho một thao tác hoàn toàn hợp lệ.
 *
 * Chỉ hiện khi người dùng thuộc từ HAI tổ chức trở lên: một dropdown chỉ có đúng
 * một lựa chọn là thứ bấm vào rồi thất vọng.
 */
export function TenantSwitcher(): React.ReactElement | null {
  const { tenant, memberships, switchTenant } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (memberships.length < 2) return null;

  const options: SwitcherOption[] = memberships.map((m) => ({
    id: m.id,
    label: m.name,
    // Vai trò khác nhau giữa các tổ chức — hiện ra để người dùng biết trước mình
    // sang đó sẽ làm được gì.
    //
    // Với không gian riêng thì nói thẳng đó là của mình. Tài khoản do Admin tạo
    // luôn có đúng hai dòng ở đây, và nếu chỉ đọc tên thì "Không gian của Trần
    // Thu" trông y như một công ty tên lạ — người dùng sẽ không biết bấm vào sẽ
    // sang đâu.
    meta: m.isPersonal
      ? `Không gian riêng · ${TENANT_ROLE_LABELS[m.role]}`
      : TENANT_ROLE_LABELS[m.role],
  }));

  const current = options.find((o) => o.id === tenant?.id) ?? null;

  function onSelect(tenantId: number): void {
    setPending(true);
    setError(null);
    switchTenant(tenantId)
      .then(() => navigate('/home', { replace: true }))
      .catch((err: unknown) => setError(getApiError(err).message))
      .finally(() => setPending(false));
  }

  return (
    <SidebarSwitcher
      caption="Tổ chức"
      icon="M4 21V7l6-3 6 3v14M4 21h16M10 21v-4h4v4M8 11h.01M12 11h.01M8 15h.01M12 15h.01"
      current={current}
      options={options}
      onSelect={onSelect}
      emptyLabel="Không rõ tổ chức"
      pending={pending}
      error={error}
    />
  );
}
