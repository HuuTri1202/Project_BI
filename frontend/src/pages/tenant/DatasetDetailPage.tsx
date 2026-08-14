import {
  CONNECTION_KIND_LABELS,
  DATA_PAGE_SIZES,
  DATASET_SOURCE_LABELS,
  type DatasetCellValue,
  type DatasetColumnDto,
} from '@bi/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { LoadPanel } from '../../features/tenant/datasets/LoadPanel';
import { RenameDatasetModal } from '../../features/tenant/datasets/RenameDatasetModal';
import {
  useDataset,
  useDatasetPreview,
  useDeleteDataset,
  useWarehouseSchema,
} from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

const LIST_PATH = '/datasets';

type Tab = 'data' | 'schema' | 'load';

const TABS: { id: Tab; label: string }[] = [
  { id: 'data', label: 'Dữ liệu' },
  { id: 'schema', label: 'Cấu trúc' },
  // Đứng CUỐI vì nó là việc người ta làm SAU khi đã xem dữ liệu và thấy nó đúng.
  { id: 'load', label: 'Kho phân tích' },
];

/**
 * Chi tiết một tập dữ liệu — §8.9.
 *
 * ─── Vì sao là TRANG, không phải hộp thoại ──────────────────────────────────
 *
 * Bản đầu dựng trong `Modal` và đó là lựa chọn sai với đúng loại nội dung này.
 * Hộp thoại rộng 32rem, nên bảng bốn cột bị bóp tới mức cột "Kiểu dữ liệu" cắt
 * cụt giữa chừng — `varchar(255)` hiện thành `varcha`, tức là thông tin quan
 * trọng nhất của một trang xem schema thì đọc không ra. Danh sách cột lại phải
 * cuộn trong một khung cao 24rem, nên bảng 14 cột đã thấy thanh cuộn, mà bảng
 * thật thường có 40–80 cột.
 *
 * Là trang thì bảng chiếm hết bề ngang, cuộn bằng chính thanh cuộn của trang,
 * và có URL riêng để gửi cho đồng nghiệp.
 *
 * ─── Hai tab, và vì sao "Dữ liệu" đứng trước ────────────────────────────────
 *
 * Danh sách cột chỉ có nghĩa sau khi đã thấy giá trị. `is_active tinyint(1)`
 * không nói được gì; nhìn thấy cột đó toàn 0 và 1 thì hiểu ngay. Nên tab mặc
 * định là "Dữ liệu", còn "Cấu trúc" là thứ người ta mở khi đã có câu hỏi cụ thể.
 *
 * ─── Tab ở đây là STATE, khác thanh tab của Quản lý tổ chức ─────────────────
 *
 * Bên kia tab phải là route thật vì mỗi tab mang bộ lọc riêng trong query string
 * và chúng ghi đè nhau. Ở đây không tab nào sở hữu tham số URL nào — ô tìm cột
 * là bộ lọc phía client trên dữ liệu đã tải sẵn — nên một `useState` là đủ và
 * không dựng thêm hai đường dẫn để bảo trì.
 */
