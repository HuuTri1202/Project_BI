import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { useConnectionsBase } from '../../features/tenant/connections/basePath';
import { ConnectionWizard } from '../../features/tenant/connections/ConnectionWizard';
import { useConnections } from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

/*
 * Đường quay về sau khi lưu / bấm Huỷ KHÔNG cứng được nữa: admin về
 * `/organization/connections`, creator về `/connections`. Cứng một chuỗi ở đây
 * là ném một trong hai vai trò sang URL mà chính họ bị chặn — tức là một vòng
 * 403 ngay sau khi lưu thành công. Xem `useConnectionsBase`.
 */

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
  const { base } = useConnectionsBase();
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;

  const { data, isPending, isError, error } = useConnections();

  const back = (): void => {
    void navigate(base);
  };

  const editing = isEdit ? (data?.find((c) => String(c.id) === id) ?? null) : null;
  // Danh sách đã về mà không có id này: kết nối vừa bị người khác xoá, hoặc id
  // trong URL là bịa. Cả hai đều không nên hiện một form trống trông như đang tạo
  // mới — lưu nó lại sẽ tạo ra một kết nối thứ hai chứ không sửa cái nào.
  const missing = isEdit && data !== undefined && editing === null;

  return (
    <Page width="4xl">
      <PageHeader
        title={isEdit ? 'Sửa kết nối' : 'Thêm kết nối'}
        description="Khai một cơ sở dữ liệu để lấy dữ liệu về kho."
        actions={<Button onClick={back}>Huỷ</Button>}
      />

      <PageBody>
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
      </PageBody>
    </Page>
  );
}
