import type { DataModelDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ListToolbar } from '../../components/ui/ListToolbar';
import { Modal } from '../../components/ui/Modal';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import type { DataModelListQuery } from '../../features/datamodels/api';
import {
  useDataModels,
  useDeleteDataModel,
  useUpdateDataModel,
} from '../../features/datamodels/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';

/**
 * Danh sách Data Model — §8.1.
 *
 * ─── Nhãn tiếng Anh, câu giải thích tiếng Việt ──────────────────────────────
 *
 * Khu này dùng từ vựng tiếng Anh cho tiêu đề, tên cột và nút ("Data Model",
 * "Dataset Quantity", "+ Create Model") vì đó là ngôn ngữ của chính khái niệm —
 * Schema, Field, Measure, Dimension đều là thuật ngữ Cube.js. Còn thông báo lỗi
 * và câu hướng dẫn giữ tiếng Việt như toàn bộ phần còn lại của hệ thống: người
 * đọc chúng đang gặp trục trặc, và đó là lúc tệ nhất để bắt họ dịch.
 */

const DEFAULTS: Omit<DataModelListQuery, 'workspaceId'> = {
  page: 1,
  pageSize: 20,
  q: '',
  sort: 'updatedAt',
  order: 'desc',
};

const ALLOWED = {
  sort: ['name', 'datasetCount', 'createdAt', 'updatedAt'],
  order: ['asc', 'desc'],
} as const;

/**
 * Menu ba chấm ở cột Actions.
 *
 * `pointerdown` trên `document` để đóng, không phải `blur`: `blur` bắn TRƯỚC
 * `click` của mục bên trong, nên menu đóng trước khi cú bấm tới nơi và không
 * mục nào bấm được.
 */
function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent): void {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onEsc(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Thao tác"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Sửa
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-slate-50"
          >
            Xoá
          </button>
        </div>
      )}
    </div>
  );
}

export default function DataModelsPage(): React.ReactElement {
  const permissions = usePermissions();
  const { query, update, reset } = useListQueryState<Omit<DataModelListQuery, 'workspaceId'>>(
    { ...DEFAULTS },
    ALLOWED,
  );

  const { data, isPending, isError, error, isPlaceholderData } = useDataModels({
    ...query,
    order: query.order as 'asc' | 'desc',
  });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DataModelDto | null>(null);
  const [deleting, setDeleting] = useState<DataModelDto | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const remove = useDeleteDataModel();
  const rename = useUpdateDataModel(editing?.id ?? 0);

  const canEdit = permissions.can('datamodel', 'modify');
  const canDelete = permissions.can('datamodel', 'delete');
  const hasFilter = query.q !== '';

  function onSort(key: string): void {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  }

  function openEdit(model: DataModelDto): void {
    setFormError(null);
    setForm({ name: model.name, description: model.description ?? '' });
    setEditing(model);
  }

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-baseline gap-2">
            Data Model
            {data !== undefined && (
              <span className="text-base font-normal text-slate-400">{data.total}</span>
            )}
          </span>
        }
        description="Manage Data Model"
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Create Model
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Tên mô hình…"
          hasFilter={hasFilter}
          onReset={reset}
        />

        <div className="mt-4">
          {isError && <ErrorState message={getApiError(error).message} />}
          {isPending && <TableSkeleton />}

          {data && data.items.length === 0 && (
            <EmptyState
              title={hasFilter ? 'Không có mô hình nào khớp' : 'Chưa có Data Model nào'}
              hint={
                hasFilter
                  ? 'Thử đổi từ khoá.'
                  : 'Model dựng trên những bộ dữ liệu ĐÃ NẠP vào kho phân tích. Bộ dữ liệu nạp xong sẽ tự có một model riêng.'
              }
              action={
                hasFilter ? (
                  <Button onClick={reset}>Xoá lọc</Button>
                ) : canEdit ? (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    + Create Model
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
                    <SortableTh
                      sortKey="name"
                      activeKey={query.sort}
                      order={query.order}
                      onSort={onSort}
                    >
                      Name
                    </SortableTh>
                    <Th>Description</Th>
                    <SortableTh
                      sortKey="datasetCount"
                      activeKey={query.sort}
                      order={query.order}
                      onSort={onSort}
                    >
                      Dataset Quantity
                    </SortableTh>
                    <Th align="right">Related Reports</Th>
                    <SortableTh
                      sortKey="updatedAt"
                      activeKey={query.sort}
                      order={query.order}
                      onSort={onSort}
                    >
                      Updated
                    </SortableTh>
                    <Th align="right">Actions</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.items.map((model) => (
                    <Tr key={model.id}>
                      <Td>
                        <Link
                          to={`/datamodels/${model.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {model.name}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-slate-600">
                          {model.description ?? <span className="text-slate-400">—</span>}
                        </span>
                      </Td>
                      <Td>{model.datasetCount}</Td>
                      <Td align="right">{model.reportCount}</Td>
                      <Td>
                        <span className="text-slate-500">
                          {new Date(model.updatedAt).toLocaleDateString('vi-VN')}
                        </span>
                      </Td>
                      <Td align="right">
                        {canEdit || canDelete ? (
                          <RowMenu
                            onEdit={() => openEdit(model)}
                            onDelete={() => setDeleting(model)}
                          />
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
      </PageBody>

      <CreateDataModelModal open={creating} onClose={() => setCreating(false)} />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Model"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Huỷ</Button>
            <Button
              variant="primary"
              loading={rename.isPending}
              onClick={() => {
                setFormError(null);
                rename.mutate(
                  {
                    name: form.name,
                    description: form.description.trim() === '' ? null : form.description.trim(),
                  },
                  {
                    onSuccess: () => setEditing(null),
                    onError: (err) => setFormError(getApiError(err).message),
                  },
                );
              }}
            >
              Lưu
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError !== null && <ErrorState message={formError} />}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Name</span>
            <input
              type="text"
              value={form.name}
              autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
            <textarea
              value={form.description}
              rows={3}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá Data Model"
        description={deleting?.name}
        confirmLabel="Xoá model"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (deleting === null) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Model bị ẩn khỏi danh sách (xoá mềm) cùng mọi Schema và quan hệ của nó.{' '}
        <strong>Bộ dữ liệu và kho phân tích không bị đụng tới</strong> — model chỉ là lời mô tả về
        chúng.
      </ConfirmDialog>
    </Page>
  );
}
