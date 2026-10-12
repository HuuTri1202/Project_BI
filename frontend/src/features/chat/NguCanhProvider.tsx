import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { HoiDapPanel } from './HoiDapPanel';
import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from './nguCanh';

/**
 * Giữ ngữ cảnh của trang đang mở, và dựng luôn khung hỏi đáp.
 *
 * ═══ Vì sao provider tự dựng cái khung ═════════════════════════════════════
 *
 * Khung là một hộp `fixed`, không chiếm chỗ trong bố cục, nên nó không cần một
 * vị trí riêng trong cây giao diện. Gộp vào đây nghĩa là chỉ cần bọc MỘT chỗ là
 * cả khu người dùng có khung — kể cả trang báo cáo, vốn cố ý nằm ngoài
 * `UserLayout` (xem khối chú thích trong `App.tsx`). Bọc hai chỗ là hai cơ hội
 * để một chỗ bị quên khi thêm route mới.
 *
 * ═══ Vì sao gắn ngữ cảnh với ĐƯỜNG DẪN, không phải xoá bằng effect ═════════
 *
 * Toàn bộ lời hứa của tính năng này là "trả lời theo thứ đang trên màn hình".
 * Nên ngữ cảnh của trang vừa rời PHẢI biến mất — không thì câu trả lời nói về
 * một bộ dữ liệu người dùng đã đóng, mà nghe vẫn chắc chắn như thường.
 *
 * Cách hiển nhiên là một `useEffect` theo `pathname` rồi xoá. Nó SAI, và sai
 * một cách im lặng: effect của component con chạy TRƯỚC effect của cha, nên khi
 * sang trang mới thì trang mới `khai` xong rồi cha mới xoá — và xoá đúng cái
 * vừa khai. Khung thành ra trống ở mọi lần điều hướng, trừ lần đầu.
 *
 * Nên đường dẫn được lưu KÈM ngữ cảnh, và lúc đọc thì so lại. Không có effect
 * nào, không có thứ tự nào để sai: ngữ cảnh của đường dẫn khác đơn giản là
 * không được đọc tới.
 */
export function NguCanhProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { pathname } = useLocation();
  const [luu, setLuu] = useState<{ path: string; nguCanh: NguCanh } | null>(null);

  const khai = useCallback((nguCanh: NguCanh): void => {
    setLuu({ path: window.location.pathname, nguCanh });
  }, []);

  const value = useMemo(
    () => ({ nguCanh: luu !== null && luu.path === pathname ? luu.nguCanh : NGU_CANH_RONG, khai }),
    [luu, pathname, khai],
  );

  return (
    <NguCanhContext.Provider value={value}>
      {children}
      <HoiDapPanel />
    </NguCanhContext.Provider>
  );
}
