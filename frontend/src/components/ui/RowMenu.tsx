import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { choDatDoc, KHE_NEO, LE_CUA_SO } from './viTriNoi';

/** Bề rộng menu, tính bằng px. Cần con số thật để canh mép phải khi định vị. */
const MENU_W = 224;

/**
 * Menu "⋮" ở cuối một dòng bảng.
 *
 * ─── Vì sao gom vào menu thay vì bày bốn nút ────────────────────────────────
 *
 * Bốn nút thường trực trên mỗi dòng chiếm hết cột cuối và biến một bảng dữ liệu
 * thành một bảng nút bấm. Gom lại thì mắt người đọc lướt được theo cột dữ liệu,
 * và thao tác vẫn cách đúng một cú bấm.
 *
 * ─── Vì sao PORTAL chứ không `absolute` trong dòng ──────────────────────────
 *
 * Bảng nằm trong `TableWrap`, vốn có `overflow-auto` để cuộn ngang khi thiếu
 * chỗ. Một hộp `position: absolute` bên trong phần tử đó bị CẮT theo đúng vùng
 * cuộn — nên menu của dòng cuối bung xuống dưới là mất nửa dưới, hoặc tệ hơn là
 * làm hộp sinh thêm thanh cuộn rồi tự đẩy chính nó đi chỗ khác.
 *
 * `position: fixed` trong một portal ở `document.body` không có tổ tiên nào cắt
 * được nó. Cái giá: phải tự tính toạ độ từ `getBoundingClientRect()` của nút, và
 * phải đóng menu khi trang cuộn — vì `fixed` không đi theo nội dung.
 *
 * ─── Vì sao phải LẬT, không chỉ đặt xuống dưới ──────────────────────────────
 *
 * Bản đầu luôn đặt menu ngay dưới nút. Với dòng cuối của một bảng nằm sát đáy
 * cửa sổ thì "ngay dưới" là NGOÀI màn hình: đo được ở bảng Kho dữ liệu, menu
 * thò xuống dưới đáy 72px và chỉ 2/4 mục nhìn thấy được. Và vì `fixed` không
 * cuộn theo trang, hai mục kia không có đường nào tới được — cuộn trang cũng
 * chỉ làm menu đóng lại.
 *
 * Chiều cao menu thì chỉ biết SAU khi dựng (số mục thay đổi theo quyền của
 * người dùng), nên phép lật nằm trong `useLayoutEffect`: dựng ở chỗ tạm, đo,
 * rồi dời — vẫn trước lượt vẽ, nên mắt không thấy nó nhảy.
 *
 * ─── Vì sao KHÔNG dùng `<details>` hay CSS thuần ────────────────────────────
 *
 * Menu phải đóng khi bấm ra ngoài và khi bấm Escape. `<details>` không làm được
 * cả hai, nên người dùng mở nhầm một menu rồi phải bấm lại đúng nút đã mở nó —
 * và trên một bảng mười dòng thì lúc nào cũng có một menu dính lại trên màn hình.
 */
