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
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import { UploadWizard } from '../../features/datasets/wizard/UploadWizard';
import type { DatasetListQuery } from '../../features/tenant/api';
import { LoadStatusBadge } from '../../features/tenant/datasets/LoadPanel';
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

  const [uploadOpen, setUploadOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  /**
   * Bộ dữ liệu đã tích, để dựng chung một mô hình.
   *
   * Giữ theo ID chứ không theo dòng đang hiện, nên lựa chọn SỐNG QUA việc đổi
   * trang, đổi bộ lọc và đổi cách sắp xếp. Đó là điều kiện để chọn được vài
   * bảng nằm rải rác: "đơn hàng" và "khách hàng" hiếm khi đứng cạnh nhau trong
   * một kho vài chục bộ dữ liệu, và bắt người dùng tìm ra cả hai trong cùng một
   * màn hình là bắt họ bỏ bộ lọc vừa dùng để tìm ra cái thứ nhất.
   */
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [taoMoHinh, setTaoMoHinh] = useState(false);
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

  /*
   * ─── Ai thấy được cột tích chọn ───────────────────────────────────────────
   *
   * Chỉ người tạo được mô hình. Viewer đọc được trang này, và một cột tích chọn
   * dẫn tới một nút mà backend trả 403 là một cái bẫy không có lý do tồn tại —
   * cùng lý lẽ với hai nút ở đầu trang.
   */
  const chonDuoc = permissions.can('datamodel', 'modify');

  /*
   * ─── Vì sao chỉ bộ ĐÃ NẠP mới tích được ───────────────────────────────────
   *
   * Mô hình dựng trên bảng `raw_*` trong ClickHouse, mà bảng đó chỉ có sau khi
   * bộ dữ liệu được nạp (§9). Chặn ngay ở ô tích thì lỗi không bao giờ tồn tại;
   * cho tích rồi để hộp thoại từ chối là dời lỗi đi hai màn hình.
   */
  const dongTich = (data?.items ?? []).filter((d) => d.loadStatus === 'loaded');
  const tichHet = dongTich.length > 0 && dongTich.every((d) => chon.has(d.id));

  function doiTich(id: number): void {
    const next = new Set(chon);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChon(next);
  }

  /** Tích/bỏ tích mọi dòng nạp xong CỦA TRANG NÀY, không đụng lựa chọn ở trang khác. */
  function doiTichHet(): void {
    const next = new Set(chon);
    for (const d of dongTich) {
      if (tichHet) next.delete(d.id);
      else next.add(d.id);
    }
    setChon(next);
  }

  /** Mở hộp thoại với đúng một bộ dữ liệu — đường tắt từ ô "Mô hình dữ liệu". */
  function taoTuMot(id: number): void {
    setChon(new Set([id]));
    setTaoMoHinh(true);
  }

  return (
    <Page>
      <PageHeader
        title="Kho dữ liệu"
        description="Mọi bộ dữ liệu dựng báo cáo được."
        actions={
          /* Ẩn nút với viewer. Backend cũng chặn bằng 403, nhưng để nút bấm được
             rồi mới báo lỗi là bày ra một cái bẫy không có lý do gì để tồn tại. */
          permissions.can('dataset', 'modify') ? (
            /* Hai đường vào kho, đặt cạnh nhau vì đó đúng là hai lựa chọn người
               dùng đang cân nhắc: dữ liệu đang nằm trong một file, hay đang nằm
               trong một CSDL. Trước đây chỉ có nhánh CSDL ở đây, còn nhánh file
               nấp trong menu "Tạo báo cáo" ở trang chủ — tức là muốn thêm dữ
               liệu vào Kho dữ liệu thì phải rời Kho dữ liệu.

               "Tạo bộ dữ liệu" là nút chính: tải file lên là cách người dùng
               mới bắt đầu, còn đồng bộ CSDL cần có sẵn một kết nối đã khai. */
            <div className="flex gap-2">
              <Button onClick={() => setSyncOpen(true)}>Đồng bộ từ CSDL</Button>
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                + Tạo bộ dữ liệu
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="mt-4">
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
      </PageHeader>

      <PageBody scroll={false}>
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không có bộ dữ liệu nào khớp' : 'Kho dữ liệu đang trống'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá.'
                : 'Tải một file Excel/CSV lên, hoặc lấy bảng về từ một kết nối CSDL đã khai.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : permissions.can('dataset', 'modify') ? (
                <div className="flex justify-center gap-2">
                  <Button onClick={() => setSyncOpen(true)}>Đồng bộ từ CSDL</Button>
                  <Button variant="primary" onClick={() => setUploadOpen(true)}>
                    + Tạo bộ dữ liệu
                  </Button>
                </div>
              ) : undefined
            }
          />
        )}

        {data && data.items.length > 0 && (
          <div
            className={`flex min-h-0 flex-1 flex-col ${
              isPlaceholderData ? 'opacity-60 transition-opacity' : ''
            }`}
          >
            {/* Thanh thao tác chỉ hiện khi có thứ để thao tác. Nó nằm TRÊN
                bảng chứ không nổi ở đáy màn hình: bảng này tự cuộn trong khung,
                nên một thanh nổi sẽ che mất dòng cuối. */}
            {chonDuoc && chon.size > 0 && (
              <div
                aria-live="polite"
                className="mb-2 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-brand-900">
                  Đã chọn {chon.size} bộ dữ liệu
                </span>
                {/* Lựa chọn sống qua việc đổi trang và đổi bộ lọc, nên rất có
                    thể vài bộ trong số đó đang không nằm trên màn hình. Nói ra,
                    thay vì để người dùng đếm các ô tích và thấy thiếu. */}
                {chon.size > dongTich.filter((d) => chon.has(d.id)).length && (
                  <span className="text-xs text-brand-800">
                    (có bộ nằm ở trang hoặc bộ lọc khác)
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <Button onClick={() => setChon(new Set())}>Bỏ chọn</Button>
                  <Button variant="primary" onClick={() => setTaoMoHinh(true)}>
                    Tạo mô hình từ {chon.size} bộ dữ liệu
                  </Button>
                </div>
              </div>
            )}

            <TableWrap fill>
              <THead>
                <Tr>
                  {chonDuoc && (
                    <Th>
                      <input
                        type="checkbox"
                        checked={tichHet}
                        disabled={dongTich.length === 0}
                        onChange={doiTichHet}
                        aria-label="Chọn mọi bộ dữ liệu đã nạp trên trang này"
                        title="Chọn mọi bộ dữ liệu đã nạp trên trang này"
                        className="rounded border-slate-300"
                      />
                    </Th>
                  )}
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
                  <Th>Mô hình dữ liệu</Th>
                  <SortableTh sortKey="syncedAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Cập nhật lần cuối
                  </SortableTh>
                  {/* KHÔNG sắp xếp được: `load_status` là ENUM nên thứ tự sắp
                      xếp của nó là thứ tự khai báo, không phải thứ tự có nghĩa
                      với người đọc. Muốn lọc theo trạng thái nạp thì thêm một bộ
                      lọc thật, đừng mượn cột sắp xếp. */}
                  <Th>Kho phân tích</Th>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((dataset) => (
                  <Tr key={dataset.id}>
                    {chonDuoc && (
                      <Td>
                        <input
                          type="checkbox"
                          checked={chon.has(dataset.id)}
                          disabled={dataset.loadStatus !== 'loaded'}
                          onChange={() => doiTich(dataset.id)}
                          aria-label={`Chọn ${dataset.name}`}
                          // Nói LÝ DO ngay trên ô bị vô hiệu. Một ô tích mờ đi
                          // mà không giải thích là chỗ người dùng bấm mãi rồi
                          // kết luận là trang bị hỏng.
                          title={
                            dataset.loadStatus === 'loaded'
                              ? `Chọn ${dataset.name}`
                              : 'Chưa nạp vào kho phân tích nên chưa dựng mô hình lên được'
                          }
                          className="rounded border-slate-300 disabled:cursor-not-allowed"
                        />
                      </Td>
                    )}
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
                    {/* Ô này KHÔNG còn tự có mô hình. Hệ thống từng dựng một
                        cái ngay sau khi nạp xong; nay không nữa, vì "những bảng
                        nào đáng hỏi cùng nhau" là điều chỉ người dùng biết —
                        máy chỉ đoán được theo chuyện chúng đi chung một file.

                        Nên ô trống là trạng thái BÌNH THƯỜNG, và nó phải chỉ ra
                        việc cần làm thay vì chỉ báo thiếu. Ba trạng thái: chưa
                        nạp xong thì chưa dựng mô hình lên được, nạp rồi thì mời
                        đi tạo, và người xem thì chỉ thấy chữ. */}
                    <Td>
                      {dataset.datamodelId !== null ? (
                        <Link
                          to={`/datamodels/${dataset.datamodelId}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          Mở mô hình
                          {dataset.datamodelCount > 1 && (
                            <span className="ml-1 text-xs font-normal text-slate-500">
                              (+{dataset.datamodelCount - 1})
                            </span>
                          )}
                        </Link>
                      ) : dataset.loadStatus !== 'loaded' ? (
                        <span className="text-xs text-slate-400">chờ nạp xong</span>
                      ) : chonDuoc ? (
                        /* Trước đây đây là một liên kết sang `/datamodels`, và
                           nó bỏ người dùng lại ở một trang khác với lựa chọn
                           trống trơn — họ vừa chỉ vào đúng bộ dữ liệu mình
                           muốn, rồi phải đi tìm lại nó trong một danh sách thứ
                           hai. Giờ nó mở thẳng hộp thoại với đúng bộ đó đã
                           tích sẵn. */
                        <button
                          type="button"
                          onClick={() => taoTuMot(dataset.id)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Tạo mô hình
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">chưa có</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-500">
                        {dataset.syncedAt
                          ? new Date(dataset.syncedAt).toLocaleString('vi-VN')
                          : '—'}
                      </span>
                    </Td>
                    <Td>
                      <LoadStatusBadge status={dataset.loadStatus} />
                      {dataset.loadStatus === 'loaded' && (
                        <div className="mt-0.5 text-xs tabular-nums text-slate-500">
                          {dataset.loadedRowCount.toLocaleString('vi-VN')} dòng
                        </div>
                      )}
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

        <UploadWizard open={uploadOpen} onClose={() => setUploadOpen(false)} />
        {/* Dùng lại đúng hộp thoại của trang Mô hình dữ liệu, chỉ mồi sẵn lựa
            chọn. Dựng một biểu mẫu thứ hai ở đây sẽ phải chép lại cả bốn thứ nó
            đang lo: workspace đích, cảnh báo bộ chưa nạp, cảnh báo bộ đang nạp,
            và việc điều hướng vào mô hình vừa tạo. */}
        <CreateDataModelModal
          open={taoMoHinh}
          initialSelected={[...chon]}
          onClose={() => setTaoMoHinh(false)}
        />
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
            Bộ dữ liệu bị ẩn khỏi kho cùng toàn bộ dòng đã nhập. Còn báo cáo đang dùng nó
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
      </PageBody>
    </Page>
  );
}
