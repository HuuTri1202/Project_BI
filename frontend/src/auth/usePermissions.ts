import {
  can,
  matrixForRole,
  type Action,
  type PermissionMatrixDto,
  type Resource,
} from '@bi/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '../services/apiClient';
import { useAuth } from './useAuth';

/**
 * Quyền của người đang đăng nhập — §6.8.
 *
 * ─── Nguồn sự thật là Casbin ở backend ──────────────────────────────────────
 *
 * Trước §6, hook này đọc một bảng chép tay trong `shared/src/permissions.ts`.
 * Bảng chép tay thì sớm muộn cũng lệch khỏi policy thật trong `casbin_rule`, và
 * lệch kiểu nào cũng tệ: hiện nút dẫn thẳng tới 403, hoặc giấu mất chức năng
 * người dùng có quyền dùng.
 *
 * Giờ ma trận do `GET /v1/permissions` trả về, tính bằng chính enforcer đang gác
 * các endpoint. Hai bên không thể lệch nhau nữa vì chỉ còn một bên.
 *
 * ─── Vì sao vẫn giữ `matrixForRole` làm giá trị tạm ─────────────────────────
 *
 * Request kia mất một nhịp mạng. Không có giá trị tạm thì mỗi lần mở app, sidebar
 * và mọi nút hành động sẽ vắng mặt rồi hiện ra — người dùng thấy giao diện giật
 * và tưởng mình vừa bị mất quyền. `matrixForRole` là bản sao ma trận mặc định
 * (§6.3) nên đúng trong hầu hết trường hợp; khi câu trả lời thật về, nó bị thay.
 *
 * Đây CHỈ là chuyện hiển thị. Thực thi thật nằm ở `authorize()` phía backend —
 * đoán sai ở đây cùng lắm là hiện nhầm một nút trong nửa giây, không mở thêm
 * quyền nào cả.
 */
/**
 * Tên những ô quyền hay dùng.
 *
 * `keyof Permissions` không dùng được vì nó gồm cả `matrix` và `can` — hai thứ
 * không phải boolean. Khai tường minh để `<TenantAdminRoute needs="...">` và
 * mục sidebar chỉ nhận đúng những tên có nghĩa.
 */
export type PermissionFlag =
  | 'manageMembers'
  | 'manageWorkspaces'
  | 'manageTenant'
  | 'manageConnections'
  | 'manageOrgConnections'
  | 'managePersonalConnections'
  | 'readDatasets'
  | 'readDataModels'
  | 'editContent'
  | 'adminConsole';

export type Permissions = Record<PermissionFlag, boolean> & {
  /** Ma trận đầy đủ, dùng khi cần hỏi một ô bất kỳ. */
  matrix: PermissionMatrixDto;
  can: (resource: Resource, action: Action) => boolean;

  /* Những ô hay dùng, đặt tên theo NGHIỆP VỤ để nơi gọi khỏi nhớ cặp
     (tài nguyên, hành động). Mỗi cái khớp đúng một guard ở backend. */

  /** §5.5, §5.6 — mời, đổi vai trò, khoá, gỡ thành viên. */
  manageMembers: boolean;
  /** §5.2 — tạo, đổi tên, xoá workspace. */
  manageWorkspaces: boolean;
  /** §6.2 — đổi tên tổ chức và cấu hình cấp tổ chức. */
  manageTenant: boolean;
  /**
   * §8 — thêm, sửa, xoá kết nối tới CSDL của khách hàng.
   *
   * Từ migration 28 thì creator cũng có. Dùng cho những chỗ chỉ cần biết "người
   * này có dựng được kết nối không" mà không quan tâm kết nối ấy thuộc về ai —
   * ví dụ câu chỉ dẫn trong hộp thoại Đồng bộ.
   */
  manageConnections: boolean;
  /**
   * Kết nối người này tạo thuộc về TỔ CHỨC (`visibility = 'shared'`).
   *
   * ─── Vì sao có `role` trong một hook đọc ma trận ──────────────────────────
   *
   * Vì đây là một khác biệt CÓ THẬT, do backend cưỡng chế, mà ma trận không
   * diễn đạt nổi: `createConnection` đặt `visibility` theo vai trò người tạo —
   * admin ra `shared`, ai khác ra `private`. Casbin thì cho cả hai cùng một ô
   * `connection:modify`, nên hỏi ma trận sẽ ra cùng một câu trả lời cho hai
   * hành vi khác hẳn nhau.
   *
   * Cùng hình dạng với `adminConsole` ngay dưới: một ô đọc từ trục vai trò chứ
   * không từ ma trận, và nói rõ ra để người đọc không tưởng chúng cùng loại.
   */
  manageOrgConnections: boolean;
  /** Kết nối người này tạo là của RIÊNG họ (`visibility = 'private'`). */
  managePersonalConnections: boolean;
  /**
   * §8.5 — mở được Kho dữ liệu.
   *
   * KHÔNG còn "mọi vai trò đều có": viewer mất quyền này ở migration 26. Chú
   * thích cũ ghi như vậy, và đó chính là lý do sidebar lẫn route đều không hỏi
   * ô này — một câu mô tả hết đúng mà không ai đọc lại.
   */
  readDatasets: boolean;
  /** §10 — mở được Mô hình dữ liệu. Cùng luật với `readDatasets`: viewer không có. */
  readDataModels: boolean;
  /** Tạo và sửa báo cáo, biểu đồ. */
  editContent: boolean;
  /** Console vận hành hệ thống — trục NỀN TẢNG, không phải trục tổ chức. */
  adminConsole: boolean;
};

export function usePermissions(): Permissions {
  const { role, user, status } = useAuth();

  const { data } = useQuery({
    queryKey: ['permissions'],
    queryFn: async (): Promise<PermissionMatrixDto> => {
      const res = await apiClient.get<PermissionMatrixDto>('/v1/permissions');
      return res.data;
    },
    // Chỉ hỏi khi đã có phiên. Gọi sớm hơn là chắc chắn ăn 401.
    enabled: status === 'authenticated',
    // Ma trận đổi khi vai trò đổi, mà đổi vai trò thì đi qua đăng nhập lại hoặc
    // `switchTenant` — cả hai đều `queryClient.clear()`. Nên trong một phiên nó
    // không bao giờ cũ, và refetch mỗi lần focus cửa sổ là lãng phí.
    staleTime: Infinity,
  });

  const matrix = useMemo(() => data ?? matrixForRole(role), [data, role]);

  return useMemo(
    () => ({
      matrix,
      can: (resource: Resource, action: Action) => can(matrix, resource, action),
      manageMembers: can(matrix, 'member', 'invite'),
      manageWorkspaces: can(matrix, 'workspace', 'modify'),
      manageTenant: can(matrix, 'tenant', 'modify'),
      manageConnections: can(matrix, 'connection', 'modify'),
      manageOrgConnections: can(matrix, 'connection', 'modify') && role === 'admin',
      managePersonalConnections: can(matrix, 'connection', 'modify') && role !== 'admin',
      readDatasets: can(matrix, 'dataset', 'read'),
      readDataModels: can(matrix, 'datamodel', 'read'),
      editContent: can(matrix, 'report', 'modify'),
      // KHÔNG lấy từ ma trận: đây là trục `users.role`, hoàn toàn tách khỏi
      // policy theo tổ chức. Trộn vào cùng một object phẳng sẽ khiến người viết
      // tưởng chúng cùng loại — đúng cái lẫn lộn đã sinh ra lỗi ở
      // `ChangePasswordPage`.
      adminConsole: user?.platformRole === 'superadmin',
    }),
    [matrix, role, user?.platformRole],
  );
}
