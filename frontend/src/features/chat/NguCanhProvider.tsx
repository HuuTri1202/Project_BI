import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const HoiDapPanel = lazy(() => import('./HoiDapPanel').then((m) => ({ default: m.HoiDapPanel })));
import { NGU_CANH_RONG, NguCanhContext, type NguCanh } from './nguCanh';

/**
 * `HoiDapPanel` nạp LƯỜI — và lần trước việc này đã bị trả lại, nên đọc hết
 * đoạn này trước khi đổi lại.
 *
 * Provider gắn panel ở MỌI trang đã đăng nhập, nên nó nằm trong chunk vào cổng
 * dù người dùng chưa bao giờ bấm con robot. Tách ra, đo bằng `npm run build`:
 *
 *     HoiDapPanel 7,41 kB + goiYBieuDo 13,38 kB = 20,8 kB gzip
 *
 * ─── Lần trước trả lại vì cái gì, và vì sao giờ thì được ────────────────────
 *
 * `lazy` chỉ dựng component ở lần render SAU khi promise xong, nên mọi `getBy*`
 * gọi ngay trong cùng nhịp đồng bộ với `render` đều trượt — kể cả khi module đã
 * nằm sẵn trong bộ nhớ. Helper `dung()` của `hoiDapPanel.test.tsx` render rồi
 * query ngay, đúng cách một bài test nên viết, nên 82 ca đỏ cùng lúc.
 *
 * Chỗ phải sửa là HELPER, không phải 82 ca: `dung()` giờ `await` đúng cái nút
 * thu gọn của panel, một lần, ở một chỗ. Mỗi ca vẫn render-rồi-query-đồng-bộ y
 * như trước; khác duy nhất là chữ `await` ở lời gọi. Bài test vẫn canh HÀNH VI
 * của panel, không biến thành tệp nói về thời điểm tải code.
 *
 * ─── `fallback={null}`, có chủ đích ─────────────────────────────────────────
 *
 * Panel là một cái nút nổi ở góc phải dưới. Một ô xám nhảy vào đó rồi biến
 * thành con robot thì ồn hơn là việc con robot xuất hiện muộn vài chục ms —
 * và không ai đang CHỜ nó để làm việc gì.
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
      <Suspense fallback={null}>
        <HoiDapPanel />
      </Suspense>
    </NguCanhContext.Provider>
  );
}
