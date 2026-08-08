import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UserListQuery } from './api';

const DEFAULTS: UserListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'fullName',
  order: 'asc',
  q: '',
  role: '',
  status: '',
};

const SORTS = ['fullName', 'email', 'role', 'joinedAt', 'lastLoginAt'];
const ROLES = ['admin', 'creator', 'viewer'];
const STATUSES = ['active', 'locked', 'removed'];

/**
 * Trạng thái danh sách nằm trong URL, không nằm trong `useState`.
 *
 * Đổi lấy ba thứ mà state trong component không cho được: link chia sẻ được
 * (gửi cho đồng nghiệp đúng bộ lọc mình đang xem), F5 không mất bộ lọc, và nút
 * Back của trình duyệt hoạt động đúng như người dùng mong đợi.
 *
 * Nó cũng làm luôn phần debounce cho react-query: query key dẫn xuất từ URL,
 * nên chỉ khi URL đổi mới có request mới — không cần AbortController.
 */
export function useUserListQueryState(): {
  query: UserListQuery;
  update: (patch: Partial<UserListQuery>) => void;
  reset: () => void;
} {
  const [params, setParams] = useSearchParams();

  const query = useMemo<UserListQuery>(() => {
    // Đọc phòng thủ từng trường: `?page=abc` gõ tay phải thoái lui về mặc định
    // chứ không được ném lỗi giữa lúc render.
    const num = (key: string, fallback: number, max?: number): number => {
      const raw = Number(params.get(key));
      if (!Number.isInteger(raw) || raw < 1) return fallback;
      return max === undefined ? raw : Math.min(raw, max);
    };
    const oneOf = <T extends string>(key: string, allowed: string[], fallback: T): T => {
      const raw = params.get(key) ?? '';
      return (allowed.includes(raw) ? raw : fallback) as T;
    };

    return {
      page: num('page', DEFAULTS.page),
      pageSize: num('pageSize', DEFAULTS.pageSize, 100),
      sort: oneOf('sort', SORTS, DEFAULTS.sort),
      order: oneOf<'asc' | 'desc'>('order', ['asc', 'desc'], DEFAULTS.order),
      q: params.get('q') ?? '',
      role: oneOf<UserListQuery['role']>('role', ROLES, ''),
      status: oneOf<UserListQuery['status']>('status', STATUSES, ''),
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<UserListQuery>) => {
      const next: UserListQuery = {
        ...query,
        ...patch,
        // MỌI thay đổi bộ lọc/sắp xếp đều đưa về trang 1, trừ khi chính `page`
        // là thứ đang được đổi. Không có dòng này thì đang ở trang 5 mà lọc còn
        // 2 kết quả sẽ ra bảng trống, không lời giải thích — người dùng tưởng
        // dữ liệu biến mất.
        page: patch.page ?? 1,
      };

      const search = new URLSearchParams();
      // Chỉ ghi những tham số KHÁC mặc định, để URL sạch và dễ đọc.
      if (next.page !== DEFAULTS.page) search.set('page', String(next.page));
      if (next.pageSize !== DEFAULTS.pageSize) search.set('pageSize', String(next.pageSize));
      if (next.sort !== DEFAULTS.sort) search.set('sort', next.sort);
      if (next.order !== DEFAULTS.order) search.set('order', next.order);
      if (next.q) search.set('q', next.q);
      if (next.role) search.set('role', next.role);
      if (next.status) search.set('status', next.status);

      // `replace: true`: gõ tìm kiếm mà đẩy một mục lịch sử cho mỗi phím thì
      // người dùng phải bấm Back cả chục lần mới rời được trang.
      setParams(search, { replace: true });
    },
    [query, setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { query, update, reset };
}
