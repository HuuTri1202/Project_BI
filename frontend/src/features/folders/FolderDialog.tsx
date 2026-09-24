import { CHUNG, FOLDER_NAME_MAX, type FolderDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { getApiError } from '../../services/apiClient';

/**
 * Hộp thoại đặt tên thư mục — dùng cho cả TẠO MỚI lẫn ĐỔI TÊN, và cho cả hai
 * tab (§10.25 báo cáo, §7.9 kho dữ liệu).
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
  danhTu,
  open,
  folder,
  onClose,
  onSubmit,
  loading,
}: {
  /** Thứ được gom, số nhiều, viết thường: "báo cáo", "bộ dữ liệu". */
  danhTu: string;
  open: boolean;
  /** `null` = tạo mới; có giá trị = đổi tên chính thư mục đó. */
  folder: FolderDto | null;
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
          ? `${danhTu.charAt(0).toLocaleUpperCase('vi')}${danhTu.slice(1)} bên trong không đổi chỗ.`
          : `Thư mục để gom ${danhTu} theo chủ đề. Tạo xong, đưa ${danhTu} vào bằng mục “Chuyển tới thư mục” ở menu ⋮ của từng dòng.`
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
          // Ví dụ theo CHỦ ĐỀ, không theo loại: "Báo cáo tháng" đọc lạ trong tab
          // Kho dữ liệu, và một placeholder riêng cho mỗi tab là thêm một prop
          // chỉ để nói cùng một ý.
          placeholder="Bán hàng, Nhân sự, Kế toán…"
          error={error ?? undefined}
          hint={`Tối đa ${String(FOLDER_NAME_MAX)} ký tự. “${CHUNG}” đã là tên của chỗ chứa mặc định.`}
        />
      </form>
    </Modal>
  );
}
