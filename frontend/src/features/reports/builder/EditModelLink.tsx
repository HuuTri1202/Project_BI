import { Link } from 'react-router-dom';

/**
 * Nút sang trang mô hình, đặt ngay trong cột "Mô hình dữ liệu" — §10.19.
 *
 *   "ở phần mục mô hình dữ liệu này nên có nút bấm để đi đến datamodel để
 *    người dùng có thể chỉnh sửa"
 *
 * Trước bản này đường sang trang mô hình là một chữ "Mở mô hình" cỡ nhỏ trên
 * thanh công cụ của khung, lẫn giữa tên mô hình và bộ đếm biểu đồ — cách xa cả
 * một cột so với chỗ người dùng thật sự đang nhìn khi thấy một trường sai tên
 * hay sai vai trò. Đường đi đúng là đặt nó ngay trên bảng trường.
 *
 * ═══ Vì sao mở TAB MỚI ═════════════════════════════════════════════════════
 *
 * Bản cũ đi ngay trong tab, qua hộp thoại "Rời khỏi trình dựng?". Tức là muốn
 * đổi tên một trường giữa lúc dựng thì hoặc lưu một báo cáo còn dở, hoặc bỏ cả
 * khung. Tab mới giữ nguyên khung; lưu xong bên đó thì bảng trường ở đây tự làm
 * mới qua `modelChanges.ts`, không phải tải lại.
 *
 * `<Link target="_blank">` chứ không phải `window.open` trong một nút: một thẻ
 * `<a>` thật thì bấm chuột giữa, "Sao chép địa chỉ liên kết" và trình đọc màn
 * hình đều đúng như mọi liên kết khác.
 *
 * ⚠️ Tab mới KHÔNG bị đẩy về trang đăng nhập dù `sessionStorage` không được chép
 * sang: tab trình dựng vẫn đang giữ khoá "app còn mở" — xem `auth/appSession.ts`.
 */
export function EditModelLink({
  modelId,
  canEdit,
}: {
  modelId: number;
  /** Có quyền `datamodel:modify` — quyết định chữ trên nút, không chặn gì. */
  canEdit: boolean;
}): React.ReactElement {
  const label = canEdit ? 'Sửa mô hình' : 'Xem mô hình';

  return (
    <Link
      to={`/datamodels/${modelId}`}
      target="_blank"
      rel="noopener"
      title={
        canEdit
          ? 'Mở trang mô hình ở tab mới để sửa tên trường, vai trò cột, thước đo và quan hệ. Lưu xong, bảng trường ở đây tự cập nhật — khung đang dựng giữ nguyên.'
          : 'Mở trang mô hình ở tab mới. Khung đang dựng giữ nguyên.'
      }
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    >
      {label}
      {/* Mũi tên ra ngoài: nói trước rằng bấm vào là sang TAB KHÁC. Không có
          nó thì người dùng tưởng mình rời trình dựng, và hoảng khi thấy khung
          vẫn nằm ở tab cũ. */}
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" />
      </svg>
      <span className="sr-only">(mở ở tab mới)</span>
    </Link>
  );
}
