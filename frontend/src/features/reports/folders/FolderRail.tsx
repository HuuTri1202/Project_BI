import { CHUNG, CHUNG_HINT, type ReportFolderDto } from '@bi/shared';

import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../../components/ui/RowMenu';

/**
 * Cột thư mục bên trái tab Báo cáo — §10.25.
 *
 * ═══ Ba nhóm dòng, và chúng KHÔNG cùng loại với nhau ═══════════════════════
 *
 * "Tất cả báo cáo" là một BỘ LỌC TẮT, "Chung" là chỗ chứa mặc định, còn dưới
 * tiêu đề "THƯ MỤC" mới là thư mục thật. Người dùng bấm vào cả ba với cùng một
 * ý định, nên chúng cùng hình dạng — nhưng chỉ nhóm cuối có menu ⋮, vì đổi tên
 * hay xoá hai dòng trên là thao tác không tồn tại, và bày ra một cái menu chỉ
 * để mọi mục trong đó đều mờ thì tệ hơn không bày gì.
 *
 * ═══ Nút "+" nằm ở ĐÂY, không ở thanh trên cùng ════════════════════════════
 *
 * Nó đứng ngay cạnh tiêu đề "THƯ MỤC" — tức ngay cạnh thứ nó tạo ra, và ngay
 * chỗ mắt người dùng đang nhìn khi họ nghĩ tới việc gom báo cáo. Bản trước đặt
 * một nút "Thư mục mới" trên thanh tiêu đề trang, cách danh sách thư mục nửa
 * màn hình và nằm cạnh nút "Tạo báo cáo" — hai nút khác hẳn nhau về hậu quả,
 * đứng sát nhau, chữ na ná nhau.
 *
 * ⚠️ `null` và `undefined` ở `dang` là HAI trạng thái khác nhau, không phải một
 * cách viết cho "chưa chọn": `undefined` là Tất cả, `null` là Chung. Xem
 * `reportFolder.ts`. Gộp chúng lại là bấm vào Chung mà nhận nguyên danh sách.
 */
export function FolderRail({
  folders,
  chungCount,
  dang,
  onChon,
  canEdit,
  onThemMoi,
  onDoiTen,
  onXoa,
}: {
  folders: readonly ReportFolderDto[];
  /** Số báo cáo chưa xếp thư mục. */
  chungCount: number;
  /** `undefined` = Tất cả, `null` = Chung, số = mã thư mục. */
  dang: number | null | undefined;
  onChon: (folderId: number | null | undefined) => void;
  canEdit: boolean;
  onThemMoi: () => void;
  onDoiTen: (folder: ReportFolderDto) => void;
  onXoa: (folder: ReportFolderDto) => void;
}): React.ReactElement {
  const tong = chungCount + folders.reduce((sum, f) => sum + f.reportCount, 0);

  return (
    <nav
      aria-label="Thư mục báo cáo"
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto pr-3"
    >
      <Dong
        nhan="Tất cả báo cáo"
        icon={ICON.tapHo}
        so={tong}
        chon={dang === undefined}
        onClick={() => onChon(undefined)}
      />
      <Dong
        nhan={CHUNG}
        hint={CHUNG_HINT}
        icon={ICON.thuMuc}
        so={chungCount}
        chon={dang === null}
        onClick={() => onChon(null)}
      />

      {/* Tiêu đề nhóm + nút thêm. Luôn có mặt kể cả khi chưa có thư mục nào:
          đây là chỗ DUY NHẤT tạo được thư mục, nên ẩn nó đi lúc danh sách rỗng
          là khoá hẳn tính năng đúng vào lúc người dùng cần nó nhất. */}
      <div className="mt-4 flex items-center gap-2 px-2 pb-1">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Thư mục
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={onThemMoi}
            aria-label="Thêm thư mục"
            title="Thêm thư mục"
            className="hover:border-brand-300 -my-1 shrink-0 rounded-md border border-slate-200 p-1 text-slate-500 transition-colors hover:bg-brand-50 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d={ICON.themThuMuc} />
            </svg>
          </button>
        )}
      </div>

      {folders.length === 0 ? (
        /* Một cột trống không nói được gì về việc mình dùng để làm gì. Câu này
           thay cho khoảng trắng, và nó chỉ thẳng vào cái nút vừa đứng bên trên. */
        <p className="px-2 text-xs leading-relaxed text-slate-400">
          {canEdit
            ? 'Chưa có thư mục nào. Bấm + để gom báo cáo theo chủ đề.'
            : 'Chưa có thư mục nào.'}
        </p>
      ) : (
        folders.map((folder) => (
          <Dong
            key={folder.id}
            nhan={folder.name}
            icon={ICON.thuMuc}
            so={folder.reportCount}
            chon={dang === folder.id}
            onClick={() => onChon(folder.id)}
            menu={
              canEdit ? (
                <RowMenu label={`Thao tác trên thư mục ${folder.name}`}>
                  {(close) => (
                    <>
                      <RowMenuItem
                        icon={ROW_MENU_ICONS.edit}
                        onClick={() => {
                          close();
                          onDoiTen(folder);
                        }}
                      >
                        Đổi tên
                      </RowMenuItem>
                      <RowMenuItem
                        icon={ROW_MENU_ICONS.trash}
                        danger
                        onClick={() => {
                          close();
                          onXoa(folder);
                        }}
                      >
                        Xoá thư mục
                      </RowMenuItem>
                    </>
                  )}
                </RowMenu>
              ) : undefined
            }
          />
        ))
      )}
    </nav>
  );
}

