import type { DataModelDto } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ListToolbar } from '../../components/ui/ListToolbar';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../components/ui/RowMenu';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import { EditDataModelModal } from '../../features/datamodels/EditDataModelModal';
import { ModelReportModal } from '../../features/datamodels/ModelReportModal';
import {
  useDataModels,
  useDataModelsElsewhere,
  useDeleteDataModel,
} from '../../features/datamodels/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';
import { useWorkspace } from '../../workspace/useWorkspace';

/**
 * Danh sách mô hình dữ liệu — §10.1.
 *
 * ─── Đây là một QUYẾT ĐỊNH BỊ ĐẢO, và nói rõ ra thay vì lặng lẽ ─────────────
 *
 * `DataModelPage` trước đây chiếm luôn `/datamodels` và mở thẳng mô hình cập
 * nhật gần nhất, kèm một chú thích dài giải thích vì sao KHÔNG nên có trang
 * danh sách: §10.1 mô tả trang DataModel đã có breadcrumb và thanh tab, tức là
 * mở ra là đã ở trong một mô hình.
 *
 * Lập luận đó đúng khi có một hoặc hai mô hình. Nó hỏng khi có mười: ô chọn
 * trên breadcrumb chỉ cho MỘT cái tên mỗi lúc, nên không có chỗ nào trong ứng
 * dụng trả lời được ba câu hỏi của người quản lý — có bao nhiêu mô hình, cái
 * nào còn dở, cái nào bỏ đi được. Muốn xoá một mô hình thì phải mở nó ra trước;
 * muốn so hai mô hình thì phải bấm qua bấm lại.
 *
 * Nên `/datamodels` giờ là DANH SÁCH, `/datamodels/:id` là chi tiết — cùng hình
 * dạng với `/datasets`. Ô chọn trên breadcrumb được GIỮ, vì đổi nhanh giữa hai
 * mô hình trong lúc đang làm việc là việc khác với quản lý cả bộ.
 *
 * ─── Cột "Quan hệ" mang một cảnh báo, không chỉ một con số ──────────────────
 *
 * Mô hình có bảng chưa nối là mô hình CHƯA DÙNG HẾT ĐƯỢC: Cube không có đường
 * để đi, nên Explorer hỏi lẫn hai bảng rời nhau là lỗi. Đó đúng là thứ một
 * trang quản lý phải chỉ ra từ xa, thay vì để người dùng phát hiện lúc câu truy
 * vấn thất bại.
 */

interface ListQuery {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  /**
   * Hẹp thành hai giá trị chứ không phải `string`.
   *
   * `useListQueryState` trả đúng kiểu `T`, và bảng `ALLOWED` bên dưới là thứ
   * bảo đảm điều đó cho giá trị đọc từ URL — nên `SortableTh` nhận thẳng
   * `query.order` mà không cần một phép ép kiểu ở mỗi cột.
   */
  order: 'asc' | 'desc';
}

const DEFAULTS: ListQuery = { page: 1, pageSize: 20, q: '', sort: 'updatedAt', order: 'desc' };

/** Phải khớp `DATAMODEL_SORT_KEYS` phía backend — lệch là 400, không phải cột không sắp xếp. */
const ALLOWED = {
  sort: ['name', 'datasetCount', 'createdAt', 'updatedAt'],
  order: ['asc', 'desc'],
} as const;

