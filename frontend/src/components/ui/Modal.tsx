import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Hàng nút ở đáy. */
  footer?: ReactNode;
  /**
   * `md` (mặc định) cho form vài trường. `lg` cho nội dung dạng bảng — wizard ở
   * §7 phải hiện được bảng xem trước dữ liệu, và 32rem thì mỗi cột còn vài chục
   * pixel, không đọc được gì.
   */
  size?: 'md' | 'lg';
}

const SIZE_CLASS: Record<'md' | 'lg', string> = {
  md: 'w-[min(32rem,calc(100vw-2rem))]',
  lg: 'w-[min(64rem,calc(100vw-2rem))]',
};

/**
 * Hộp thoại, bọc quanh thẻ `<dialog>` gốc của trình duyệt.
 *
 * Dùng `showModal()` thay vì tự dựng portal + overlay, vì trình duyệt cho không
 * bốn thứ mà bản tự viết luôn làm sai ít nhất một:
 *
 *   - Bẫy tiêu điểm: Tab không thoát ra được nội dung phía sau.
 *   - Phím Escape đóng hộp thoại.
 *   - Phần còn lại của trang thành `inert` — trình đọc màn hình không đọc xuyên qua.
 *   - Lớp nền `::backdrop` nằm đúng tầng, không cần z-index.
 *
 * Việc còn lại chỉ là đồng bộ prop `open` với hai lệnh mệnh lệnh của DOM.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // `open === dialog.open` thì không làm gì: gọi `showModal()` trên hộp thoại
    // đang mở sẽ ném lỗi InvalidStateError.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Người dùng bấm Escape -> trình duyệt phát sự kiện `close` và tự đóng.
      // Không nghe sự kiện này thì state React vẫn tưởng hộp thoại đang mở, và
      // lần bấm mở tiếp theo sẽ không có tác dụng.
      onClose={onClose}
      onClick={(event) => {
        // Bấm ra ngoài để đóng. Sự kiện click trên `::backdrop` được tính là
        // click lên chính thẻ <dialog>, nên so sánh target là đủ để phân biệt
        // với click vào nội dung bên trong.
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="modal-title"
      className={[
        'm-auto rounded-2xl border border-slate-200 bg-white p-0',
        SIZE_CLASS[size],
        'shadow-xl backdrop:bg-slate-900/40',
      ].join(' ')}
    >
      <div className="px-6 pt-6">
        <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>

      <div className="px-6 py-5">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-4">
          {footer}
        </div>
      )}
    </dialog>
  );
}
