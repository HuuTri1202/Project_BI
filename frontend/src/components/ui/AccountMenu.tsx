import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { ROLE_LABELS } from '../../types/auth';

/**
 * Khối tài khoản ở chân sidebar — bấm vào mở một menu nhỏ.
 *
 * ─── Vì sao gom vào menu thay vì để hai dòng riêng ──────────────────────────
 *
 * "Hồ sơ cá nhân" và "Đăng xuất" chiếm hai dòng thường trực trong sidebar để
 * phục vụ hai thao tác người ta làm vài lần một tháng, trong khi các mục điều
 * hướng thật thì dùng hàng ngày. Gom lại sau tên tài khoản trả chỗ đó về cho
 * điều hướng, và đặt chúng đúng nơi ai cũng đi tìm: bấm vào tên mình.
 *
 * Menu bật LÊN (`bottom-full`) vì khối này nằm sát đáy màn hình — bung xuống thì
 * nó rơi ra ngoài khung nhìn, và khung nhìn ở đây không cuộn được.
 */
export function AccountMenu({
  /** Gọi khi người dùng chọn một mục — để lớp phủ trên màn hẹp tự đóng. */
  onNavigate,
}: {
  onNavigate?: () => void;
}): React.ReactElement {
  const { user, tenant, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài hoặc Esc thì đóng. Thiếu một trong hai là menu dính lại trên
  // màn hình cho tới khi người dùng bấm đúng vào nút đã mở nó.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };

    // `pointerdown` chứ không `click`: bắt sớm hơn một nhịp, nên menu đóng ngay
    // khi bấm chứ không đợi nhả chuột.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(): void {
    setOpen(false);
    onNavigate?.();
  }

  return (
    <div ref={boxRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Tài khoản"
          className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-xl shadow-black/40"
        >
          {/* Email nằm trong menu chứ không ở hàng luôn hiện: nó dài, hay bị cắt
              cụt, và chỉ cần khi người dùng muốn xác nhận mình là ai. */}
          <div className="border-b border-slate-700 px-3.5 py-2.5">
            <p className="truncate text-sm font-semibold text-white">{user?.fullName ?? '—'}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>

          <div className="p-1.5">
            <Link
              to="/profile"
              role="menuitem"
              onClick={choose}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <MenuIcon path="M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              Hồ sơ cá nhân
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                choose();
                void logout();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <MenuIcon path="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              Đăng xuất
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
          open ? 'bg-slate-800' : 'hover:bg-slate-800'
        }`}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white"
        >
          {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
        </span>

        {/* `min-w-0` để `truncate` bên trong có tác dụng: một flex item mặc định
            không chịu hẹp hơn nội dung, nên thiếu nó thì tên dài đẩy rộng cả khối
            thay vì bị cắt bằng dấu ba chấm. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {user?.fullName ?? '—'}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {tenant?.name} · {role ? ROLE_LABELS[role] : ''}
          </span>
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

function MenuIcon({ path }: { path: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4.5 w-4.5 shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
