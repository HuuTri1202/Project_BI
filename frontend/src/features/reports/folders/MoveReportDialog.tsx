import { CHUNG, type ReportDto, type ReportFolderDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';

/**
 * "Chuyển tới thư mục" — §10.25.
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
export function MoveReportDialog({
  report,
  folders,
  onClose,
  onMove,
  loading,
}: {
  /** `null` = đóng. Mang cả báo cáo để hộp thoại tự biết nó đang ở thư mục nào. */
  report: ReportDto | null;
  folders: readonly ReportFolderDto[];
  onClose: () => void;
  onMove: (folderId: number | null) => Promise<unknown>;
  loading: boolean;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [dangChuyen, setDangChuyen] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (report !== null) setError(null);
  }, [report]);

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

  const dangO = report?.folderId ?? null;

  return (
    <Modal
      open={report !== null}
      onClose={onClose}
      title="Chuyển tới thư mục"
      description={
        report === null ? undefined : `“${report.name}” đang ở ${report.folderName ?? CHUNG}.`
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
              so={folder.reportCount}
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
