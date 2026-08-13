import { CONNECTION_KIND_LABELS, type DatasetDto } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import type { DatasetListQuery } from '../../features/tenant/api';
import { RenameDatasetModal } from '../../features/tenant/datasets/RenameDatasetModal';
import { SyncTablesModal } from '../../features/tenant/datasets/SyncTablesModal';
import { useConnections, useDatasets, useDeleteDataset } from '../../features/tenant/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';

/**
 * Kho dữ liệu — §8.5.
 *
 * Trang riêng ở sidebar chứ không phải một tab của Quản lý tổ chức: kho dữ liệu
 * là nơi làm việc HÀNG NGÀY của người phân tích, còn Quản lý tổ chức là nơi cấu
 * hình. Viewer đọc được trang này; chỉ creator trở lên mới đồng bộ.
 */
const DEFAULTS: DatasetListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc',
  q: '',
  connectionId: '',
};

const ALLOWED = {
  sort: ['name', 'sourceTable', 'columnCount', 'syncedAt'],
  order: ['asc', 'desc'],
} as const;

export default function DatasetsPage(): React.ReactElement {
  const permissions = usePermissions();
  const { query, update, reset } = useListQueryState<DatasetListQuery>({ ...DEFAULTS }, ALLOWED);

  const { data, isPending, isError, error, isPlaceholderData } = useDatasets({
    ...query,
    order: query.order as 'asc' | 'desc',
    connectionId: query.connectionId === '' ? '' : Number(query.connectionId),
  });
  const { data: connections } = useConnections();

  const [syncOpen, setSyncOpen] = useState(false);
  const [renaming, setRenaming] = useState<DatasetDto | null>(null);
  const [deleting, setDeleting] = useState<DatasetDto | null>(null);

  const remove = useDeleteDataset();

  const hasFilter = query.q !== '' || query.connectionId !== '';

  function onSort(key: string): void {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Kho dữ liệu</h1>
          <p className="mt-1 text-sm text-slate-500">
            Các bảng đã lấy về từ CSDL của tổ chức. Hệ thống chỉ lưu <strong>cấu trúc</strong> —
            dữ liệu vẫn nằm nguyên trong CSDL nguồn.
          </p>
        </div>
        {/* Ẩn nút với viewer. Backend cũng chặn bằng 403, nhưng để nút bấm được
            rồi mới báo lỗi là bày ra một cái bẫy không có lý do gì để tồn tại. */}
        {permissions.can('dataset', 'modify') && (
          <Button variant="primary" onClick={() => setSyncOpen(true)}>
            Đồng bộ từ CSDL
          </Button>
        )}
      </header>

      <div className="mt-6">
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Tên tập dữ liệu hoặc tên bảng…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="filter-connection"
            label="Kết nối"
            value={String(query.connectionId)}
            onChange={(connectionId) => update({ connectionId })}
            allLabel="Mọi kết nối"
            options={(connections ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
        </ListToolbar>
      </div>

      <div className="mt-4">
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không có tập dữ liệu nào khớp' : 'Kho dữ liệu đang trống'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá.'
                : 'Bấm “Đồng bộ từ CSDL” để chọn những bảng muốn đưa vào kho.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : permissions.can('dataset', 'modify') ? (
                <Button variant="primary" onClick={() => setSyncOpen(true)}>
                  Đồng bộ từ CSDL
                </Button>
              ) : undefined
            }
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
                  <SortableTh sortKey="sourceTable" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Bảng nguồn
                  </SortableTh>
                  <Th>Nguồn gốc</Th>
                  <SortableTh sortKey="columnCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Số cột
                  </SortableTh>
                  <Th align="right">Mô hình</Th>
                  <SortableTh sortKey="syncedAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Đồng bộ lần cuối
                  </SortableTh>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((dataset) => (
                  <Tr key={dataset.id}>
                    <Td>
                      {/* `Link` chứ không phải `button onClick`: tên tập dữ liệu
                          giờ dẫn tới một trang thật, nên nó phải mở được bằng
                          chuột giữa, chép được địa chỉ, và hiện đích ở thanh
                          trạng thái như mọi liên kết khác. */}
                      <Link
                        to={`/datasets/${dataset.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {dataset.name}
                      </Link>
                    </Td>
                    <Td>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {dataset.sourceSchema}.{dataset.sourceTable}
                      </code>
                    </Td>
                    <Td>
                      <div className="text-slate-700">{dataset.connectionName}</div>
                      <div className="text-xs text-slate-500">
                        {CONNECTION_KIND_LABELS[dataset.connectionKind]}
                      </div>
                    </Td>
                    <Td>{dataset.columnCount}</Td>
                    <Td align="right">
                      {/* Luôn 0 cho tới Section 09. Gắn nhãn thay vì hiện số 0
                          trần: một cột toàn số 0 trông như dữ liệu hỏng. */}
                      <span className="text-xs text-slate-400">sắp có</span>
                    </Td>
                    <Td>
                      <span className="text-slate-500">
                        {dataset.syncedAt
                          ? new Date(dataset.syncedAt).toLocaleString('vi-VN')
                          : '—'}
                      </span>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Link
                          to={`/datasets/${dataset.id}`}
                          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        >
                          Xem cột
                        </Link>
                        {permissions.can('dataset', 'modify') && (
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(dataset)}>
                            Đổi tên
                          </Button>
                        )}
                        {permissions.can('dataset', 'delete') && (
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(dataset)}>
                            <span className="text-red-600">Xoá</span>
                          </Button>
                        )}
                      </div>
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

      <SyncTablesModal open={syncOpen} onClose={() => setSyncOpen(false)} />
      <RenameDatasetModal dataset={renaming} onClose={() => setRenaming(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá tập dữ liệu"
        description={deleting?.name}
        confirmLabel="Xoá"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Tập dữ liệu bị gỡ khỏi kho. <strong>Dữ liệu trong CSDL nguồn không bị đụng tới</strong> —
        đồng bộ lại bảng <code className="text-xs">{deleting?.sourceTable}</code> sẽ đưa nó trở
        lại đúng như cũ.
      </ConfirmDialog>
    </div>
  );
}
