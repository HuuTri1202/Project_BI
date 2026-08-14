import {
  DATA_PAGE_SIZES,
  LOAD_STATUS_LABELS,
  LOAD_STATUSES_LIVE,
  type DatasetLoadStatus,
  type DatasetSource,
} from '@bi/shared';
import { useState } from 'react';
import { usePermissions } from '../../../auth/usePermissions';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { getApiError } from '../../../services/apiClient';
import {
  useDatasetLoad,
  useDatasetLoadErrors,
  useStartLoad,
  useWarehousePreview,
} from '../hooks';

/**
 * Tab "Kho phân tích" — nạp dữ liệu sang ClickHouse và theo dõi tiến độ (§9).
 *
 * ─── Vì sao là một tab riêng, không phải một nút trong header ────────────────
 *
 * Vì có ba thứ phải nói cùng lúc và chúng không nhét vừa một nút: trạng thái
 * hiện tại, kết quả lần nạp gần nhất, và danh sách ô hỏng. Nhét vào header thì
 * hai thứ sau không có chỗ, và người dùng không có cách nào biết vì sao con số
 * trong kho lệch với con số trong file.
 */

const ERROR_PAGE_SIZE = 20;

/**
 * Cỡ trang mặc định của bảng dữ liệu.
 *
 * 20 chứ không phải 100: khiếu nại ban đầu đúng là "hiện một lúc hàng trăm dòng
 * rồi phải cuộn mất tiêu đề". Ai cần nhiều hơn thì đổi bằng ô chọn, và lựa chọn
 * đó nằm ngay dưới bảng.
 */
const DEFAULT_DATA_PAGE_SIZE = DATA_PAGE_SIZES[0];

/** Tone của badge. Chữ LUÔN đi kèm — xem ghi chú trong `Badge.tsx`. */
const TONES: Record<DatasetLoadStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  idle: 'neutral',
  queued: 'neutral',
  running: 'brand',
  loaded: 'success',
  failed: 'danger',
};

export function LoadStatusBadge({ status }: { status: DatasetLoadStatus }): React.ReactElement {
  return <Badge tone={TONES[status]}>{LOAD_STATUS_LABELS[status]}</Badge>;
}

