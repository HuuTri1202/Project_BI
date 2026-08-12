import type { DatasetDto } from '@bi/shared';
import { useState } from 'react';
import { usePermissions } from '../auth/usePermissions';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FilterSelect, ListToolbar } from '../components/ui/ListToolbar';
import { Pagination } from '../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/states';
import type { DatasetListQuery } from '../features/datasets/api';
import { useDatasets, useDeleteDataset } from '../features/datasets/hooks';
import { useListQueryState } from '../hooks/useListQueryState';
import { getApiError } from '../services/apiClient';

/**
 * Quản lý bộ dữ liệu — §7.8.
 *
 * Dựng lại đúng khuôn của các trang danh sách khác: trạng thái nằm trong URL
 * (chia sẻ được, F5 không mất bộ lọc, nút Back hoạt động), tìm kiếm có debounce,
 * và mọi nút ghi đều hỏi `usePermissions` trước khi hiện.
 *
 * Viewer thấy danh sách nhưng không thấy nút Xoá. Backend vẫn chặn bằng 403 —
 * đây chỉ là chuyện không bày ra một cái bẫy.
 */

// Khai kiểu tường minh chứ KHÔNG dùng `as const`: nó thu hẹp mỗi trường xuống
// đúng một literal, khiến đổi giá trị thành lỗi biên dịch và phải ép kiểu khắp nơi.
const DEFAULTS: Omit<DatasetListQuery, 'workspaceId'> = {
  page: 1,
  pageSize: 20,
  q: '',
  status: '',
  sort: 'updatedAt',
  order: 'desc',
};

const ALLOWED = {
  sort: ['name', 'createdAt', 'updatedAt', 'rowCount'],
  order: ['asc', 'desc'],
  status: ['ready', 'failed'],
} as const;

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dùng được' },
  { value: 'failed', label: 'Nhập lỗi' },
];

export default function DatasetsPage(): React.ReactElement {
  const permissions = usePermissions();
  const { query, update, reset } = useListQueryState<Omit<DatasetListQuery, 'workspaceId'>>(
    { ...DEFAULTS },
    ALLOWED,
  );

  const { data, isPending, isError, error, isPlaceholderData } = useDatasets({
    ...query,
    status: query.status as DatasetListQuery['status'],
    order: query.order as 'asc' | 'desc',
  });

  const [deleteTarget, setDeleteTarget] = useState<DatasetDto | null>(null);
  const remove = useDeleteDataset();

  const canDelete = permissions.can('dataset', 'delete');
  const hasFilter = query.q !== '' || query.status !== '';

  const onSort = (key: string): void => {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Bộ dữ liệu</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dữ liệu đã nhập từ file Excel hoặc CSV trong workspace này.
        </p>
      </header>

      <div className="mt-6">
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Tên bộ dữ liệu hoặc tên file…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="filter-status"
            label="Trạng thái"
            value={query.status}
            onChange={(status) => update({ status })}
            allLabel="Đang dùng được"
            options={STATUS_OPTIONS}
          />
        </ListToolbar>
      </div>

      <div className="mt-4">
        {isPending && <TableSkeleton />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không có bộ dữ liệu nào khớp bộ lọc' : 'Chưa có bộ dữ liệu nào'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.'
                : 'Bấm “Tạo báo cáo” ở trang chủ để tải file Excel hoặc CSV lên.'
            }
            action={hasFilter ? <Button onClick={reset}>Xoá lọc</Button> : undefined}
          />
        )}

        {data && data.items.length > 0 && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap>
              <THead>
                <Tr>
                  <SortableTh sortKey="name" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Tên
                  </SortableTh>
                  <Th>File gốc</Th>
                  <Th>Sheet</Th>
                  <Th align="right">Số cột</Th>
                  <SortableTh
                    sortKey="rowCount"
                    activeKey={query.sort}
                    order={query.order}
                    onSort={onSort}
                  >
                    Số dòng
                  </SortableTh>
                  <SortableTh
                    sortKey="updatedAt"
                    activeKey={query.sort}
                    order={query.order}
                    onSort={onSort}
                  >
                    Cập nhật
                  </SortableTh>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((dataset) => (
                  <Tr key={dataset.id}>
                    <Td>
                      <div className="font-medium text-slate-900">{dataset.name}</div>
                      {dataset.status === 'failed' && (
                        <div className="mt-0.5 text-xs text-red-600">
                          {dataset.errorMessage ?? 'Nhập không thành công'}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-600">{dataset.originalFilename}</span>
                      <div className="text-xs text-slate-400">
                        {dataset.fileExt.toUpperCase()}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-slate-600">{dataset.sheetName ?? '—'}</span>
                    </Td>
                    <Td align="right">
                      <span className="tabular-nums">{dataset.columnCount}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">
                        {dataset.rowCount.toLocaleString('vi-VN')}
                      </span>
                      {dataset.truncated && (
                        // `rowCount` một mình nói dối: 50.000 có thể là toàn bộ
                        // file hoặc là phần đầu của nửa triệu dòng.
                        <div className="mt-0.5">
                          <Badge tone="warning">đã cắt bớt</Badge>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-500">
                        {new Date(dataset.updatedAt).toLocaleDateString('vi-VN')}
                      </span>
                    </Td>
                    <Td align="right">
                      {canDelete ? (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(dataset)}>
                          <span className="text-red-600">Xoá</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">Chỉ xem</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </TableWrap>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Xoá bộ dữ liệu"
        description={deleteTarget?.name}
        confirmLabel="Xoá bộ dữ liệu"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
            onError,
          });
        }}
      >
        Bộ dữ liệu bị ẩn khỏi workspace (xoá mềm). Nếu còn báo cáo đang dùng nó, hệ thống sẽ từ
        chối và cho bạn biết còn bao nhiêu — xoá những báo cáo đó trước.
      </ConfirmDialog>
    </div>
  );
}