const ICON = {
  /** Chồng tài liệu — "mọi báo cáo", không phải một thư mục cụ thể nào. */
  tapHo: 'M4 7.5 12 4l8 3.5-8 3.5-8-3.5Zm0 4.5 8 3.5 8-3.5M4 16.5 12 20l8-3.5',
  thuMuc: 'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z',
  themThuMuc:
    'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm8 4v6m-3-3h6',
} as const;

function Dong({
  nhan,
  hint,
  icon,
  so,
  chon,
  onClick,
  menu,
}: {
  nhan: string;
  hint?: string;
  icon: string;
  so: number;
  chon: boolean;
  onClick: () => void;
  menu?: React.ReactNode;
}): React.ReactElement {
  return (
    /* Menu ⋮ nằm NGOÀI thẻ <button>, không lồng vào trong: một nút bên trong
       một nút là HTML không hợp lệ, và trình duyệt gỡ rối nó theo cách riêng của
       mình — thường là đá cái nút con ra khỏi cây, nên menu biến mất. */
    <div
      className={`group flex items-center gap-0.5 rounded-lg pr-1 transition-colors ${
        chon ? 'bg-brand-50' : 'hover:bg-slate-50'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={chon ? 'true' : undefined}
        title={hint ?? nhan}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          chon ? 'font-semibold text-brand-700' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 ${chon ? 'text-brand-600' : 'text-slate-400'}`}
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>

        <span className="min-w-0 flex-1 truncate">{nhan}</span>

        {/* Con số KHÔNG vào trong tên đọc được: trình đọc màn hình sẽ đọc liền
            "Bán hàng 3", nghe như một thư mục tên "Bán hàng 3". `aria-label`
            tách nó ra thành "3 báo cáo". */}
        <span
          aria-label={`${String(so)} báo cáo`}
          className={`shrink-0 rounded-full px-1.5 text-xs tabular-nums ${
            chon ? 'bg-brand-100 text-brand-700' : 'text-slate-400'
          }`}
        >
          {so}
        </span>
      </button>

      {menu !== undefined && (
        /* Hiện khi rê chuột, khi đang mở, HOẶC khi chính nó đang giữ tiêu điểm.
           `focus-within` là vế giữ cho người dùng bàn phím Tab tới được nó —
           thiếu nó thì cái menu nhận tiêu điểm trong khi vẫn trong suốt. */
        <span
          className={`shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${
            chon ? 'opacity-100' : ''
          }`}
        >
          {menu}
        </span>
      )}
    </div>
  );
}