export function LoadPanel({
  datasetId,
  source,
}: {
  datasetId: number;
  source: DatasetSource;
}): React.ReactElement {
  const permissions = usePermissions();
  const { data, isPending, isError, error } = useDatasetLoad(datasetId);
  const start = useStartLoad(datasetId);
  const [errorPage, setErrorPage] = useState(1);
  const [showErrors, setShowErrors] = useState(false);

  const status = data?.datasetStatus ?? 'idle';
  const live = LOAD_STATUSES_LIVE.includes(status);
  const failedCells = data?.rowsFailed ?? 0;

  const errors = useDatasetLoadErrors(
    datasetId,
    { page: errorPage, pageSize: ERROR_PAGE_SIZE },
    failedCells > 0,
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {/* Dải trạng thái gộp thành MỘT dòng thay vì bốn thẻ xếp lưới. Bốn thẻ
          chiếm gần 110px để nói bốn thông tin ngắn, và chúng đẩy bảng dữ liệu —
          thứ người dùng thật sự vào đây để xem — xuống dưới mép màn hình. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <LoadStatusBadge status={status} />
          {data && data.rowsLoaded > 0 && (
            <span className="tabular-nums">
              {data.rowsLoaded.toLocaleString('vi-VN')} dòng{live ? '…' : ''}
            </span>
          )}
          {data?.finishedAt && <span>{new Date(data.finishedAt).toLocaleString('vi-VN')}</span>}
          {data?.chTable && (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {data.chTable}
            </code>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Chuyển qua lại giữa hai bảng thay vì xếp chồng: hai bảng cùng lúc
              là hai vùng cuộn tranh nhau chỗ, và không cái nào đủ cao để dùng. */}
          {failedCells > 0 && (
            <Button onClick={() => setShowErrors((v) => !v)}>
              {showErrors
                ? 'Xem dữ liệu'
                : `${failedCells.toLocaleString('vi-VN')} ô không đọc được`}
            </Button>
          )}
          {permissions.can('dataset', 'modify') && (
            <Button
              variant="primary"
              loading={start.isPending || live}
              disabled={live}
              onClick={() => start.mutate()}
            >
              {status === 'loaded' || status === 'failed' ? 'Nạp lại' : 'Nạp vào kho'}
            </Button>
          )}
        </div>
      </div>

      {start.isError && (
        <div className="mt-3 shrink-0">
          <ErrorState message={getApiError(start.error).message} />
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {isPending && <TableSkeleton rows={3} />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && status === 'failed' && data.errorMessage !== null && (
          <ErrorState message={data.errorMessage} />
        )}

        {data && status === 'idle' && (
          <EmptyState
            title="Chưa nạp lần nào"
            hint="Bộ dữ liệu được nạp tự động sau khi tải file lên hoặc sau khi đồng bộ bảng. Bấm “Nạp vào kho” nếu muốn chạy ngay."
          />
        )}

        {data && showErrors && failedCells > 0 && (
          <>
            {/* Nói THẲNG rằng danh sách bị cắt. Hiện 100 dòng cho 12.480 ô hỏng
                mà không chú thích sẽ khiến người dùng sửa hết 100 dòng rồi
                tưởng đã xong. */}
            <p className="shrink-0 pb-3 text-sm text-slate-500">
              Những ô này được ghi <code className="text-xs">NULL</code>, phần còn lại vẫn nạp
              bình thường.{' '}
              {(errors.data?.total ?? 0) < failedCells &&
                `Danh sách chỉ lưu ${errors.data?.total ?? 0} ô đầu làm ví dụ. `}
              {source === 'file'
                ? 'Số dòng khớp với file gốc, không tính hàng tiêu đề.'
                : 'Số dòng là thứ tự đọc của lần nạp này, không phải khoá của bảng nguồn.'}
            </p>

            {errors.isPending && <TableSkeleton rows={4} />}
            {errors.isError && <ErrorState message={getApiError(errors.error).message} />}

            {errors.data && errors.data.items.length > 0 && (
              <>
                <TableWrap fill>
                  <THead>
                    <Tr>
                      <Th>Dòng</Th>
                      <Th>Cột</Th>
                      <Th>Giá trị</Th>
                      <Th>Lý do</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {errors.data.items.map((item) => (
                      <Tr key={item.id}>
                        <Td>
                          <span className="tabular-nums text-slate-500">
                            {item.rowIndex.toLocaleString('vi-VN')}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-medium text-slate-900">
                            {item.columnName ?? '—'}
                          </span>
                        </Td>
                        <Td>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {item.rawValue ?? '—'}
                          </code>
                        </Td>
                        <Td>
                          <span className="text-slate-600">{item.reason}</span>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </TableWrap>

                <div className="shrink-0">
                  <Pagination
                    page={errorPage}
                    pageSize={ERROR_PAGE_SIZE}
                    total={errors.data.total}
                    totalPages={errors.data.totalPages}
                    onPageChange={setErrorPage}
                  />
                </div>
              </>
            )}
          </>
        )}

        {data && !showErrors && status === 'loaded' && <WarehouseRows datasetId={datasetId} />}
      </div>
    </section>
  );
}

/**
 * Bảng dữ liệu ĐANG NẰM TRONG KHO.
 *
 * Đây là câu trả lời cho "làm sao biết dữ liệu đã xuống ClickHouse chưa, và có
 * đúng không". Tab "Dữ liệu" đọc từ NGUỒN; bảng này đọc từ ĐÍCH. Chỉ khi so hai
 * cái cạnh nhau mới thấy được những lỗi im lặng: ngày lệch múi giờ, một cột toàn
 * `NULL` vì ánh xạ sai, số bị làm tròn.
 *
 * Cột `_row_index` cố ý KHÔNG bị giấu: nó là cầu nối giữa một dòng ở đây và một
 * dòng trong bảng lỗi phía trên.
 */
function WarehouseRows({ datasetId }: { datasetId: number }): React.ReactElement {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_DATA_PAGE_SIZE);

  const { data, isPending, isError, error } = useWarehousePreview(
    datasetId,
    true,
    { page, pageSize },
  );

  // Số thứ tự chạy TIẾP qua các trang (21, 22, … ở trang 2) chứ không quay về 1.
  // Đánh lại từ 1 mỗi trang thì hai dòng khác nhau mang cùng một số, và người
  // đang đối chiếu với bảng lỗi ở trên sẽ tra nhầm dòng.
  const offset = (page - 1) * pageSize;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {isPending && <TableSkeleton rows={4} />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.total === 0 && (
          <EmptyState
            title="Bảng trong kho đang trống"
            hint="Lần nạp báo thành công nhưng không ghi được dòng nào — kiểm tra lại nguồn dữ liệu."
          />
        )}

        {data && data.total > 0 && (
          <>
            <div className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white">
              {/* `w-max` chứ không `w-full` — cùng lý do với bảng ở tab "Dữ liệu":
                  ép 25 cột vừa bề ngang thì mọi giá trị đều bị cắt. */}
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold tracking-wide text-slate-400 uppercase"
                    >
                      #
                    </th>
                    {data.columns.map((name) => (
                      <th
                        key={name}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase"
                      >
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((row, index) => (
                    <tr key={offset + index} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                        {(offset + index + 1).toLocaleString('vi-VN')}
                      </td>
                      {row.map((value, cell) => (
                        <td key={data.columns[cell] ?? cell} className="px-4 py-2.5 text-slate-700">
                          {value === null ? (
                            // `NULL` khác chuỗi rỗng, và ở đây khác biệt đó quan
                            // trọng gấp đôi: một cột toàn NULL chính là dấu hiệu
                            // của ánh xạ kiểu sai.
                            <span className="text-xs italic text-slate-300">NULL</span>
                          ) : (
                            <span
                              className={`block max-w-xs truncate ${
                                typeof value === 'number' ? 'tabular-nums' : ''
                              }`}
                              title={String(value)}
                            >
                              {String(value)}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="shrink-0">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
                pageSizeOptions={DATA_PAGE_SIZES}
                // Về trang 1 khi đổi cỡ trang: đang ở trang 40 của cỡ 20 rồi
                // chuyển sang cỡ 100 thì trang 40 có thể vượt quá tổng số trang,
                // và người dùng nhận được một bảng rỗng thay vì dữ liệu.
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                unit="dòng"
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
