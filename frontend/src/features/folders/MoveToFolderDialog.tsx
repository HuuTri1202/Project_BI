import { CHUNG, type FolderDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { getApiError } from '../../services/apiClient';

/**
 * "Chuyển tới thư mục" — MỘT hộp thoại cho cả báo cáo (§10.25) lẫn bộ dữ liệu
 * (§7.9).
 *
 * Nó không biết mình đang chuyển cái gì, và không cần biết: `muc` mang đủ ba
 * thứ nó dùng — tên để in ra, và cặp `folderId`/`folderName` để đánh dấu chỗ
 * đang đứng. Nhận nguyên một `ReportDto` hay `DatasetDto` thì hộp thoại phải
 * biết cả hai kiểu, và mỗi kiểu mới lại phải sửa nó một lần.
 *
 * Một danh sách nút chọn chứ không phải một ô `<select>`: số thư mục là con số
 * người dùng tự tạo ra và thường dưới mười, nên bày hết ra cho họ thấy ngay
 * mình đang chuyển ĐI ĐÂU rẻ hơn bắt họ bung một danh sách thả xuống. Với danh
 * sách dài thì khung tự cuộn.
 *
 * Thư mục ĐANG chứa báo cáo vẫn hiện ra, chỉ bị đánh dấu và không bấm được:
 * bỏ nó đi làm danh sách đổi thứ tự tuỳ theo báo cáo đang chọn, và người dùng
 * mất luôn câu trả lời cho "nó đang nằm ở đâu?".
 */
export interface MucDangChuyen {
  /** Tên in trong câu mô tả — một cái tên thật, hoặc "4 bộ dữ liệu" cho cả nhóm. */
  name: string;
  /**
   * Chỗ đang đứng. `CHUA_BIET` khi đang chuyển CẢ MỘT NHÓM — xem dưới.
   */
  folderId: number | null | typeof CHUA_BIET;
  folderName: string | null;
}

/**
 * Chỗ đang đứng KHÔNG BIẾT — không mục nào bị đánh dấu, không mục nào bị khoá.
 *
 * Ở Kho dữ liệu, lựa chọn sống qua việc đổi thư mục và đổi trang, nên một nhóm
 * đã tích hoàn toàn có thể đang nằm rải ở nhiều chỗ. Lúc đó "đang ở đâu" không
 * có một câu trả lời, và đoán bừa lấy thư mục đang mở là in ra một điều sai.
 *
 * Không khoá mục nào cũng là chủ ý: dồn cả nhóm về đúng cái thư mục mà một nửa
 * trong số chúng đã nằm sẵn vẫn là việc người dùng muốn làm, và khoá nó lại là
 * chặn đúng thao tác đó, để lại một nửa nhóm ở chỗ cũ.
 */
export const CHUA_BIET = 'chua-biet';

export function MoveToFolderDialog({
  muc,
  folders,
  onClose,
  onMove,
  loading,
}: {
  /** `null` = đóng. Mang sẵn chỗ đang đứng để hộp thoại tự đánh dấu. */
  muc: MucDangChuyen | null;
  folders: readonly FolderDto[];
  onClose: () => void;
  onMove: (folderId: number | null) => Promise<unknown>;
  loading: boolean;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [dangChuyen, setDangChuyen] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (muc !== null) setError(null);
  }, [muc]);

  async function chuyen(folderId: number | null): Promise<void> {
    setError(null);
    setDangChuyen(folderId);
    try {
      await onMove(folderId);
      onClose();
    } catch (e) {
      setError(getApiError(e).message);
    }
  }

  /*
   * `CHUA_BIET` không phải nullish, nên nó đi qua `??` nguyên vẹn và không bằng
   * `null` cũng không bằng mã nào — tức là không mục nào bị đánh dấu, đúng
   * điều ta muốn cho cả nhóm.
   */
  const dangO = muc?.folderId ?? null;

  return (
    <Modal
      open={muc !== null}
      onClose={onClose}
      title="Chuyển tới thư mục"
      description={
        muc === null
          ? undefined
          : muc.folderId === CHUA_BIET
            ? `Đang chuyển ${muc.name}.`
            : `“${muc.name}” đang ở ${muc.folderName ?? CHUNG}.`
      }
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      <div className="space-y-2">
        {error !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          <Muc
            nhan={CHUNG}
            dangO={dangO === null}
            loading={loading && dangChuyen === null}
            onClick={() => void chuyen(null)}
          />
          {folders.map((folder) => (
            <Muc
              key={folder.id}
              nhan={folder.name}
              so={folder.itemCount}
              dangO={dangO === folder.id}
              loading={loading && dangChuyen === folder.id}
              onClick={() => void chuyen(folder.id)}
            />
          ))}
        </div>

        {folders.length === 0 && (
          <p className="pt-1 text-sm text-slate-500">
            Chưa có thư mục nào. Đóng hộp này rồi bấm dấu + ở mục “Thư mục” bên trái để tạo cái đầu
            tiên.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Muc({
  nhan,
  so,
  dangO,
  loading,
  onClick,
}: {
  nhan: string;
  so?: number;
  dangO: boolean;
  loading: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={dangO || loading}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
        dangO
          ? 'cursor-default border-brand-200 bg-brand-50 text-brand-700'
          : 'hover:border-brand-300 border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60'
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{nhan}</span>
      {dangO ? (
        <span className="shrink-0 text-xs">Đang ở đây</span>
      ) : (
        so !== undefined && (
          <span className="shrink-0 text-xs text-slate-400 tabular-nums">{so}</span>
        )
      )}
    </button>
  );
}
