import { CHUNG, FOLDER_NAME_MAX, type ReportFolderDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';

/**
 * Hộp thoại đặt tên thư mục — dùng cho cả TẠO MỚI lẫn ĐỔI TÊN — §10.25.
 *
 * Một component cho hai việc vì chúng khác nhau đúng ở chữ trên nút và giá trị
 * ban đầu của ô nhập. Tách đôi nghĩa là hai bản chép tay của cùng một luật đặt
 * tên, và chúng sẽ lệch nhau ở lần sửa đầu tiên.
 *
 * Câu lỗi lấy từ SERVER, không đoán trước ở client. Hai luật duy nhất có thể
 * làm hỏng lần lưu — trùng tên và trùng với chữ "Chung" — đều chỉ server mới
 * biết chắc: một người khác có thể vừa tạo đúng cái tên đó một giây trước.
 */
export function FolderDialog({
  open,
  folder,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  /** `null` = tạo mới; có giá trị = đổi tên chính thư mục đó. */
  folder: ReportFolderDto | null;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  loading: boolean;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  /*
   * Nạp lại mỗi lần MỞ, không phải mỗi lần `folder` đổi.
   *
   * Hộp thoại không bị gỡ khỏi cây khi đóng (thẻ `<dialog>` chỉ ẩn đi), nên
   * thiếu bước này thì lần mở sau còn nguyên chữ và câu lỗi của lần trước —
   * người dùng bấm "Thư mục mới" và thấy sẵn tên của thư mục vừa đổi tên xong.
   */
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setError(null);
  }, [open, folder]);

  const doiTen = folder !== null;
  const sach = name.trim();

  async function luu(): Promise<void> {
    if (sach === '') return;
    setError(null);
    try {
      await onSubmit(sach);
      onClose();
    } catch (e) {
      setError(getApiError(e).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doiTen ? 'Đổi tên thư mục' : 'Thư mục mới'}
      description={
        doiTen
          ? 'Báo cáo bên trong không đổi chỗ.'
          : 'Thư mục để gom báo cáo theo chủ đề. Tạo xong, đưa báo cáo vào bằng mục “Chuyển tới thư mục” ở menu ⋮ của từng dòng.'
      }
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={sach === ''}
            onClick={() => void luu()}
          >
            {doiTen ? 'Lưu tên' : 'Tạo thư mục'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          // Enter trong ô nhập là đường nhanh nhất, và người đặt tên một thư mục
          // gần như luôn dùng nó thay vì rời tay khỏi bàn phím để bấm nút.
          e.preventDefault();
          void luu();
        }}
      >
        <Field
          label="Tên thư mục"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bán hàng, Nhân sự, Báo cáo tháng…"
          error={error ?? undefined}
          hint={`Tối đa ${String(FOLDER_NAME_MAX)} ký tự. “${CHUNG}” đã là tên của chỗ chứa mặc định.`}
        />
      </form>
    </Modal>
  );
}