export function RowMenu({
  label = 'Thao tác',
  children,
}: {
  label?: string;
  /** Các `RowMenuItem`. Nhận `close` để tự đóng sau khi chọn. */
  children: (close: () => void) => ReactNode;
}): React.ReactElement {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = at !== null;

  function toggle(): void {
    if (open) {
      setAt(null);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect === undefined) return;

    // Chỗ TẠM: ngay dưới nút, canh mép PHẢI của menu với mép phải của nút (cột
    // thao tác nằm sát rìa bảng, nên bung sang phải là ra ngoài khung nhìn).
    // `useLayoutEffect` bên dưới dời lại nếu chỗ này không đủ.
    setAt({ top: rect.bottom + KHE_NEO, left: Math.max(LE_CUA_SO, rect.right - MENU_W) });
  }

  /*
   * Dời menu vào trong cửa sổ, sau khi đã đo được nó cao bao nhiêu. Luật đặt
   * theo chiều dọc nằm ở `viTriNoi.ts` — dùng chung với "Tạo báo cáo".
   *
   * `setAt` chỉ gọi khi toạ độ THẬT SỰ đổi — nếu không, lần chạy sau của chính
   * effect này lại đặt lại đúng giá trị cũ và vòng lặp không bao giờ dừng.
   */
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const btn = btnRef.current;
    if (at === null || menu === null || btn === null) return;

    const { top } = choDatDoc(btn.getBoundingClientRect(), menu.offsetHeight, window.innerHeight);
    const left = Math.min(
      Math.max(LE_CUA_SO, at.left),
      Math.max(LE_CUA_SO, window.innerWidth - menu.offsetWidth - LE_CUA_SO),
    );

    if (top !== at.top || left !== at.left) setAt({ top, left });
  }, [at]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) === true) return;
      if (btnRef.current?.contains(target) === true) return;
      setAt(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAt(null);
    };
    // Menu định vị `fixed` nên nó KHÔNG đi theo nội dung khi cuộn — để nguyên là
    // nó treo lơ lửng cách xa dòng đã mở nó. Đóng luôn là hành vi đúng và cũng
    // là thứ mọi menu khác làm. `capture: true` để bắt cả cuộn bên trong bảng,
    // vì sự kiện `scroll` không nổi bọt lên `document`.
    const onScroll = (): void => setAt(null);

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={`rounded-lg px-2 py-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 ${
          open ? 'bg-slate-100 text-slate-800' : ''
        }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {at !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: at.top, left: at.left, width: MENU_W }}
            /* KHÔNG `overflow-hidden`: menu con của `RowMenuSub` bung ra NGOÀI
               hộp này, và cắt theo hộp là nó biến mất hoàn toàn. Góc bo không
               cần tới nó — mỗi mục tự bo `rounded-lg` của riêng mình. */
            className="z-50 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          >
            {children(() => setAt(null))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function RowMenuItem({
  onClick,
  icon,
  danger = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  icon: string;
  danger?: boolean;
  /**
   * Khoá mục lại thay vì GIẤU nó đi.
   *
   * Một mục biến mất để lại câu hỏi "menu này có làm được việc đó không?", và
   * người dùng đi tìm ở chỗ khác. Mục xám kèm `title` nói luôn vì sao chưa bấm
   * được và phải làm gì để bấm được.
   */
  disabled?: boolean;
  title?: string | undefined;
  children: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        <path d={icon} />
      </svg>
      {children}
    </button>
  );
}

/**
 * Một mục MỞ RA menu con — rê chuột vào là ba lựa chọn hiện ra bên cạnh.
 *
 * ─── Vì sao gộp lại thay vì bày ba mục ngang hàng ───────────────────────────
 *
 * Ba mục "Xuất ảnh PNG / Xuất tệp PDF / Xuất bảng tính Excel" đứng cạnh "Xoá
 * biểu đồ" làm menu đọc như bốn việc ngang nhau, trong khi thật ra chỉ có HAI:
 * xuất và xoá. Gộp lại thì mắt đọc được cấu trúc đó ngay, và chọn định dạng chỉ
 * tốn thêm một quãng rê chuột chứ không tốn thêm cú bấm nào.
 *
 * ─── Mở bằng cả rê chuột lẫn bấm ────────────────────────────────────────────
 *
 * Rê chuột là đường của chuột. Bấm (và Enter, vì đây là một `<button>`) là
 * đường của bàn phím và của màn hình cảm ứng, nơi không có "rê vào" — chỉ mở
 * bằng hover là khoá hẳn tính năng này với họ.
 *
 * Đóng theo `onMouseLeave` của CẢ cụm chứ không của riêng nút: giữa nút và menu
 * con có một khe, và đóng ngay khi chuột rời nút thì menu con biến mất đúng lúc
 * người dùng đang đi tới nó.
 */
export function RowMenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: ReactNode;
}): React.ReactElement {
  const [mo, setMo] = useState(false);
  const [ben, setBen] = useState<'trai' | 'phai'>('trai');
  /** Số px phải nhấc menu con lên để nó không thò xuống dưới đáy cửa sổ. */
  const [nhac, setNhac] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const conRef = useRef<HTMLDivElement>(null);

  const bat = (): void => {
    // Menu cha đã canh mép PHẢI của nút "⋮", nên nó thường nằm sát rìa phải và
    // menu con mở tiếp sang trái. Chỉ khi bên trái không còn chỗ mới lật.
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect !== undefined) setBen(rect.left >= MENU_W + LE_CUA_SO ? 'trai' : 'phai');
    setMo(true);
  };

  /*
   * Cùng câu chuyện với menu cha, chỉ khác là menu con neo theo CHIỀU NGANG nên
   * nó không lật lên trên được — nó trượt lên đúng bằng phần thò ra.
   *
   * Mục cuối của một menu cha đang nằm sát đáy sẽ đẩy menu con ba mục ("Xuất
   * ảnh PNG / PDF / Excel") xuống dưới mép cửa sổ. Phải trả `nhac` về 0 khi
   * đóng, nếu không lần mở sau đo trên một hộp đã bị dịch và cộng dồn.
   */
  useLayoutEffect(() => {
    if (!mo) {
      setNhac(0);
      return;
    }
    const el = conRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const tran = rect.bottom - (window.innerHeight - LE_CUA_SO);
    if (tran > 0) setNhac(-Math.min(tran, Math.max(0, rect.top - LE_CUA_SO)));
  }, [mo]);

  return (
    <div className="relative" onMouseEnter={bat} onMouseLeave={() => setMo(false)} role="none">
      <button
        ref={btnRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={mo}
        onClick={() => (mo ? setMo(false) : bat())}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>
        <span className="min-w-0 flex-1">{label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 text-slate-400"
          aria-hidden="true"
        >
          <path d={ben === 'trai' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
        </svg>
      </button>

      {mo && (
        <div
          ref={conRef}
          role="menu"
          aria-label={label}
          style={{ width: MENU_W, transform: nhac === 0 ? undefined : `translateY(${nhac}px)` }}
          className={`absolute top-0 z-10 rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
            ben === 'trai' ? 'right-full mr-1' : 'left-full ml-1'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Đường vẽ sẵn — để nơi gọi khỏi rải chuỗi `d` khắp nơi. */
export const ROW_MENU_ICONS = {
  key: 'M15 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l5.1-5.1A4 4 0 0 1 15 7Z',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  image:
    'M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16m-2-2 1.6-1.6a2 2 0 0 1 2.8 0L20 14M14 8h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z',
  pdf: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h6',
  sheet: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm0 4h16M10 10v10',
  export: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  folder: 'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z',
} as const;
