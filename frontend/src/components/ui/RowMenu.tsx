import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

    // Canh mép PHẢI của menu với mép phải của nút: cột thao tác nằm sát rìa
    // bảng, nên bung sang phải là ra ngoài khung nhìn. `Math.max(8, …)` giữ nó
    // khỏi tràn sang trái trên màn hình rất hẹp.
    setAt({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_W) });
  }

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
            className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
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
  children,
}: {
  onClick: () => void;
  icon: string;
  danger?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
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

/** Đường vẽ sẵn — để nơi gọi khỏi rải chuỗi `d` khắp nơi. */
export const ROW_MENU_ICONS = {
  key: 'M15 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l5.1-5.1A4 4 0 0 1 15 7Z',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
} as const;