export default function DatasetDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const permissions = usePermissions();

  // `Number('abc')` ra NaN, và `useDataset(null)` thì query không chạy — nên id
  // gõ sai trong URL sẽ kẹt ở `isPending` mãi mãi và người dùng nhìn khung xám
  // nhấp nháy không bao giờ dừng. Tách hẳn nhánh này ra để nó nói thật.
  const datasetId = Number(id);
  const validId = Number.isInteger(datasetId) && datasetId > 0 ? datasetId : null;

  const { data, isPending, isError, error } = useDataset(validId);

  const [tab, setTab] = useState<Tab>('data');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useDeleteDataset();

  // Thông tin phụ gộp thành MỘT dòng thay vì dải bốn thẻ. Dải cũ chiếm gần 110px
  // ở đầu trang để nói bốn con số mà người dùng liếc một lần rồi thôi — trong khi
  // thứ họ vào đây để xem là bảng dữ liệu, và nó bị đẩy xuống dưới màn hình.
  const meta =
    data === undefined
      ? []
      : [
          DATASET_SOURCE_LABELS[data.source],
          data.source === 'connection'
            ? `${data.sourceSchema}.${data.sourceTable}`
            : (data.originalFilename ?? ''),
          data.source === 'file' && data.sheetName !== null ? `sheet “${data.sheetName}”` : '',
          data.source === 'connection' && data.connectionKind
            ? CONNECTION_KIND_LABELS[data.connectionKind]
            : '',
          `${data.columnCount} cột`,
          data.source === 'file'
            ? `${data.rowCount.toLocaleString('vi-VN')} dòng${data.truncated ? ' (đã cắt bớt)' : ''}`
            : data.syncedAt
              ? `đồng bộ ${new Date(data.syncedAt).toLocaleDateString('vi-VN')}`
              : '',
        ].filter((s) => s !== '');

  return (
    <Page>
      <PageHeader
        title={
          <>
            <Link to={LIST_PATH} className="font-normal text-brand-700 hover:underline">
              Kho dữ liệu
            </Link>
            <span aria-hidden="true" className="mx-2 font-normal text-slate-300">
              /
            </span>
            {data?.name ?? '…'}
          </>
        }
        description={meta.length > 0 ? meta.join(' · ') : undefined}
        actions={
          data && (
            <>
              {permissions.can('dataset', 'modify') && (
                <Button onClick={() => setRenaming(true)}>Đổi tên</Button>
              )}
              {permissions.can('dataset', 'delete') && (
                <Button onClick={() => setDeleting(true)}>
                  <span className="text-red-600">Xoá</span>
                </Button>
              )}
            </>
          )
        }
      >
        {data && (
          <nav className="mt-4 flex gap-1 border-b border-slate-200" aria-label="Nội dung">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </PageHeader>

      <PageBody scroll={false}>
        {validId === null && (
          <ErrorState message="Địa chỉ không hợp lệ — không có tập dữ liệu nào ứng với đường dẫn này." />
        )}
        {validId !== null && isError && <ErrorState message={getApiError(error).message} />}
        {validId !== null && isPending && !isError && <TableSkeleton rows={6} />}

        {data && (
          <>
            {tab === 'data' && <PreviewTab datasetId={data.id} />}

            {/* Tách component để `useDatasetLoad` — hook duy nhất có polling —
                chỉ chạy khi tab này mở. Gọi ở cha thì mọi người mở trang chi tiết
                đều khởi động một vòng hỏi lại mỗi 2 giây. */}
            {tab === 'load' && <LoadPanel datasetId={data.id} source={data.source} />}

            {tab === 'schema' && (
              <SchemaTab
                datasetId={data.id}
                loaded={data.loadStatus === 'loaded'}
                sourceColumns={data.columns}
              />
            )}

            <RenameDatasetModal dataset={renaming ? data : null} onClose={() => setRenaming(false)} />

            <ConfirmDialog
              open={deleting}
              onClose={() => setDeleting(false)}
              title="Xoá tập dữ liệu"
              description={data.name}
              confirmLabel="Xoá"
              danger
              loading={remove.isPending}
              onConfirm={(onError) => {
                remove.mutate(data.id, {
                  // Về lại danh sách chứ không đứng lại trang này: thứ trang đang
                  // mô tả vừa biến mất, nên ở lại chỉ còn một khung lỗi.
                  onSuccess: () => void navigate(LIST_PATH),
                  onError,
                });
              }}
            >
              Tập dữ liệu bị gỡ khỏi kho.{' '}
              <strong>Dữ liệu trong CSDL nguồn không bị đụng tới</strong>.
            </ConfirmDialog>
          </>
        )}
      </PageBody>
    </Page>
  );
}

/**
 * Tab "Cấu trúc" — kiểu cột như chúng THẬT SỰ nằm trong kho phân tích.
 *
 * ─── Vì sao đọc kho chứ không đọc cấu trúc nguồn ────────────────────────────
 *
 * Cấu trúc nguồn (`dataset_columns`) trả lời "file/bảng gốc trông thế nào". Đó
 * là câu hỏi của lúc nhập dữ liệu, và nó đã được trả lời ở bước chốt cột.
 *
 * Từ đây trở đi mọi thứ dựng trên KHO: báo cáo tổng hợp bằng SQL trên `raw_*`,
 * và §10 sẽ sinh mô hình Cube từ đúng những cột đó. Nên câu hỏi có giá trị là
 * "cột này nằm trong kho dưới dạng gì" — `Nullable(DateTime64(3, 'UTC'))` chứ
 * không phải `date`. Suy diễn từ kiểu nguồn thì có thể lệch mà không ai biết,
 * đúng như lỗi cột ngày Excel: giao diện hiện `date` trong khi kho chứa `NULL`.
 *
 * Chưa nạp thì rơi về cấu trúc nguồn — nói rõ đang xem cái nào. Để trống một
 * tab chỉ vì chưa nạp là lấy mất thông tin duy nhất đang có.
 */
function SchemaTab({
  datasetId,
  loaded,
  sourceColumns,
}: {
  datasetId: number;
  loaded: boolean;
  sourceColumns: DatasetColumnDto[];
}): React.ReactElement {
  const [filter, setFilter] = useState('');
  const { data, isPending, isError, error } = useWarehouseSchema(datasetId, loaded);

  // Quy về MỘT hình dạng để bảng bên dưới chỉ có một nhánh vẽ. Hai nhánh JSX gần
  // giống nhau là chỗ để một sửa đổi chỉ được áp vào một nửa.
  const fromWarehouse = loaded && data !== undefined;
  const rows: SchemaRow[] = fromWarehouse
    ? data.columns.map((c) => ({
        ordinal: c.ordinal,
        name: c.name,
        type: c.type,
        nullable: c.nullable,
      }))
    : sourceColumns.map((c) => ({
        ordinal: c.ordinal,
        name: c.name,
        type: c.dataType,
        nullable: c.isNullable,
      }));

  const term = filter.trim().toLowerCase();
  const shown = rows.filter(
    (r) => term === '' || r.name.toLowerCase().includes(term) || r.type.toLowerCase().includes(term),
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {term === ''
            ? `${rows.length} cột`
            : `${shown.length} / ${rows.length} cột khớp “${filter.trim()}”`}
          {fromWarehouse ? (
            <>
              {' · '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {data.table}
              </code>
            </>
          ) : (
            ' · chưa nạp vào kho, đang hiện kiểu của nguồn'
          )}
        </p>

        {/* Lọc phía client, không debounce: dữ liệu đã nằm sẵn trong bộ
            nhớ nên chờ 300ms rồi mới lọc chỉ làm ô gõ có cảm giác trễ. */}
        <div className="min-w-[16rem]">
          <label htmlFor="column-filter" className="sr-only">
            Tìm cột
          </label>
          <input
            id="column-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Tìm cột…"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition-colors outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      {/* Không nuốt lỗi: kho tắt thì bảng dưới đang hiện cấu trúc NGUỒN, và
          người dùng phải biết vì sao nó không phải cái họ vừa yêu cầu. */}
      {isError && (
        <div className="mt-3 shrink-0">
          <ErrorState message={getApiError(error).message} />
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {loaded && isPending && <TableSkeleton rows={6} />}

        {!(loaded && isPending) &&
          (shown.length === 0 ? (
            <EmptyState
              title="Không có cột nào khớp"
              hint="Thử một từ khoá khác, hoặc xoá ô tìm kiếm để xem lại toàn bộ."
              action={<Button onClick={() => setFilter('')}>Xoá tìm kiếm</Button>}
            />
          ) : (
            <TableWrap fill>
              <THead>
                <Tr>
                  <Th>#</Th>
                  <Th>Tên cột</Th>
                  <Th>Kiểu dữ liệu</Th>
                  <Th>Cho phép rỗng</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map((row) => (
                  <ColumnRow key={row.name} row={row} />
                ))}
              </TBody>
            </TableWrap>
          ))}
      </div>
    </section>
  );
}

/**
 * Tab "Dữ liệu" — vài dòng đầu, đọc TRỰC TIẾP từ CSDL nguồn.
 *
 * Tách thành component riêng để `useDatasetPreview` chỉ chạy khi tab này được
 * mở. Gọi ở component cha thì mỗi lần vào trang là một câu SELECT trên máy chủ
 * của khách hàng, kể cả khi người dùng chỉ muốn xem danh sách cột.
 */
function PreviewTab({ datasetId }: { datasetId: number }): React.ReactElement {
  const { data, isPending, isError, error, isFetching, refetch } = useDatasetPreview(datasetId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DATA_PAGE_SIZES[0]);

  // Phân trang phía CLIENT, khác hẳn bảng ở tab "Kho phân tích".
  //
  // Ở đây không có gì để phân trang phía máy chủ: mỗi lần gọi là một câu SELECT
  // bắn sang CSDL của khách hàng, nên "trang 2" nghĩa là làm phiền máy chủ của
  // họ thêm một lần cho cùng một ảnh chụp. Ảnh chụp đó đã nằm sẵn trong bộ nhớ
  // trình duyệt — cắt trang tại chỗ là đủ, và nó giải quyết đúng vấn đề: không
  // phải cuộn qua hàng trăm dòng rồi mất hàng tiêu đề.
  const total = data?.rows.length ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  // Kẹp lại thay vì tin `page`: đổi cỡ trang có thể đẩy trang hiện tại ra ngoài
  // phạm vi, và một bảng rỗng ở giữa dữ liệu trông y như lỗi.
  const current = Math.min(page, Math.max(1, totalPages));
  const offset = (current - 1) * pageSize;
  const rows = (data?.rows ?? []).slice(offset, offset + pageSize);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        {/* Nói rõ đây là ảnh chụp, không phải toàn bộ bảng — nếu không, người
            dùng thấy bảng có dòng sẽ tưởng hệ thống đã giữ hết dữ liệu. */}
        <p className="text-sm text-slate-500">
          {data ? `Ảnh chụp ${data.rows.length} dòng đầu từ nguồn` : 'Đọc trực tiếp từ nguồn'}
          {data && data.rows.length === data.limit && ' · nguồn còn nhiều dòng hơn'}
        </p>
        <Button onClick={() => void refetch()} loading={isFetching}>
          Tải lại
        </Button>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {isPending && <TableSkeleton rows={6} />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.rows.length === 0 && (
          <EmptyState
            title="Bảng nguồn đang trống"
            hint="Kết nối và quyền đọc đều bình thường — bảng này chưa có dòng nào."
          />
        )}

        {data && data.rows.length > 0 && (
          <>
            <div className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white">
              {/* `w-max` chứ không `w-full`: bảng 20 cột mà ép vừa bề ngang thì
                  mỗi cột còn vài chục pixel và mọi giá trị đều bị cắt. Cho cột
                  rộng theo nội dung rồi cuộn ngang — đúng cách mọi công cụ xem
                  bảng đều làm. */}
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
                  {rows.map((row, index) => (
                    // Chỉ số dòng làm key: bảng nguồn không đảm bảo có khoá
                    // chính, và danh sách này chỉ đọc, không sắp xếp lại, không
                    // thêm bớt phần tử — nên chỉ số là định danh ổn định ở đây.
                    <tr key={offset + index} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                        {offset + index + 1}
                      </td>
                      {row.map((value, cell) => (
                        <Cell key={data.columns[cell] ?? cell} value={value} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="shrink-0">
              <Pagination
                page={current}
                pageSize={pageSize}
                total={total}
                totalPages={totalPages}
                onPageChange={setPage}
                pageSizeOptions={DATA_PAGE_SIZES}
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

/**
 * Một ô dữ liệu.
 *
 * `NULL` hiện thành chữ mờ nghiêng thay vì ô trống, vì hai thứ đó KHÁC nhau:
 * chuỗi rỗng là một giá trị, `NULL` là không có giá trị. Để cả hai cùng trông
 * như ô trống là xoá mất một khác biệt mà người dựng mô hình dữ liệu cần thấy.
 */
function Cell({ value }: { value: DatasetCellValue }): React.ReactElement {
  if (value === null) {
    return (
      <td className="px-4 py-2.5">
        <span className="text-xs italic text-slate-300">NULL</span>
      </td>
    );
  }

  const text = String(value);

  return (
    <td className="px-4 py-2.5 text-slate-700">
      {/* `title` để giá trị dài vẫn đọc được đầy đủ khi rê chuột, còn ô thì
          không kéo cột rộng ra vô hạn. */}
      <span
        className={`block max-w-xs truncate ${typeof value === 'number' ? 'tabular-nums' : ''}`}
        title={text}
      >
        {text}
      </span>
    </td>
  );
}

/** Một dòng cấu trúc, đã quy về cùng hình dạng dù đến từ kho hay từ nguồn. */
interface SchemaRow {
  ordinal: number;
  name: string;
  type: string;
  nullable: boolean;
}

function ColumnRow({ row }: { row: SchemaRow }): React.ReactElement {
  return (
    <Tr>
      {/* Số thứ tự lấy từ bảng thật, không phải chỉ số mảng: nó là thông tin
          thật về bảng bên kia, và khi đang lọc thì chỉ số mảng còn nói sai. */}
      <Td>
        <span className="text-slate-400">{row.ordinal}</span>
      </Td>
      <Td>
        <span className="font-medium text-slate-900">{row.name}</span>
      </Td>
      <Td>
        {/* `whitespace-nowrap` chứ không để tự xuống dòng: `decimal(10,2)` bị
            ngắt giữa dấu phẩy sẽ đọc ra hai kiểu khác nhau. */}
        <code className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          {row.type}
        </code>
      </Td>
      <Td>
        {row.nullable ? <Badge tone="neutral">NULL</Badge> : <Badge tone="brand">NOT NULL</Badge>}
      </Td>
    </Tr>
  );
}
