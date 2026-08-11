import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import * as api from '../features/tenant/api';
import { tenantKeys } from '../features/tenant/keys';
import { getApiError } from '../services/apiClient';
import { WorkspaceContext, type WorkspaceContextValue } from './workspaceContext';
import { readRememberedWorkspace, rememberWorkspace } from './workspaceStorage';

/**
 * Giữ workspace đang mở cho cả khu người dùng (§4.6).
 *
 * ─── Ba cạm bẫy của "ghi nhớ", và cách file này tránh ───────────────────────
 *
 * 1. Id đã lưu có thể KHÔNG CÒN HỢP LỆ — workspace bị xoá ở §4.5, hoặc bị quản
 *    trị hệ thống khoá. Nên id lưu trong máy KHÔNG BAO GIỜ được dùng trực tiếp;
 *    nó chỉ là một gợi ý, và `resolved` bên dưới đối chiếu nó với danh sách thật
 *    ở mọi lần render. Không đối chiếu thì mọi truy vấn sau đó nhận 404 và người
 *    dùng kẹt ở màn hình lỗi mà không hiểu vì sao.
 *
 * 2. Xoá đúng workspace ĐANG MỞ. Danh sách được `invalidate` sau khi xoá, phép
 *    đối chiếu ở (1) thấy id cũ biến mất và tự rơi về cái đầu tiên. Không cần
 *    một `useEffect` riêng để "phát hiện đã xoá" — trạng thái dẫn xuất tự đúng.
 *
 * 3. Chọn xong rồi F5. `useEffect` ghi lại id ĐÃ ĐỐI CHIẾU, không phải id người
 *    dùng vừa bấm: nếu hai thứ khác nhau (bấm vào cái vừa bị người khác xoá) thì
 *    thứ được nhớ phải là cái thật sự đang mở.
 *
 * State cục bộ chỉ là "lựa chọn tạm của phiên này". Nguồn sự thật là danh sách
 * từ server. Đó là lý do không có `useState` nào giữ cả đối tượng workspace —
 * giữ đối tượng nghĩa là có hai bản sao và một bản sẽ cũ.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  // Khởi tạo bằng id đã nhớ, tính ngay lúc dựng state — để lần render đầu tiên
  // đã gửi đúng `workspaceId` lên `/home` thay vì gọi một lần với mặc định rồi
  // gọi lại lần nữa sau khi effect chạy.
  const [picked, setPicked] = useState<number | null>(() =>
    tenantId === null ? null : readRememberedWorkspace(tenantId),
  );

  const {
    data: all,
    isPending,
    error,
  } = useQuery({
    queryKey: tenantKeys.workspaces(),
    queryFn: api.fetchWorkspaces,
    // Không có tổ chức thì không có gì để hỏi. Xảy ra trong khoảnh khắc giữa lúc
    // provider mount và lúc `GET /me` trả lời.
    enabled: tenantId !== null,
  });

  // Chỉ workspace đang hoạt động mới chọn được. Cái bị quản trị HỆ THỐNG khoá
  // vẫn nằm trong `all` để màn §4.5 hiện nó kèm lời giải thích, nhưng đưa vào
  // dropdown thì người dùng chọn xong sẽ ăn 403 từ backend.
  const options = useMemo(() => (all ?? []).filter((w) => w.isActive), [all]);

  /**
   * Workspace thật sự đang mở — luôn TÍNH RA từ danh sách server, không lưu.
   *
   * Thứ tự ưu tiên: lựa chọn của phiên này -> id đã nhớ trong máy -> cái đầu
   * tiên. Mỗi bước đều phải tìm thấy trong `options`, nếu không thì rơi xuống
   * bước sau.
   */
  const current = useMemo(() => {
    if (options.length === 0) return null;
    const remembered = tenantId === null ? null : readRememberedWorkspace(tenantId);
    return (
      options.find((w) => w.id === picked) ??
      options.find((w) => w.id === remembered) ??
      options[0] ??
      null
    );
  }, [options, picked, tenantId]);

  // Ghi lại thứ ĐANG MỞ THẬT, không phải thứ vừa được bấm.
  useEffect(() => {
    if (tenantId === null || current === null) return;
    rememberWorkspace(tenantId, current.id);
  }, [tenantId, current]);

  const select = useCallback((workspaceId: number) => setPicked(workspaceId), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      current,
      options,
      all: all ?? [],
      isLoading: isPending && tenantId !== null,
      error: error ? getApiError(error).message : null,
      select,
    }),
    [current, options, all, isPending, tenantId, error, select],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
