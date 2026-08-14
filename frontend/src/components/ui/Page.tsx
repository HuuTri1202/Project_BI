import type { ReactNode } from 'react';

/**
 * Khung trang — mỗi trang cao đúng bằng vùng nội dung, KHÔNG đẩy dài cửa sổ.
 *
 * ─── Vì sao cần một khung riêng thay vì để trang tự do ──────────────────────
 *
 * Trước đây mọi trang là một `div` bình thường, nên trang cao bao nhiêu thì cửa
 * sổ cuộn bấy nhiêu. Hệ quả: bảng 100 dòng đẩy tiêu đề trang, thanh tab và cả
 * hàng tiêu đề bảng ra khỏi màn hình — cuộn tới dòng thứ 60 thì không còn biết
 * cột nào là cột nào, và phải cuộn ngược lên mới bấm được nút.
 *
 * Ở đây khung ngoài đứng yên: tiêu đề và thanh công cụ luôn thấy, còn phần dài
 * (bảng, danh sách) cuộn TRONG hộp của chính nó. Đó là cách mọi công cụ xem dữ
 * liệu làm, và nó chỉ hoạt động nếu chuỗi `h-full` không đứt ở khâu nào — nên
 * lớp vỏ (`UserLayout`, `AdminLayout`) phải `overflow-hidden` và trang phải bắt
 * đầu bằng đúng component này.
 */

/** Bề ngang tối đa. Tailwind không nội suy được tên lớp nên phải tra bảng. */
const MAX_WIDTH = {
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: 'max-w-none',
} as const;

export function Page({
  children,
  width = '6xl',
}: {
  children: ReactNode;
  width?: keyof typeof MAX_WIDTH;
}): React.ReactElement {
  return (
    <div className={`mx-auto flex h-full w-full flex-col ${MAX_WIDTH[width]}`}>{children}</div>
  );
}

/**
 * Phần đầu trang — luôn hiện, không bao giờ cuộn đi mất.
 *
 * `description` cố ý ngắn: một câu nói trang này để làm gì. Mọi giải thích về
 * cách hệ thống hoạt động bên trong thuộc về README, không thuộc về màn hình
 * người dùng đang cần làm việc.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Thanh tab, breadcrumb… — nằm dưới tiêu đề, vẫn thuộc phần đứng yên. */
  children?: ReactNode;
}): React.ReactElement {
  return (
    <header className="shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-900">{title}</h1>
          {description !== undefined && (
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/**
 * Phần thân — nhận hết chỗ còn lại và tự cuộn khi cần.
 *
 * `min-h-0` là mấu chốt và cũng là chỗ hay quên: mặc định một flex item có
 * `min-height: auto`, nghĩa là nó KHÔNG chịu co nhỏ hơn nội dung. Thiếu class
 * này thì `flex-1` vô tác dụng, hộp phình ra bằng nội dung và cửa sổ cuộn lại
 * như cũ.
 *
 * `scroll={false}` khi bên trong đã có vùng cuộn riêng (bảng dữ liệu) — hai
 * thanh cuộn lồng nhau là cách chắc chắn làm người dùng bấm nhầm.
 */
export function PageBody({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}): React.ReactElement {
  return (
    <div className={`mt-4 min-h-0 flex-1 ${scroll ? 'overflow-y-auto pr-1' : 'flex flex-col'}`}>
      {children}
    </div>
  );
}