export default function DataModelsPage(): React.ReactElement {
  const permissions = usePermissions();
  const { current, options, select } = useWorkspace();
  const { query, update, reset } = useListQueryState<ListQuery>({ ...DEFAULTS }, ALLOWED);

  const canEdit = permissions.can('datamodel', 'modify');
  const canDelete = permissions.can('datamodel', 'delete');

  const { data, isPending, isError, error, isPlaceholderData } = useDataModels(query);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DataModelDto | null>(null);
  const [reporting, setReporting] = useState<DataModelDto | null>(null);
  const [deleting, setDeleting] = useState<DataModelDto | null>(null);
  const remove = useDeleteDataModel();

  const hasFilter = query.q !== '';
  const isEmpty = data !== undefined && data.items.length === 0;

  /**
   * Đếm mô hình nằm ở workspace KHÁC — chỉ hỏi khi danh sách rỗng và không lọc.
   *
   * Mô hình thuộc về một workspace, nên rỗng ở đây KHÔNG có nghĩa là chưa làm
   * gì. Một khung rỗng im lặng bị đọc thành mất dữ liệu — đúng kết luận đã xảy
   * ra một lần. `enabled` giữ cho trường hợp thường không phải trả thêm một
   * request.
   */
  const elsewhere = useDataModelsElsewhere(isEmpty && !hasFilter);
  const otherWorkspaces = (elsewhere.data?.items ?? [])
    .filter((m) => m.workspaceId !== current?.id)
    .reduce<Map<number, number>>(
      (acc, m) => acc.set(m.workspaceId, (acc.get(m.workspaceId) ?? 0) + 1),
      new Map(),
    );

  function onSort(key: string): void {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  }

  return (
    <Page>
      <PageHeader
        title="Mô hình dữ liệu"
        description="Gắn nhãn ngữ nghĩa cho dữ liệu trong kho, khai quan hệ, rồi hỏi bằng Explorer."
        actions={
          /* Ẩn nút với viewer. Backend cũng chặn bằng 403, nhưng để nút bấm được
             rồi mới báo lỗi là bày ra một cái bẫy không có lý do gì để tồn tại. */
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Tạo mô hình
            </Button>
          ) : undefined
        }
      >
        <div className="mt-4">
          <ListToolbar
            search={query.q}
            onSearch={(q) => update({ q })}
            placeholder="Tên mô hình…"
            hasFilter={hasFilter}
            onReset={reset}
          />
        </div>
      </PageHeader>

      <PageBody scroll={false}>
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton />}

        {isEmpty && (
          <EmptyState
            title={
              hasFilter
                ? 'Không có mô hình nào khớp'
                : `Workspace "${current?.name ?? '—'}" chưa có mô hình nào`
            }
            hint={
              hasFilter
                ? 'Thử đổi từ khoá.'
                : 'Mô hình dựng trên bộ dữ liệu đã nạp vào kho phân tích. Bộ chưa nạp sẽ hiện mờ kèm lý do.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : (
                <div className="space-y-4">
                  {canEdit && (
                    <Button variant="primary" onClick={() => setCreating(true)}>
                      + Tạo mô hình
                    </Button>
                  )}

                  {otherWorkspaces.size > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <p>Mô hình bạn đã tạo đang nằm ở workspace khác:</p>
                      <div className="mt-2 flex flex-wrap justify-center gap-2">
                        {[...otherWorkspaces].map(([workspaceId, count]) => (
                          <Button key={workspaceId} size="sm" onClick={() => select(workspaceId)}>
                            {options.find((w) => w.id === workspaceId)?.name ?? `#${workspaceId}`} (
                            {count})
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            }
          />
        )}

        {data !== undefined && data.items.length > 0 && (
          <div
            className={`flex min-h-0 flex-1 flex-col ${
              isPlaceholderData ? 'opacity-60 transition-opacity' : ''
            }`}
          >
            <TableWrap fill>
              <THead>
                <Tr>
                  <SortableTh
                    sortKey="name"
                    activeKey={query.sort}
                    order={query.order}
                    onSort={onSort}
                  >
                    Tên
                  </SortableTh>
                  <SortableTh
                    sortKey="datasetCount"
                    activeKey={query.sort}
                    order={query.order}
                    onSort={onSort}
                  >
                    Bảng
                  </SortableTh>
                  {/* KHÔNG sắp xếp được: backend chỉ nhận bốn khoá, và thêm khoá
                      thứ năm chỉ để sắp theo số thước đo là đổi cả tầng dưới cho
                      một nhu cầu chưa ai có. */}
                  <Th>Thước đo</Th>
                  <Th>Quan hệ</Th>
                  <Th>Người tạo</Th>
                  <SortableTh
                    sortKey="updatedAt"
                    activeKey={query.sort}
                    order={query.order}
                    onSort={onSort}
                  >
                    Cập nhật lần cuối
                  </SortableTh>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((model) => (
                  <Tr key={model.id}>
                    <Td>
                      {/* `Link` chứ không phải `button onClick`: mở được bằng
                          chuột giữa, chép được địa chỉ, hiện đích ở thanh trạng
                          thái — như mọi liên kết khác. */}
                      <Link
                        to={`/datamodels/${model.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {model.name}
                      </Link>
                      {model.description !== null && (
                        <div className="mt-0.5 max-w-md truncate text-xs text-slate-500">
                          {model.description}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular-nums">{model.datasetCount}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{model.measureCount}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{model.relationshipCount}</span>
                      {/* N bảng cần ÍT NHẤT N-1 quan hệ mới nối liền được. Một
                          bảng thì cần 0 — nên cảnh báo tự tắt ở đó, và báo động
                          giả dạy người dùng bỏ qua mọi cảnh báo khác.

                          Đây là cận DƯỚI, không phải phép kiểm đầy đủ: hai quan
                          hệ giữa cùng một cặp bảng vẫn đếm là hai. Nó bắt được
                          ca hay gặp (quên nối hẳn một bảng) mà không cần dựng
                          đồ thị liên thông ở backend. */}
                      {model.relationshipCount < model.datasetCount - 1 && (
                        <div className="mt-0.5">
                          <Badge tone="warning">chưa nối đủ</Badge>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-600">{model.creatorName ?? '—'}</span>
                    </Td>
                    <Td>
                      <span className="text-slate-500">
                        {new Date(model.updatedAt).toLocaleString('vi-VN')}
                      </span>
                    </Td>
                    <Td align="right">
                      <RowMenu>
                        {(close) => (
                          <>
                            <RowMenuItem
                              icon={ROW_MENU_ICONS.open}
                              onClick={() => {
                                close();
                                setReporting(model);
                              }}
                            >
                              Tạo báo cáo
                            </RowMenuItem>
                            {canEdit && (
                              <RowMenuItem
                                icon={ROW_MENU_ICONS.edit}
                                onClick={() => {
                                  close();
                                  setEditing(model);
                                }}
                              >
                                Đổi tên &amp; mô tả
                              </RowMenuItem>
                            )}
                            {canDelete && (
                              <RowMenuItem
                                icon={ROW_MENU_ICONS.trash}
                                danger
                                onClick={() => {
                                  close();
                                  setDeleting(model);
                                }}
                              >
                                Xoá mô hình
                              </RowMenuItem>
                            )}
                          </>
                        )}
                      </RowMenu>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </TableWrap>

            <div className="shrink-0">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(page) => update({ page })}
              />
            </div>
          </div>
        )}
      </PageBody>

      <CreateDataModelModal open={creating} onClose={() => setCreating(false)} />
      <EditDataModelModal model={editing} onClose={() => setEditing(null)} />
      {/* Gắn vào cây CHỈ khi mở, khác hai hộp thoại trên.
          `ModelReportModal` gọi `useDataModels` ngay lúc mount để dựng ô chọn mô
          hình, mà ở đây ô đó không bao giờ hiện — ta đã biết mô hình nào. Để nó
          thường trú là mỗi lần vào trang tốn thêm một request cho một danh sách
          không ai nhìn. */}
      {reporting !== null && (
        <ModelReportModal open onClose={() => setReporting(null)} datamodelId={reporting.id} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá mô hình dữ liệu"
        description={deleting?.name}
        confirmLabel="Xoá mô hình"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (deleting === null) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Mô hình bị ẩn khỏi danh sách (xoá mềm) cùng mọi thước đo và quan hệ của nó.{' '}
        <strong>Bộ dữ liệu và kho phân tích không bị đụng tới</strong> — mô hình chỉ là lời mô tả
        về chúng.
      </ConfirmDialog>
    </Page>
  );
}
