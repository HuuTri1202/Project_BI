import { CHUNG, chungHint, type FolderDto } from '@bi/shared';

import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../components/ui/RowMenu';

/**
 * Cột thư mục bên trái — MỘT bản dựng cho cả tab Báo cáo (§10.25) và tab Kho
 * dữ liệu (§7.9).
 *
 * ═══ Vì sao một bản dùng chung ═════════════════════════════════════════════
 *
 * Hai tab xếp hai thứ khác nhau, nhưng cái cột thì làm đúng một việc: bày các
 * chỗ chứa, đánh dấu chỗ đang mở, và cho tạo/sửa/xoá. Chép đôi nó nghĩa là mỗi
 * lần sửa cách hiển thị — ghim Chung ở đầu, ẩn menu ⋮ của Chung, chỗ đặt nút +
 * — phải làm hai lần cho khớp, và lần thứ hai sẽ bị quên.
 *
 * Cái duy nhất khác nhau là DANH TỪ, nên nó là một prop.
 *
 * ═══ MỘT danh sách, và "Chung" luôn đứng đầu ═══════════════════════════════
 *
 * Mọi báo cáo đều nằm trong đúng một chỗ: Chung, hoặc một thư mục. Nên cột này
 * là một danh sách phẳng chứ không phải hai khu, và không có dòng "tất cả" —
 * cộng mọi dòng lại đã là tất cả.
 *
 * Chung được GHIM ở đầu, không xếp theo bảng chữ cái cùng các thư mục khác: nó
 * là chỗ báo cáo mới rơi vào khi người dùng chưa xếp gì, tức chỗ hay phải mở
 * nhất, và một chỗ hay mở mà mỗi lần lại nằm một vị trí khác (hôm nay thứ hai,
 * mai thứ năm, tuỳ tên thư mục mới) thì phải đọc lại danh sách mỗi lần.
 *
 * Nó cũng là dòng DUY NHẤT không có menu ⋮ — đổi tên hay xoá Chung là thao tác
 * không tồn tại (xem `reportFolder.ts`), và bày ra một cái menu chỉ để mọi mục
 * trong đó đều mờ thì tệ hơn không bày gì.
 *
 * ═══ Nút "+" nằm ở ĐÂY, không ở thanh trên cùng ════════════════════════════
 *
 * Nó đứng ngay cạnh tiêu đề "THƯ MỤC" — tức ngay cạnh thứ nó tạo ra, và ngay
 * chỗ mắt người dùng đang nhìn khi họ nghĩ tới việc gom báo cáo. Bản trước đặt
 * một nút "Thư mục mới" trên thanh tiêu đề trang, cách danh sách thư mục nửa
 * màn hình và nằm cạnh nút "Tạo báo cáo" — hai nút khác hẳn nhau về hậu quả,
 * đứng sát nhau, chữ na ná nhau.
 *
 * ⚠️ `dang === null` là CHUNG, không phải "chưa chọn gì". Cột này luôn có đúng
 * một dòng đang mở — trang gọi nó đã quy mọi giá trị lạ về Chung.
 */
export function FolderRail({
  danhTu,
  folders,
  chungCount,
  dang,
  onChon,
  canEdit,
  onThemMoi,
  onDoiTen,
  onXoa,
}: {
  /**
   * Thứ đang được xếp, số nhiều, viết thường: "báo cáo", "bộ dữ liệu".
   *
   * Nó đi vào nhãn vùng cho trình đọc màn hình, câu gợi ý dưới chữ Chung, và
   * `aria-label` của con số. Không có nó thì cột đọc lên là "3" — một con số
   * trần không nói được nó đếm cái gì.
   */
  danhTu: string;
  folders: readonly FolderDto[];
  /** Số mục chưa xếp thư mục. */
  chungCount: number;
  /** `null` = Chung, số = mã thư mục. Luôn có đúng một dòng đang mở. */
  dang: number | null;
  onChon: (folderId: number | null) => void;
  canEdit: boolean;
  onThemMoi: () => void;
  onDoiTen: (folder: FolderDto) => void;
  onXoa: (folder: FolderDto) => void;
}): React.ReactElement {
  return (
    <nav
      aria-label={`Thư mục ${danhTu}`}
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto pr-3"
    >
      {/* Tiêu đề nhóm + nút thêm. Luôn có mặt kể cả khi chưa có thư mục nào:
          đây là chỗ DUY NHẤT tạo được thư mục, nên ẩn nó đi lúc danh sách rỗng
          là khoá hẳn tính năng đúng vào lúc người dùng cần nó nhất. */}
      <div className="flex items-center gap-2 px-2 pb-1">
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

      {/* Chung: GHIM ở đầu, trước mọi thư mục người dùng tạo — xem ghi chú đầu
          file. Không có menu ⋮ vì không có gì để đổi tên hay xoá. */}
      <Dong
        danhTu={danhTu}
        nhan={CHUNG}
        hint={chungHint(danhTu)}
        icon={ICON.thuMuc}
        so={chungCount}
        chon={dang === null}
        onClick={() => onChon(null)}
      />

      {folders.length === 0
        ? /* Câu này thay cho khoảng trắng, và nó chỉ thẳng vào cái nút bên trên.
             Một cột chỉ có mỗi dòng Chung không nói được gì về việc nó dùng để
             làm gì. */
          canEdit && (
            <p className="mt-2 px-2 text-xs leading-relaxed text-slate-400">
              Bấm + ở trên để tạo thư mục và gom {danhTu} theo chủ đề.
            </p>
          )
        : folders.map((folder) => (
            <Dong
              key={folder.id}
              danhTu={danhTu}
              nhan={folder.name}
              icon={ICON.thuMuc}
              so={folder.itemCount}
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
          ))}
    </nav>
  );
}

const ICON = {
  thuMuc: 'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z',
  themThuMuc:
    'M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm8 4v6m-3-3h6',
} as const;

function Dong({
  danhTu,
  nhan,
  hint,
  icon,
  so,
  chon,
  onClick,
  menu,
}: {
  danhTu: string;
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
          aria-label={`${String(so)} ${danhTu}`}
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
