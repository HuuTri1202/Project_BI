import { CANVAS_MAX_PAGES, PAGE_NAME_MAX } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Thanh thẻ trang ở MÉP DƯỚI báo cáo — §10.12.
 *
 * ═══ Vì sao nó trông y hệt sheet của Excel ══════════════════════════════════
 *
 * Vì đó là điểm mạnh duy nhất của thiết kế này, và nó không phải thứ ta nghĩ
 * ra. Người dùng báo cáo đã biết cái thanh đó làm gì trước khi mở ứng dụng lần
 * đầu: thẻ ở dưới cùng, bấm để đổi trang, dấu + để thêm, bấm đúp để đổi tên.
 * Bịa ra một cách khác — một menu thả xuống, một cột bên trái — là bắt họ học
 * lại một thứ đã biết.
 *
 * ═══ MỘT component cho cả xem lẫn sửa ═══════════════════════════════════════
 *
 * \`edit\` vắng mặt = chỉ xem. Cùng lập luận với \`CanvasGrid\`: hai bản cài đặt
 * riêng cho cùng một thanh thẻ là hẹn trước ngày trang xem và trình dựng đánh
 * số trang khác nhau, và đó là loại lệch không có lỗi nào báo.
 *
 * ═══ Bàn phím phải đi hết được ══════════════════════════════════════════════
 *
 * \`tablist\` thật, mũi tên trái/phải đổi trang, F2 đổi tên. Một thanh chỉ bấm
 * được bằng chuột là một thanh mà người dùng bàn phím không sang được trang
 * hai — tức là mất một nửa báo cáo, không phải mất một phím tắt.
 */
export function PageTabs({
  pages,
  activeId,
  onSelect,
  edit,
}: {
  pages: readonly { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Vắng mặt = chỉ xem: đổi trang được, không thêm/xoá/đổi tên được. */
  edit?:
    | {
        onAdd: () => void;
        onRename: (id: string, name: string) => void;
        onRemove: (id: string) => void;
      }
    | undefined;
}): React.ReactElement {
  /** Trang đang được đổi tên — chỉ một, và luôn là trang đang mở. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming !== null) inputRef.current?.select();
  }, [renaming]);

  function beginRename(page: { id: string; name: string }): void {
    if (edit === undefined) return;
    setRenaming(page.id);
    setDraft(page.name);
  }

  /**
   * Kết thúc đổi tên.
   *
   * Tên rỗng GIỮ NGUYÊN tên cũ thay vì lưu một chuỗi trống. Một cái thẻ không
   * chữ ở mép dưới là một cái thẻ người dùng không biết mình đang bấm vào đâu,
   * và họ hay xoá trắng ô rồi bấm ra ngoài khi đổi ý.
   */
  function commitRename(): void {
    const id = renaming;
    setRenaming(null);
    if (id === null || edit === undefined) return;
    const name = draft.trim();
    if (name !== '') edit.onRename(id, name.slice(0, PAGE_NAME_MAX));
  }

  function onKey(event: React.KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const next = pages[(index + step + pages.length) % pages.length];
      if (next !== undefined) onSelect(next.id);
      return;
    }
    const page = pages[index];
    if (event.key === 'F2' && page !== undefined) {
      event.preventDefault();
      beginRename(page);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Trang của báo cáo"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-slate-200 bg-white px-1 pt-1.5"
    >
      {pages.map((page, index) => {
        const active = page.id === activeId;

        if (renaming === page.id) {
          return (
            <input
              key={page.id}
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={PAGE_NAME_MAX}
              aria-label={`Đổi tên trang ${page.name}`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                // Escape BỎ hẳn thay đổi. Nó là đường lui duy nhất của một cái ô
                // đang mở, và không có nó thì bấm nhầm F2 là buộc phải gõ lại
                // đúng tên cũ.
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="w-28 shrink-0 rounded-t-md border border-brand-500 px-2 py-1 text-xs outline-none"
            />
          );
        }

        return (
          <div key={page.id} className="group relative shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              // Chỉ thẻ ĐANG MỞ nằm trong thứ tự Tab; các thẻ khác đi tới bằng
              // mũi tên. Đó là hành vi chuẩn của một `tablist`, và nó giữ cho
              // một báo cáo mười trang không nuốt mười nhịp Tab.
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(page.id)}
              onDoubleClick={() => beginRename(page)}
              onKeyDown={(e) => onKey(e, index)}
              title={edit === undefined ? page.name : `${page.name} — bấm đúp để đổi tên`}
              className={`max-w-40 truncate rounded-t-md border border-b-0 px-3 py-1.5 text-xs ${
                active
                  ? 'border-slate-200 bg-white font-semibold text-slate-900'
                  : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              } ${edit !== undefined && pages.length > 1 ? 'pr-6' : ''}`}
            >
              {page.name}
            </button>

            {/* Xoá chỉ hiện ở thẻ ĐANG MỞ, và không bao giờ ở trang cuối cùng:
                một báo cáo không còn trang nào thì không còn gì để bấm vào. */}
            {edit !== undefined && pages.length > 1 && active && (
              <button
                type="button"
                onClick={() => edit.onRemove(page.id)}
                aria-label={`Xoá trang ${page.name}`}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}

      {edit !== undefined && (
        <button
          type="button"
          onClick={edit.onAdd}
          disabled={pages.length >= CANVAS_MAX_PAGES}
          aria-label="Thêm trang"
          title={
            pages.length >= CANVAS_MAX_PAGES
              ? `Một báo cáo tối đa ${CANVAS_MAX_PAGES} trang`
              : 'Thêm trang'
          }
          className="shrink-0 rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          +
        </button>
      )}
    </div>
  );
}
