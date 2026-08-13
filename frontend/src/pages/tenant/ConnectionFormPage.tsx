import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { ConnectionWizard } from '../../features/tenant/connections/ConnectionWizard';
import { useConnections } from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

const LIST_PATH = '/organization/connections';

/**
 * Trang thêm / sửa kết nối CSDL — §8.2.
 *
 * ─── Vì sao NGOÀI khung `OrganizationPage` ──────────────────────────────────
 *
 * Route này là anh em của `/organization`, không phải con. Đặt nó vào trong sẽ
 * kéo theo tiêu đề "Quản lý tổ chức" và cả thanh bốn tab nằm ngay trên một wizard
 * ba bước — hai bộ điều hướng chồng nhau, và các tab kia thì dẫn người dùng rời
 * khỏi form đang gõ dở mà không báo gì.
 *
 * Đây là một luồng có điểm bắt đầu và điểm kết thúc, nên nó chiếm trọn khu nội
 * dung và chỉ chừa đúng một lối ra: nút Huỷ.
 *
 * ─── Vì sao lấy kết nối từ danh sách, không gọi `GET /connections/:id` ──────
 *
 * `useConnections` đã nằm sẵn trong cache khi người dùng bấm Sửa từ bảng, nên
 * form hiện ra ngay không chớp. Mở thẳng bằng URL thì query tự chạy — đúng một
 * request cho cả danh sách, thay vì thêm một endpoint chỉ để lấy một dòng mà ta
 * gần như luôn đã có.
 */
export default function ConnectionFormPage(): React.ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;

  const { data, isPending, isError, error } = useConnections();

  const back = (): void => {
    void navigate(LIST_PATH);
  };

  const editing = isEdit ? (data?.find((c) => String(c.id) === id) ?? null) : null;
  // Danh sách đã về mà không có id này: kết nối vừa bị người khác xoá, hoặc id
  // trong URL là bịa. Cả hai đều không nên hiện một form trống trông như đang tạo
  // mới — lưu nó lại sẽ tạo ra một kết nối thứ hai chứ không sửa cái nào.
  const missing = isEdit && data !== undefined && editing === null;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {isEdit ? 'Sửa kết nối' : 'Thêm kết nối'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Kết nối một cơ sở dữ liệu riêng vào tổ chức của bạn.
          </p>
        </div>
        <Button onClick={back}>Huỷ</Button>
      </header>

      <div className="mt-6">
        {isError && <ErrorState message={getApiError(error).message} />}

        {missing && (
          <ErrorState message="Không tìm thấy kết nối này. Có thể nó vừa bị xoá." />
        )}

        {/* Chỉ chờ khi SỬA. Tạo mới không cần danh sách, nên bắt người dùng nhìn
            khung xám trong lúc một request không liên quan chạy xong là vô cớ. */}
        {isEdit && isPending && <TableSkeleton rows={4} />}

        {!isError && !missing && (!isEdit || editing !== null) && (
          <ConnectionWizard editing={editing} onDone={back} />
        )}
      </div>
    </div>
  );
}
