import { CONNECTION_KIND_LABELS, type ConnectionDto } from '@bi/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import {
  useConnections,
  useDeleteConnection,
  useTestSavedConnection,
} from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

/**
 * Tab "Kết nối" của trang Quản lý tổ chức — §8.
 *
 * Chỉ Admin tổ chức vào được: bảng này chứa thông tin đăng nhập vào CSDL của
 * khách hàng, thứ nhạy cảm nhất trong toàn hệ thống. Mật khẩu không bao giờ đi
 * ra khỏi backend, kể cả dạng đã che — muốn đổi thì nhập lại.
 *
 * Không có `<h1>` và không tự căn giữa: khung do `OrganizationPage` lo.
 */
export default function ConnectionsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useConnections();

  const [deleting, setDeleting] = useState<ConnectionDto | null>(null);

  const testConnection = useTestSavedConnection();
  const remove = useDeleteConnection();

  // Wizard là TRANG riêng chứ không phải hộp thoại trên trang này — xem đầu file
  // `ConnectionWizard.tsx`. Ở đây chỉ còn việc điều hướng.
  function openCreate(): void {
    void navigate('/organization/connections/new');
  }

  function openEdit(connection: ConnectionDto): void {
    void navigate(`/organization/connections/${connection.id}/edit`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-500">
          CSDL của tổ chức mà hệ thống lấy dữ liệu về. Mật khẩu được mã hoá và{' '}
          <strong>không bao giờ hiện lại</strong>.
        </p>
        <Button variant="primary" onClick={openCreate}>
          Thêm kết nối
        </Button>
      </div>

      <div className="mt-5">
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton rows={3} />}

        {data && data.length === 0 && (
          <EmptyState
            title="Chưa có kết nối nào"
            hint="Thêm kết nối tới CSDL của bạn để bắt đầu đưa dữ liệu vào kho."
            action={
              <Button variant="primary" onClick={openCreate}>
                Thêm kết nối
              </Button>
            }
          />
        )}

        {data && data.length > 0 && (
          <TableWrap>
            <THead>
              <Tr>
                <Th>Tên</Th>
                <Th>Loại</Th>
                <Th>Máy chủ</Th>
                <Th>Trạng thái</Th>
                <Th align="right">Tập dữ liệu</Th>
                <Th align="right">Thao tác</Th>
              </Tr>
            </THead>
            <TBody>
              {data.map((connection) => (
                <Tr key={connection.id}>
                  <Td>
                    <div className="font-medium text-slate-900">{connection.name}</div>
                    <div className="text-xs text-slate-500">
                      {connection.databaseName} · {connection.username}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone="neutral">{CONNECTION_KIND_LABELS[connection.kind]}</Badge>
                  </Td>
                  <Td>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {connection.host}:{connection.port}
                    </code>
                  </Td>
                  <Td>
                    <ConnectionStatus connection={connection} />
                  </Td>
                  <Td align="right">
                    {connection.datasetCount > 0 ? (
                      <Badge tone="brand">{connection.datasetCount}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={
                          testConnection.isPending && testConnection.variables === connection.id
                        }
                        onClick={() => testConnection.mutate(connection.id)}
                      >
                        Kiểm tra
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(connection)}>
                        Sửa
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(connection)}>
                        <span className="text-red-600">Xoá</span>
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá kết nối"
        description={deleting?.name}
        confirmLabel="Xoá kết nối"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        {(deleting?.datasetCount ?? 0) > 0 ? (
          <>
            Kết nối này còn <strong>{deleting?.datasetCount} tập dữ liệu</strong>. Hãy xoá chúng
            trong Kho dữ liệu trước — hệ thống không xoá lan xuống để tránh mất dữ liệu ngoài ý
            muốn.
          </>
        ) : (
          <>
            Thông tin đăng nhập vào CSDL này sẽ bị xoá khỏi hệ thống. Dữ liệu trong CSDL của bạn
            không bị ảnh hưởng.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

/**
 * Trạng thái lần kiểm tra gần nhất.
 *
 * Ba trạng thái chứ không hai: "chưa kiểm tra" khác hẳn "đang hỏng". Gộp chúng
 * thành một huy hiệu đỏ sẽ khiến admin đi tìm lỗi ở một kết nối chưa ai thử.
 */
function ConnectionStatus({ connection }: { connection: ConnectionDto }): React.ReactElement {
  if (connection.lastTestError) {
    return (
      <div>
        <Badge tone="danger">Lỗi</Badge>
        {/* Hiện nguyên lý do ngay trong bảng: bắt admin bấm vào từng dòng mới
            biết vì sao là bắt họ mở một kết nối thật tới máy chủ khách hàng chỉ
            để đọc một câu ta đã lưu sẵn. */}
        <div className="mt-0.5 max-w-xs text-xs text-red-600">{connection.lastTestError}</div>
      </div>
    );
  }
  if (connection.lastTestedAt) {
    return (
      <div>
        <Badge tone="success">Tốt</Badge>
        <div className="mt-0.5 text-xs text-slate-500">
          {new Date(connection.lastTestedAt).toLocaleString('vi-VN')}
        </div>
      </div>
    );
  }
  return <Badge tone="warning">Chưa kiểm tra</Badge>;
}
