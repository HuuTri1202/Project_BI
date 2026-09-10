import { allVisuals, CHART_TYPE_LABELS, REPORT_SOURCE_LABELS, type ReportDto } from '@bi/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ListToolbar } from '../../components/ui/ListToolbar';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../components/ui/RowMenu';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { useDeleteReport, useReports } from '../../features/datasets/hooks';
import { CreateReportMenu } from '../../features/tenant/CreateReportMenu';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';
import { useWorkspace } from '../../workspace/useWorkspace';

/**
 * Danh sách báo cáo — §10.10.
 *
 * ═══ Vì sao khu này phải tồn tại ════════════════════════════════════════════
 *
 * Cho tới §10.9, báo cáo không có nhà. Tạo thì tạo từ trong tab Mô hình dữ liệu,
 * xem thì xem qua khối "Báo cáo gần đây" trên trang chủ — một khối bị cắt ở
 * trần vài dòng. Hệ quả là ba câu hỏi đơn giản không có chỗ nào trả lời: có
 * tất cả bao nhiêu báo cáo, cái nào của ai, cái nào bỏ đi được.
 *
 * Đây cũng là điểm vào của trình dựng. Trước bản này người dùng phải biết TRƯỚC
 * mình sẽ dùng mô hình nào rồi mới tìm ra chỗ bắt đầu — thứ tự ngược với cách
 * người ta thật sự nghĩ về việc làm một báo cáo.
 *
 * ═══ Cột "Biểu đồ" nói SỐ Ô, không phải loại ════════════════════════════════
 *
 * Với báo cáo một biểu đồ thì loại là thông tin đúng và đủ. Với một khung ba ô
 * thì "Biểu đồ cột" là một nửa sự thật — nó là loại của ô ĐẦU TIÊN. Nên khung
 * hiện số ô, còn báo cáo một biểu đồ giữ nguyên tên loại.
 */

interface ListQuery {
  page: number;
  pageSize: number;
  q: string;
}

const DEFAULTS: ListQuery = { page: 1, pageSize: 20, q: '' };

export default function ReportsPage(): React.ReactElement {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { current } = useWorkspace();
  const { query, update, reset } = useListQueryState<ListQuery>({ ...DEFAULTS });

  const canEdit = permissions.can('report', 'modify');
  const canDelete = permissions.can('report', 'delete');

  const { data, isPending, isError, error, isPlaceholderData } = useReports(query);
  const remove = useDeleteReport();

  const [deleting, setDeleting] = useState<ReportDto | null>(null);

  const hasFilter = query.q !== '';
  const isEmpty = data !== undefined && data.items.length === 0;

  return (
    <Page>
      <PageHeader
        title="Báo cáo"
        description="Khung biểu đồ dựng trên mô hình dữ liệu. Mỗi báo cáo chứa một hoặc nhiều biểu đồ trên cùng một khung."
        actions={
          /* Ẩn nút với viewer. Backend cũng chặn bằng 403, nhưng để nút bấm được
             rồi mới báo lỗi là bày ra một cái bẫy không có lý do gì để tồn tại. */
          canEdit ? <CreateReportMenu /> : undefined
        }
      >
        <div className="mt-4">
          <ListToolbar
            search={query.q}
            onSearch={(q) => update({ q })}
            placeholder="Tên báo cáo…"
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
                ? 'Không có báo cáo nào khớp'
                : `Workspace "${current?.name ?? '—'}" chưa có báo cáo nào`
            }
            hint={
              hasFilter
                ? 'Thử đổi từ khoá.'
                : 'Hai đường: tải một file Excel/CSV lên để vào thẳng trình dựng, hoặc chọn một mô hình dữ liệu đã có.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : canEdit ? (
                <CreateReportMenu />
              ) : undefined
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
                  <Th>Tên</Th>
                  <Th>Biểu đồ</Th>
                  <Th>Nguồn</Th>
                  <Th>Người tạo</Th>
                  <Th>Cập nhật lần cuối</Th>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((report) => (
                  <Tr key={report.id}>
                    <Td>
                      {/* `Link` chứ không phải `button onClick`: mở được bằng
                          chuột giữa, chép được địa chỉ, hiện đích ở thanh trạng
                          thái — như mọi liên kết khác.

                          Đích là trang XEM, không phải trình dựng (§10.13). Bấm
                          tên một báo cáo là muốn ĐỌC nó; ai sửa được thì có nút
                          "Chỉnh sửa" ngay trên thanh của trang đó. */}
                      <Link
                        to={`/reports/${report.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {report.name}
                      </Link>
                    </Td>
                    <Td>{chartBadge(report)}</Td>
                    <Td>
                      <Badge tone="neutral">{REPORT_SOURCE_LABELS[report.source]}</Badge>
                      <div className="mt-0.5 max-w-xs truncate text-xs text-slate-500">
                        {report.sourceName}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-slate-600">{report.creatorName ?? '—'}</span>
                    </Td>
                    <Td>
                      <span className="text-slate-500">
                        {new Date(report.updatedAt).toLocaleString('vi-VN')}
                      </span>
                    </Td>
                    <Td align="right">
                      <RowMenu>
                        {(close) => (
                          <>
                            {/* "Mở" luôn có; "Chỉnh sửa" chỉ hiện khi sửa được
                                THẬT — tức là có quyền VÀ báo cáo dựng trên mô
                                hình. Hứa "Sửa" rồi đẩy người ta về trang xem là
                                một lời hứa không giữ được, và báo cáo §7.6 (dựng
                                trên bộ dữ liệu) mang cấu hình dạng tên cột nên
                                trình dựng không đọc nổi. */}
                            <RowMenuItem
                              icon={ROW_MENU_ICONS.open}
                              onClick={() => {
                                close();
                                void navigate(`/reports/${report.id}`);
                              }}
                            >
                              Mở báo cáo
                            </RowMenuItem>
                            {canEdit && report.source === 'datamodel' && (
                              <RowMenuItem
                                icon={ROW_MENU_ICONS.edit}
                                onClick={() => {
                                  close();
                                  void navigate(`/reports/${report.id}/edit`);
                                }}
                              >
                                Chỉnh sửa
                              </RowMenuItem>
                            )}
                            {canDelete && (
                              <RowMenuItem
                                icon={ROW_MENU_ICONS.trash}
                                danger
                                onClick={() => {
                                  close();
                                  setDeleting(report);
                                }}
                              >
                                Xoá báo cáo
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

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá báo cáo"
        confirmLabel="Xoá báo cáo"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (deleting === null) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Xoá <strong>{deleting?.name}</strong>? Nguồn số liệu vẫn giữ nguyên, bạn dựng lại báo cáo
        khác từ nó được.
      </ConfirmDialog>
    </Page>
  );
}

/** Xem ghi chú đầu file: khung nói SỐ Ô, báo cáo một biểu đồ nói LOẠI. */
function chartBadge(report: ReportDto): React.ReactElement {
  if (report.canvas !== null) {
    // Đếm ô của MỌI trang: từ §10.12 một báo cáo có thể có nhiều trang, và đếm
    // riêng trang đầu sẽ nói "2 biểu đồ" cho một báo cáo mười biểu đồ.
    const count = allVisuals(report.canvas).length;
    const pages = report.canvas.pages.length;
    return (
      <Badge tone="neutral">
        {count} biểu đồ{pages > 1 && ` · ${pages} trang`}
      </Badge>
    );
  }
  if (report.chartType === null) return <Badge tone="warning">Chưa có biểu đồ</Badge>;
  return <Badge tone="neutral">{CHART_TYPE_LABELS[report.chartType]}</Badge>;
}
