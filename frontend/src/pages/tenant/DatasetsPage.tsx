import {
  CONNECTION_KIND_LABELS,
  DATASET_SOURCE_LABELS,
  DATASET_SOURCES,
  type DatasetDto,
} from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
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
 * Kho dữ liệu — §7.8 + §8.5, MỘT trang cho cả hai nguồn.
 *
 * Trang riêng ở sidebar chứ không phải một tab của Quản lý tổ chức: kho dữ liệu
 * là nơi làm việc HÀNG NGÀY của người phân tích, còn Quản lý tổ chức là nơi cấu
 * hình. Viewer đọc được trang này; chỉ creator trở lên mới đồng bộ hoặc xoá.
 *
 * ─── Vì sao một bảng chứ không phải hai tab ─────────────────────────────────
 *
 * Bộ dữ liệu từ file (§7) và bảng đồng bộ từ CSDL (§8) trả lời cùng một câu hỏi
 * của người dùng: "tôi dựng báo cáo lên được cái gì". Tách thành hai tab bắt họ
 * nhớ mình đã nạp dữ liệu bằng đường nào mới tìm lại được — mà đó chính là chi
 * tiết họ không cần biết. Cột "Nguồn" nói rõ cái nào là cái nào, và ô lọc cho
 * ai thật sự cần chỉ xem một loại.
 *
 * Đổi lại, vài cột chỉ có nghĩa với một nguồn (bảng nguồn, số dòng) nên hiện
 * `—` với nguồn kia. Chấp nhận được: một dấu gạch đọc ra ngay là "không áp
 * dụng", trong khi hai bảng riêng thì mọi chỗ đếm đều phải cộng hai câu truy vấn.
 */
const DEFAULTS: DatasetListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc',
  q: '',
  connectionId: '',
  source: '',
};

const ALLOWED = {
  sort: ['name', 'sourceTable', 'columnCount', 'syncedAt', 'rowCount'],
  order: ['asc', 'desc'],
  source: ['connection', 'file'],
} as const;

const SOURCE_OPTIONS = DATASET_SOURCES.map((value) => ({
  value,
  label: DATASET_SOURCE_LABELS[value],
}));

export default function DatasetsPage(): React.ReactElement {
  const permissions = usePermissions();
  const { query, update, reset } = useListQueryState<DatasetListQuery>({ ...DEFAULTS }, ALLOWED);

  const { data, isPending, isError, error, isPlaceholderData } = useDatasets({
    ...query,
    order: query.order as 'asc' | 'desc',
    source: query.source as DatasetListQuery['source'],
    connectionId: query.connectionId === '' ? '' : Number(query.connectionId),
  });
  const { data: connections } = useConnections();

  const [syncOpen, setSyncOpen] = useState(false);
  const [renaming, setRenaming] = useState<DatasetDto | null>(null);
  const [deleting, setDeleting] = useState<DatasetDto | null>(null);

  const remove = useDeleteDataset();

  const hasFilter = query.q !== '' || query.connectionId !== '' || query.source !== '';

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
            Mọi bộ dữ liệu dựng báo cáo được. Với bảng lấy từ CSDL, hệ thống chỉ lưu{' '}
            <strong>cấu trúc</strong> — dữ liệu vẫn nằm nguyên trong CSDL nguồn; với file Excel/CSV
            thì dữ liệu đã được nhập vào đây.
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
          placeholder="Tên bộ dữ liệu, tên bảng hoặc tên file…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="filter-source"
            label="Nguồn"
            value={String(query.source)}
            onChange={(source) => update({ source })}
            allLabel="Mọi nguồn"
            options={SOURCE_OPTIONS}
          />
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
            title={hasFilter ? 'Không có bộ dữ liệu nào khớp' : 'Kho dữ liệu đang trống'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá.'
                : 'Bấm “Đồng bộ từ CSDL” để lấy bảng về, hoặc “Tạo báo cáo” ở trang chủ để tải file Excel/CSV lên.'
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
                  <Th>Nguồn</Th>
                  <SortableTh sortKey="sourceTable" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Bảng / File gốc
                  </SortableTh>
                  <SortableTh sortKey="columnCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Số cột
                  </SortableTh>
                  <SortableTh sortKey="rowCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Số dòng
                  </SortableTh>
                  <SortableTh sortKey="syncedAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Cập nhật lần cuối
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
                      {dataset.status === 'failed' && (
                        <div className="mt-0.5 text-xs text-red-600">
                          {dataset.errorMessage ?? 'Nhập không thành công'}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-700">
                        {DATASET_SOURCE_LABELS[dataset.source]}
                      </span>
                      <div className="text-xs text-slate-500">
                        {dataset.source === 'connection'
                          ? [
                              dataset.connectionName,
                              dataset.connectionKind
                                ? CONNECTION_KIND_LABELS[dataset.connectionKind]
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : (dataset.fileExt?.toUpperCase() ?? '')}
                      </div>
                    </Td>
                    <Td>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {dataset.source === 'connection'
                          ? `${dataset.sourceSchema}.${dataset.sourceTable}`
                          : dataset.originalFilename}
                      </code>
                      {/* Một file nhiều sheet sinh ra nhiều bộ dữ liệu cùng tên
                          file, nên tên sheet là thứ phân biệt chúng. */}
                      {dataset.sheetName !== null && (
                        <div className="text-xs text-slate-500">Sheet: {dataset.sheetName}</div>
                      )}
                    </Td>
                    <Td>{dataset.columnCount}</Td>
                    <Td>
                      {/* Nguồn `connection` không có số dòng: nền tảng không giữ
                          bản sao nào, và `COUNT(*)` trên bảng của khách hàng mỗi
                          lần mở trang là cái giá không đáng trả. */}
                      {dataset.source === 'file' ? (
                        <>
                          <span className="tabular-nums">
                            {dataset.rowCount.toLocaleString('vi-VN')}
                          </span>
                          {dataset.truncated && (
                            // `rowCount` một mình nói dối: 50.000 có thể là toàn
                            // bộ file hoặc phần đầu của nửa triệu dòng.
                            <div className="mt-0.5">
                              <Badge tone="warning">đã cắt bớt</Badge>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
        title="Xoá bộ dữ liệu"
        description={deleting?.name}
        confirmLabel="Xoá"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        {/* Hai nguồn có hậu quả khác hẳn nhau, nên câu cảnh báo phải khác nhau.
            Nói "dữ liệu nguồn không bị đụng tới" cho một file đã nhập vào đây là
            trấn an người dùng bằng một điều không đúng. */}
        {deleting?.source === 'file' ? (
          <>
            Bộ dữ liệu bị ẩn khỏi kho (xoá mềm) cùng toàn bộ dòng đã nhập. Còn báo cáo đang dùng nó
            thì hệ thống từ chối và cho bạn biết còn bao nhiêu — xoá những báo cáo đó trước.
          </>
        ) : (
          <>
            Bộ dữ liệu bị gỡ khỏi kho. <strong>Dữ liệu trong CSDL nguồn không bị đụng tới</strong> —
            đồng bộ lại bảng <code className="text-xs">{deleting?.sourceTable}</code> sẽ đưa nó trở
            lại đúng như cũ.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
