import { CHUNG, CHUNG_HINT, type ReportFolderDto } from '@bi/shared';

import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../../components/ui/RowMenu';

/**
 * Cột thư mục bên trái tab Báo cáo — §10.25.
 *
 * ═══ Ba dòng đầu KHÔNG cùng loại với nhau ══════════════════════════════════
 *
 * "Tất cả" là một BỘ LỌC TẮT, "Chung" là chỗ chứa mặc định, còn từ dòng thứ ba
 * trở xuống mới là thư mục thật. Chúng trông giống nhau vì người dùng bấm vào
 * cả ba với cùng một ý định, nhưng chỉ nhóm cuối có menu ⋮ — đổi tên hay xoá
 * hai dòng trên là thao tác không tồn tại, và bày ra một cái menu chỉ để mọi
 * mục trong đó đều mờ là tệ hơn không bày gì.
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
  onDoiTen: (folder: ReportFolderDto) => void;
  onXoa: (folder: ReportFolderDto) => void;
}): React.ReactElement {
  const tong = chungCount + folders.reduce((sum, f) => sum + f.reportCount, 0);

  return (
    <nav aria-label="Thư mục báo cáo" className="flex w-56 shrink-0 flex-col gap-0.5 pr-3">
      <Dong nhan="Tất cả" so={tong} chon={dang === undefined} onClick={() => onChon(undefined)} />
      <Dong
        nhan={CHUNG}
        hint={CHUNG_HINT}
        so={chungCount}
        chon={dang === null}
        onClick={() => onChon(null)}
      />

      {folders.length > 0 && (
        <p className="mt-3 px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Thư mục
        </p>
      )}

      {folders.map((folder) => (
        <Dong
          key={folder.id}
          nhan={folder.name}
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
      ))}
    </nav>
  );
}

function Dong({
  nhan,
  hint,
  so,
  chon,
  onClick,
  menu,
}: {
  nhan: string;
  hint?: string;
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
      className={`group flex items-center gap-1 rounded-lg pr-1 ${
        chon ? 'bg-brand-50' : 'hover:bg-slate-50'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={chon ? 'true' : undefined}
        title={hint}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
          chon ? 'font-semibold text-brand-700' : 'text-slate-600'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{nhan}</span>
        {/* Con số là thông tin phụ, nên nó KHÔNG vào trong tên: trình đọc màn
            hình đọc "Bán hàng 3" nghe như một thư mục tên "Bán hàng 3". */}
        <span
          aria-label={`${String(so)} báo cáo`}
          className={`shrink-0 text-xs tabular-nums ${chon ? 'text-brand-600' : 'text-slate-400'}`}
        >
          {so}
        </span>
      </button>
      {menu !== undefined && (
        /* Hiện khi rê chuột, khi đang chọn, HOẶC khi chính nó đang được focus —
           `focus-within` là thứ giữ cho người dùng bàn phím Tab tới được nó.
           Thiếu vế đó thì cái menu nhận tiêu điểm trong khi vẫn trong suốt. */
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
