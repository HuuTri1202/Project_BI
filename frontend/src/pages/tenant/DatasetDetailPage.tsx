import {
  CONNECTION_KIND_LABELS,
  type DatasetCellValue,
  type DatasetColumnDto,
} from '@bi/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { RenameDatasetModal } from '../../features/tenant/datasets/RenameDatasetModal';
import {
  useDataset,
  useDatasetPreview,
  useDeleteDataset,
} from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

const LIST_PATH = '/datasets';

type Tab = 'data' | 'schema';

const TABS: { id: Tab; label: string }[] = [
  { id: 'data', label: 'Dữ liệu' },
  { id: 'schema', label: 'Cấu trúc' },
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
  const [filter, setFilter] = useState('');

  const remove = useDeleteDataset();

  const term = filter.trim().toLowerCase();
  const columns = (data?.columns ?? []).filter(
    (c) =>
      term === '' ||
      c.name.toLowerCase().includes(term) ||
      c.dataType.toLowerCase().includes(term),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Đường dẫn" className="text-sm">
        <Link to={LIST_PATH} className="text-brand-700 hover:underline">
          Kho dữ liệu
        </Link>
        <span aria-hidden="true" className="mx-2 text-slate-300">
          /
        </span>
        <span className="text-slate-500">{data?.name ?? '…'}</span>
      </nav>

      {validId === null && (
        <div className="mt-4">
          <ErrorState message="Địa chỉ không hợp lệ — không có tập dữ liệu nào ứng với đường dẫn này." />
        </div>
      )}

      {validId !== null && isError && (
        <div className="mt-4">
          <ErrorState message={getApiError(error).message} />
        </div>
      )}

      {validId !== null && isPending && !isError && (
        <div className="mt-6">
          <TableSkeleton rows={6} />
        </div>
      )}

      {data && (
        <>
          <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{data.name}</h1>
              <p className="mt-1 text-sm text-slate-500">
                Ảnh chụp cấu trúc của bảng{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {data.sourceSchema}.{data.sourceTable}
                </code>
                . Dữ liệu vẫn nằm nguyên trong CSDL nguồn.
              </p>
            </div>

            <div className="flex gap-2">
              {permissions.can('dataset', 'modify') && (
                <Button onClick={() => setRenaming(true)}>Đổi tên</Button>
              )}
              {permissions.can('dataset', 'delete') && (
                <Button onClick={() => setDeleting(true)}>
                  <span className="text-red-600">Xoá</span>
                </Button>
              )}
            </div>
          </header>

          <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Kết nối">
              <span className="text-slate-800">{data.connectionName}</span>
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                {CONNECTION_KIND_LABELS[data.connectionKind]}
              </span>
            </Fact>
            <Fact label="Bảng nguồn">
              <code className="text-sm text-slate-800">
                {data.sourceSchema}.{data.sourceTable}
              </code>
            </Fact>
            <Fact label="Số cột">{data.columnCount}</Fact>
            <Fact label="Đồng bộ lần cuối">
              {data.syncedAt ? new Date(data.syncedAt).toLocaleString('vi-VN') : '—'}
            </Fact>
          </dl>

          <nav className="mt-7 flex gap-1 border-b border-slate-200" aria-label="Nội dung">
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

          {tab === 'data' && <PreviewTab datasetId={data.id} />}

          {tab === 'schema' && (
            <section className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Cấu trúc bảng</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {term === ''
                      ? `${data.columns.length} cột, theo đúng thứ tự trong CSDL nguồn.`
                      : `${columns.length} / ${data.columns.length} cột khớp “${filter.trim()}”.`}
                  </p>
                </div>

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
                    placeholder="Tìm theo tên cột hoặc kiểu dữ liệu…"
                    className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm transition-colors outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  />
                </div>
              </div>

              <div className="mt-4">
                {columns.length === 0 ? (
                  <EmptyState
                    title="Không có cột nào khớp"
                    hint="Thử một từ khoá khác, hoặc xoá ô tìm kiếm để xem lại toàn bộ."
                    action={<Button onClick={() => setFilter('')}>Xoá tìm kiếm</Button>}
                  />
                ) : (
                  <TableWrap>
                    <THead>
                      <Tr>
                        <Th>#</Th>
                        <Th>Tên cột</Th>
                        <Th>Kiểu dữ liệu</Th>
                        <Th>Cho phép rỗng</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {columns.map((column) => (
                        <ColumnRow key={column.name} column={column} />
                      ))}
                    </TBody>
                  </TableWrap>
                )}
              </div>
            </section>
          )}

          <RenameDatasetModal
            dataset={renaming ? data : null}
            onClose={() => setRenaming(false)}
          />

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
            <strong>Dữ liệu trong CSDL nguồn không bị đụng tới</strong> — đồng bộ lại bảng{' '}
            <code className="text-xs">{data.sourceTable}</code> sẽ đưa nó trở lại đúng như cũ.
          </ConfirmDialog>
        </>
      )}
    </div>
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

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Dữ liệu</h2>
          {/* Câu này quan trọng hơn vẻ ngoài của nó. Người dùng nhìn một bảng có
              dòng sẽ mặc định là hệ thống đã giữ dữ liệu; nói rõ ngay đây rằng
              đó là ảnh chụp tức thời và bảng thật còn dài hơn. */}
          <p className="mt-0.5 text-sm text-slate-500">
            {data
              ? `${data.rows.length} dòng đầu, đọc trực tiếp từ CSDL nguồn lúc mở trang. Hệ thống không giữ bản sao nào.`
              : 'Đọc trực tiếp từ CSDL nguồn — hệ thống không giữ bản sao nào.'}
          </p>
        </div>
        <Button onClick={() => void refetch()} loading={isFetching}>
          Tải lại
        </Button>
      </div>

      <div className="mt-4">
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
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              {/* `w-max` chứ không `w-full`: bảng 20 cột mà ép vừa bề ngang thì
                  mỗi cột còn vài chục pixel và mọi giá trị đều bị cắt. Cho cột
                  rộng theo nội dung rồi cuộn ngang — đúng cách mọi công cụ xem
                  bảng đều làm. */}
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
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
                    // Chỉ số dòng làm key: bảng nguồn không đảm bảo có khoá
                    // chính, và danh sách này chỉ đọc, không sắp xếp lại, không
                    // thêm bớt phần tử — nên chỉ số là định danh ổn định ở đây.
                    <tr key={index} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                        {index + 1}
                      </td>
                      {row.map((value, cell) => (
                        <Cell key={data.columns[cell] ?? cell} value={value} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.rows.length === data.limit && (
              <p className="mt-3 text-sm text-slate-500">
                Chỉ hiện {data.limit} dòng đầu. Bảng nguồn có thể còn nhiều hơn — nền tảng này
                không tải toàn bộ dữ liệu về.
              </p>
            )}
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

/** Một ô trong dải thông tin tóm tắt. */
function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}

function ColumnRow({ column }: { column: DatasetColumnDto }): React.ReactElement {
  return (
    <Tr>
      {/* Số thứ tự lấy từ CSDL nguồn, không phải chỉ số mảng: nó là thông tin
          thật về bảng bên kia, và khi đang lọc thì chỉ số mảng còn nói sai. */}
      <Td>
        <span className="text-slate-400">{column.ordinal}</span>
      </Td>
      <Td>
        <span className="font-medium text-slate-900">{column.name}</span>
      </Td>
      <Td>
        {/* `whitespace-nowrap` chứ không để tự xuống dòng: `decimal(10,2)` bị
            ngắt giữa dấu phẩy sẽ đọc ra hai kiểu khác nhau. */}
        <code className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          {column.dataType}
        </code>
      </Td>
      <Td>
        {column.isNullable ? (
          <Badge tone="neutral">NULL</Badge>
        ) : (
          <Badge tone="brand">NOT NULL</Badge>
        )}
      </Td>
    </Tr>
  );
}
