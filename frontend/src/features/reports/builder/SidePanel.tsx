import { useState } from 'react';

import { PanelTitle } from './controls';

/**
 * Một cột bên của trình dựng, THU GỌN được — §10.15.
 *
 * ═══ Vì sao nó tồn tại ══════════════════════════════════════════════════════
 *
 *   "thêm các nút thu gọn mục chỉnh biểu đồ và mục mô hình dữ liệu để trang
 *    hiển thị biểu đồ báo cáo được rộng hơn, hiện tại đang hơi bé"
 *
 * Hai cột bên chiếm 288 + 256 = 544px cố định. Trên một màn 1366px thì khung
 * biểu đồ — thứ duy nhất người dùng đang thật sự nhìn — chỉ còn hơn một nửa
 * màn hình, và mười hai ô chia nhau chỗ đó. Nhưng cả hai cột đều CÓ LÚC cần:
 * bảng trường lúc kéo thả, bảng cấu hình lúc chỉnh. Nên câu trả lời không phải
 * là bỏ bớt một cột mà là cho người dùng gấp nó lại khi chưa cần.
 *
 * ═══ Ba chi tiết không được bỏ ══════════════════════════════════════════════
 *
 * 1. Thu gọn thành một THANH RAY còn thấy được, không phải biến mất. Một cột
 *    biến mất hẳn thì đường mở lại nó cũng biến mất theo, và người dùng còn
 *    không biết mình vừa đóng cái gì.
 * 2. Cả thanh ray LÀ cái nút. Một nút 20px nằm trong một thanh 32px là ba phần
 *    tư diện tích bấm vào không có tác dụng.
 * 3. Nhớ trong `localStorage`, theo từng cột. Ai đã gấp bảng trường lại thì
 *    lần sau mở trình dựng vẫn thấy nó gấp — sở thích cá nhân, không phải
 *    trạng thái điều hướng, nên nó không thuộc về URL.
 *
 * ⚠️ Chiều rộng đi vào bằng lớp Tailwind chứ không bằng số pixel: Tailwind quét
 * mã nguồn để sinh CSS, nên một `w-[${n}px]` dựng lúc chạy sẽ không có lớp nào
 * được sinh ra và cột rơi về rộng-theo-nội-dung.
 */
export function SidePanel({
  title,
  storageKey,
  width,
  children,
}: {
  /** Tên cột — hiện ở đầu cột, và xoay dọc trên thanh ray khi đã gấp. */
  title: string;
  /** Khoá `localStorage`, riêng cho từng cột. */
  storageKey: string;
  /** Lớp chiều rộng của Tailwind, ví dụ `'w-72'`. */
  width: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(() => !readClosed(storageKey));

  function toggle(): void {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(key(storageKey), next ? 'open' : 'closed');
    } catch {
      // Không nhớ được thì lần sau về mặc định (mở). Không đáng chặn thao tác.
    }
  }

  if (!open) {
    return (
      <aside className="flex w-8 shrink-0 flex-col border-l border-slate-200 pl-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          title={`Mở lại ${title}`}
          aria-label={`Mở lại ${title}`}
          className="flex h-full w-full flex-col items-center gap-2 rounded-lg py-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            «
          </span>
          {/* Xoay dọc: một cột 32px không đủ chỗ cho chữ nằm ngang, mà bỏ chữ
              đi thì hai thanh ray cạnh nhau trông y hệt nhau. */}
          <span
            aria-hidden="true"
            className="text-xs font-semibold tracking-wide whitespace-nowrap uppercase [writing-mode:vertical-rl]"
          >
            {title}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`flex ${width} shrink-0 flex-col overflow-hidden border-l border-slate-200 pl-4`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <PanelTitle>{title}</PanelTitle>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={true}
          title={`Thu gọn ${title}`}
          aria-label={`Thu gọn ${title}`}
          className="rounded px-1.5 py-0.5 text-sm leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <span aria-hidden="true">»</span>
        </button>
      </div>
      {/* Cuộn ở ĐÂY chứ không ở cả cột: hàng tiêu đề phải đứng yên, nếu không
          thì nút thu gọn trôi mất ngay khi bảng cấu hình dài hơn một màn.

          `flex-col` để phần thân cũng là một cột có CHIỀU CAO XÁC ĐỊNH: bảng
          trường ghim ô tìm kiếm ở trên rồi cho danh sách `min-h-0 flex-1` tự
          cuộn, và `flex-1` chỉ có nghĩa bên trong một cột flex. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2">{children}</div>
    </aside>
  );
}

const PREFIX = 'bi.builder.panel.';

function key(name: string): string {
  return PREFIX + name;
}

/**
 * Cột này có đang gấp không.
 *
 * Mặc định MỞ: người mở trình dựng lần đầu phải thấy đủ cả hai cột thì mới biết
 * chúng tồn tại. Chỉ `'closed'` mới đóng — mọi giá trị lạ, và cả lúc
 * `localStorage` ném lỗi (chế độ riêng tư của Safari), đều rơi về mở.
 */
function readClosed(name: string): boolean {
  try {
    return window.localStorage.getItem(key(name)) === 'closed';
  } catch {
    return false;
  }
}
