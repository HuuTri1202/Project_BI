import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { HoiDapPanel } from './HoiDapPanel';
import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from './nguCanh';

/**
 * ⚠️ `HoiDapPanel` nạp SẴN, và đã có người thử nạp lười nó rồi — đừng thử lại
 * mà không đọc hết đoạn này.
 *
 * Provider gắn panel ở MỌI trang đã đăng nhập, nên nhìn từ ngoài nó là ứng viên
 * nạp lười đẹp nhất của cả app. Đã làm thật, đã đo, rồi trả lại:
 *
 *     tách được:  HoiDapPanel 7,41 kB + goiYBieuDo 13,38 kB = 20,8 kB gzip
 *     giá phải trả: 82 ca trong `hoiDapPanel.test.tsx` đỏ
 *
 * Và 82 ca đó KHÔNG đỏ vì chúng viết dở. Helper `dung()` của chúng `render` rồi
 * query ngay trong cùng một nhịp đồng bộ — đúng cách một bài test nên viết. Với
 * `lazy`, component chưa có mặt ở lần render đầu dù promise đã xong, nên mọi
 * `getBy*` ngay sau `render` đều trượt. Chữa nó nghĩa là `await dung(...)` ở 82
 * chỗ và biến gần như toàn bộ tệp thành `async` — tức biến bài test canh HÀNH VI
 * của panel thành một tệp nói về thời điểm tải code.
 *
 * 20,8 kB không mua được chỗ đó. Chunk vào cổng đã từ 364 kB xuống 154 kB gzip
 * bằng hai việc khác (nạp lười trang trong `App.tsx`, nạp lười wizard tải tệp
 * trong `CreateReportMenu`), và cả hai không làm đỏ một ca nào.
 *
 * Đường nạp lười được panel mà KHÔNG phá 82 ca đó là tách cái nút mở thành một
 * component riêng nạp sẵn, rồi nạp lười phần thân — nhưng các ca kia bấm nút
 * xong cũng query đồng bộ phần thân, nên nó cũng không đủ. Việc thật sự cần làm
 * trước là cho `dung()` một đường chờ, và đó là một thay đổi của tệp test chứ
 * không phải của tệp này.
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
