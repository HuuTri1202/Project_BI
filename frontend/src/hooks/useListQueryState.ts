import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Trạng thái danh sách nằm trong URL, không nằm trong `useState`.
 *
 * Đổi lấy ba thứ mà state trong component không cho được: link chia sẻ được
 * (gửi đồng nghiệp đúng bộ lọc mình đang xem), F5 không mất bộ lọc, và nút Back
 * hoạt động đúng như người dùng mong đợi.
 *
 * Nó cũng làm luôn phần debounce cho react-query: query key dẫn xuất từ URL,
 * nên chỉ khi URL đổi mới có request mới — không cần AbortController.
 *
 * Viết tổng quát cho cả ba trang (tenant, user, workspace) vì cả ba cần đúng
 * một hành vi; ba bản chép tay sẽ lệch nhau ở chi tiết "reset trang".
 *
 * ─── Về kiểu ────────────────────────────────────────────────────────────────
 *
 * `update` nhận `string | number` cho mọi trường, KHÔNG phải kiểu hẹp của `T`.
 * Lý do: giá trị đến từ `<select>` và `<input>` luôn là `string` thô. Bắt nơi
 * gọi ép kiểu ở từng chỗ (`status as '' | 'active' | 'locked'`) chỉ tạo ra hàng
 * chục phép ép rải rác — mà ép kiểu là nói dối với trình biên dịch, không phải
 * kiểm tra.
 *
 * Thứ THẬT SỰ bảo đảm giá trị hợp lệ là bảng `allowed`: mọi giá trị đọc từ URL
 * đều phải nằm trong whitelist mới được nhận, còn lại thoái lui về mặc định.
 * Nên `query` trả ra đúng kiểu `T` là sự thật, không phải lời hứa suông.
 */
export function useListQueryState<T extends object>(
  defaults: T,
  /** Giá trị hợp lệ của từng trường; trường không khai thì nhận mọi chuỗi. */
  allowed: Partial<Record<keyof T, readonly string[]>> = {},
): {
  query: T;
  update: (patch: Partial<Record<keyof T, string | number>>) => void;
  reset: () => void;
} {
  const [params, setParams] = useSearchParams();

  const query = useMemo<T>(() => {
    const result = { ...defaults } as Record<string, string | number>;
    const fallbacks = defaults as Record<string, string | number>;

    for (const key of Object.keys(fallbacks)) {
      const raw = params.get(key);
      if (raw === null || raw === '') continue;

      // Đọc phòng thủ từng trường: `?page=abc` gõ tay hoặc link cũ bị cắt phải
      // thoái lui về mặc định, không được ném lỗi giữa lúc render.
      if (typeof fallbacks[key] === 'number') {
        const num = Number(raw);
        if (Number.isInteger(num) && num > 0) result[key] = num;
        continue;
      }

      const whitelist = allowed[key as keyof T];
      if (whitelist && !whitelist.includes(raw)) continue;
      result[key] = raw;
    }
    return result as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback(
    (patch: Partial<Record<keyof T, string | number>>) => {
      const fallbacks = defaults as Record<string, string | number>;
      const next: Record<string, string | number> = {
        ...(query as Record<string, string | number>),
        ...(patch as Record<string, string | number>),
      };

      // MỌI thay đổi bộ lọc/sắp xếp đều đưa về trang 1, trừ khi chính `page` là
      // thứ đang được đổi. Không có dòng này thì đang ở trang 5 mà lọc còn 2 kết
      // quả sẽ ra bảng trống, không lời giải thích — người dùng tưởng dữ liệu
      // biến mất.
      if ('page' in fallbacks && !('page' in patch)) next['page'] = 1;

      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        // Chỉ ghi những tham số KHÁC mặc định, để URL sạch và dễ đọc.
        if (value !== '' && value !== fallbacks[key]) search.set(key, String(value));
      }
      // `replace: true`: gõ tìm kiếm mà đẩy một mục lịch sử cho mỗi phím thì
      // người dùng phải bấm Back cả chục lần mới rời được trang.
      setParams(search, { replace: true });
    },
    [query, defaults, setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { query, update, reset };
}
