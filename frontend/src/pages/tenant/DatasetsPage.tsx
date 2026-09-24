import {
  CHUNG,
  CONNECTION_KIND_LABELS,
  DATASET_SOURCE_LABELS,
  DATASET_SOURCES,
  FOLDER_FILTER_CHUNG,
  folderFilterValue,
  parseFolderFilter,
  type DatasetDto,
  type FolderDto,
} from '@bi/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../components/ui/RowMenu';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import { UploadWizard } from '../../features/datasets/wizard/UploadWizard';
import { FolderDialog } from '../../features/folders/FolderDialog';
import { FolderRail } from '../../features/folders/FolderRail';
import { MoveToFolderDialog } from '../../features/folders/MoveToFolderDialog';
import type { DatasetListQuery } from '../../features/tenant/api';
import { LoadStatusBadge } from '../../features/tenant/datasets/LoadPanel';
import { RenameDatasetModal } from '../../features/tenant/datasets/RenameDatasetModal';
import { SyncTablesModal } from '../../features/tenant/datasets/SyncTablesModal';
import {
  useConnections,
  useCreateDatasetFolder,
  useDatasetFolders,
  useDatasets,
  useDeleteDataset,
  useDeleteDatasetFolder,
  useMoveDataset,
  useRenameDatasetFolder,
} from '../../features/tenant/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';

/**
 * Kho dữ liệu — §7.8 + §8.5, MỘT trang cho cả hai nguồn.
 *
 * Trang riêng ở sidebar chứ không phải một tab của Quản lý tổ chức: kho dữ liệu
 * là nơi làm việc HÀNG NGÀY của người phân tích, còn Quản lý tổ chức là nơi cấu
 * hình.
 *
 * ⚠️ Viewer KHÔNG đọc được trang này — `rbac.ts` cố ý không cấp `dataset:read`
 * cho họ (dòng chữ cũ ở đây nói ngược lại và đã sai từ migration 26). Nhắc ở
 * đây vì cột thư mục gác bằng đúng ô quyền đó: nới nó ra một nấc là để viewer
 * đọc được tên mọi thư mục dữ liệu của tổ chức qua một endpoint mà không màn
 * hình nào của họ gọi tới.
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
/*
 * Mặc định mở CHUNG, không phải "mọi thư mục".
 *
 * Cột thư mục bên trái không có dòng "tất cả" — mọi bộ dữ liệu đều nằm trong
 * đúng một chỗ đứng, Chung hoặc một thư mục, nên cộng mọi dòng lại đã là tất cả.
 * Để "không lọc gì" làm mặc định thì trang mở ra với cột bên trái không dòng nào
 * sáng, và người dùng không đọc được mình đang xem gì.
 *
 * `GET /datasets` vẫn hiểu "không truyền `folder`" là mọi thư mục; chỉ màn hình
 * này là không dùng tới nữa.
 */
const DEFAULTS: DatasetListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc',
  q: '',
  connectionId: '',
  source: '',
  folder: FOLDER_FILTER_CHUNG,
};

/** Danh từ của thứ đang được xếp — cột thư mục và hai hộp thoại đều dùng chung. */
const DANH_TU = 'bộ dữ liệu';

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
  const navigate = useNavigate();
  const { query, update } = useListQueryState<DatasetListQuery>({ ...DEFAULTS }, ALLOWED);

  const { data, isPending, isError, error, isPlaceholderData } = useDatasets({
    ...query,
    order: query.order as 'asc' | 'desc',
    source: query.source as DatasetListQuery['source'],
    connectionId: query.connectionId === '' ? '' : Number(query.connectionId),
  });
  const { data: connections } = useConnections();

  /* ─── Thư mục — §7.9 ───────────────────────────────────────────────────── */
  const folders = useDatasetFolders();
  const taoThuMuc = useCreateDatasetFolder();
  const doiTenThuMuc = useRenameDatasetFolder();
  const xoaThuMuc = useDeleteDatasetFolder();
  const chuyenThuMuc = useMoveDataset();

  /*
   * `?? null`: một `?folder=` gõ sai hay link cũ rơi về CHUNG, không rơi về
   * "mọi thư mục". Nhờ vậy cột bên trái luôn có đúng một dòng đang mở.
   */
  const dangMo = parseFolderFilter(query.folder) ?? null;
  const danhSachThuMuc = folders.data?.items ?? [];

  /** `undefined` = đóng; `null` = đang tạo mới; có giá trị = đang đổi tên. */
  const [suaThuMuc, setSuaThuMuc] = useState<FolderDto | null | undefined>(undefined);
  const [xoaThuMucNao, setXoaThuMucNao] = useState<FolderDto | null>(null);
  const [chuyenBo, setChuyenBo] = useState<DatasetDto | null>(null);

  /** Đổi thư mục là VỀ TRANG 1: trang 3 của thư mục cũ thường không tồn tại. */
  const chonThuMuc = (folderId: number | null): void => {
    update({ folder: folderFilterValue(folderId), page: 1 });
  };

  /*
   * "Xoá lọc" xoá BỘ LỌC, không xoá thư mục đang mở.
   *
   * `reset` của `useListQueryState` dọn sạch mọi tham số trên URL, kể cả
   * `folder` — nên dùng thẳng nó thì người đang đứng trong "Bán hàng" gõ một từ
   * khoá, không thấy gì, bấm "Xoá lọc", và bị ném sang chỗ khác. Thư mục là CHỖ
   * ĐỨNG chứ không phải một bộ lọc vừa gõ vào.
   */
  const xoaLoc = (): void => update({ q: '', connectionId: '', source: '', page: 1 });

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
          onReset={xoaLoc}
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
        {/* Cột thư mục và danh sách nằm CẠNH nhau, cùng một khung cuộn: cột bên
            trái ngắn và không cuộn riêng, nên hai thanh cuộn lồng nhau chỉ làm
            người dùng lăn chuột vào nhầm chỗ. */}
        <div className="flex min-h-0 flex-1 gap-4">
          <FolderRail
            danhTu={DANH_TU}
            folders={danhSachThuMuc}
            chungCount={folders.data?.chungCount ?? 0}
            dang={dangMo}
            onChon={chonThuMuc}
            canEdit={permissions.can('dataset', 'modify')}
            onThemMoi={() => setSuaThuMuc(null)}
            onDoiTen={setSuaThuMuc}
            onXoa={setXoaThuMucNao}
          />

          {/*
           * `min-w-0` — thiếu nó là cột này KHÔNG chịu co lại.
           *
           * Một flex item mặc định có `min-width: auto`, nghĩa là nó không hẹp
           * hơn bề rộng nội tại của nội dung. Bảng bên trong khai
           * `min-w-[52rem]`, nên cột này bám theo và đẩy mình rộng hơn cả hàng
           * flex. Đo được trên Kho dữ liệu: khung bảng thò ra 202px NGOÀI cửa
           * sổ, mà trang thì không cuộn ngang — nên hai cột cuối biến mất hẳn,
           * không có thanh cuộn nào để đi tới.
           *
           * Có `min-w-0` thì cột co đúng chỗ còn lại, và `overflow-auto` của
           * `TableWrap` mới có việc để làm: bảng chật thì CHÍNH NÓ cuộn ngang.
           */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-slate-200 pl-4">
            {isError && <ErrorState message={getApiError(error).message} />}
            {isPending && <TableSkeleton />}

            {data && data.items.length === 0 && (
              <EmptyState
                title={
                  hasFilter
                    ? 'Không có bộ dữ liệu nào khớp'
                    : `${tenThuMuc(dangMo, danhSachThuMuc)} chưa có bộ dữ liệu nào`
                }
                hint={
                  hasFilter
                    ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá.'
                    : dangMo === null
                      ? 'Bộ dữ liệu mới mặc định vào đây. Tải một file Excel/CSV lên, hoặc lấy bảng về từ một kết nối CSDL đã khai.'
                      : 'Tạo bộ dữ liệu mới ở đây, hoặc chuyển một bộ có sẵn vào bằng mục “Chuyển tới thư mục”.'
                }
                action={
                  hasFilter ? (
                    <Button onClick={xoaLoc}>Xoá lọc</Button>
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

                {/*
                 * Đệm ô hẹp hơn mặc định, và CHỈ ở bảng này.
                 *
                 * Mười cột × 32px đệm ngang là 320px — bằng ba cột dữ liệu. Bảng
                 * bốn cột ở những trang khác không có vấn đề đó, nên siết đệm
                 * trong `Td`/`Th` dùng chung là làm chật mọi bảng để cứu một cái.
                 * `TableWrap` vốn đã nhận `className`, nên không cần thêm API nào.
                 */}
                <TableWrap fill className="[&_td]:px-3 [&_th]:px-3">
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
                      {/*
                       * Nhãn NGẮN, và đây là chuyện chỗ chứ không phải thẩm mỹ.
                       *
                       * Từ khi tiêu đề không được xuống dòng nữa (xem `Th`),
                       * chính cái nhãn quyết định bề rộng tối thiểu của cột:
                       * "Số cột" chiếm 92px để hiện một con số một chữ số, "Mô
                       * hình dữ liệu" chiếm 138px cho một liên kết "Mở mô hình".
                       * Bốn nhãn dưới đây rút lại trả về khoảng 180px cho phần
                       * dữ liệu — mà không mất nghĩa nào: cột nằm ngay dưới
                       * tiêu đề đã nói rõ nó là gì.
                       */}
                      <SortableTh sortKey="columnCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                        Cột
                      </SortableTh>
                      <SortableTh sortKey="rowCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                        Dòng
                      </SortableTh>
                      <Th>Mô hình</Th>
                      <SortableTh sortKey="syncedAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                        Cập nhật
                      </SortableTh>
                      {/* KHÔNG sắp xếp được: `load_status` là ENUM nên thứ tự sắp
                          xếp của nó là thứ tự khai báo, không phải thứ tự có nghĩa
                          với người đọc. Muốn lọc theo trạng thái nạp thì thêm một bộ
                          lọc thật, đừng mượn cột sắp xếp. */}
                      <Th>Kho phân tích</Th>
                      {/* Nhãn CHỈ CHO trình đọc màn hình: cột này chỉ chứa một
                          nút "⋮" rộng 28px, nhưng chữ "THAO TÁC" bắt nó rộng
                          91px — và ở một bảng đang thiếu chỗ thì đó là 40px lấy
                          của cột khác. Bỏ hẳn nhãn thì người dùng trình đọc màn
                          hình nghe một cột không tên. */}
                      <Th align="right">
                        <span className="sr-only">Thao tác</span>
                      </Th>
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
                          {/* Thư mục in ngay dưới tên, KHÔNG thành một cột riêng:
                              bảng đã có chín cột, và câu hỏi "nó nằm ở đâu" chỉ đáng
                              một dòng nhạt. Hiện cả khi đang mở đúng thư mục đó —
                              bỏ đi thì dòng chữ nhảy ra nhảy vào theo bộ lọc. */}
                          <div className="mt-0.5 text-xs text-slate-400">
                            {dataset.folderName ?? CHUNG}
                          </div>
                          {dataset.status === 'failed' && (
                            <div className="mt-0.5 text-xs text-red-600">
                              {dataset.errorMessage ?? 'Nhập không thành công'}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap text-slate-700">
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
                          {/* Ngày trên, giờ dưới — cùng khuôn "chính + phụ" với
                              các ô khác trong bảng. Một dòng thì chuỗi
                              "11:52:38 15/9/2026" tự mình đòi 120px, và ở một
                              bảng mười cột thì đó là chỗ của một cột khác. */}
                          {dataset.syncedAt === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              <span className="whitespace-nowrap text-slate-600 tabular-nums">
                                {new Date(dataset.syncedAt).toLocaleDateString('vi-VN')}
                              </span>
                              <div className="text-xs whitespace-nowrap text-slate-400 tabular-nums">
                                {new Date(dataset.syncedAt).toLocaleTimeString('vi-VN')}
                              </div>
                            </>
                          )}
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
                            {/*
                             * Menu "⋮", KHÔNG phải bốn nút bày ngang — cùng khuôn
                             * với tab Báo cáo.
                             *
                             * Bốn nút thường trực ngốn ~250px của một khung chỉ
                             * còn 1046px sau khi cột thư mục nhận 260px, và ô
                             * thao tác bị ép gãy thành BẢY dòng, kéo cả hàng cao
                             * 97px. Đo được trước khi đổi; xem `Th` về phần tiêu
                             * đề gãy bốn dòng của cùng một nguyên nhân.
                             */}
                            <RowMenu label={`Thao tác trên ${dataset.name}`}>
                              {(close) => (
                                <>
                                  <RowMenuItem
                                    icon={ROW_MENU_ICONS.open}
                                    onClick={() => {
                                      close();
                                      void navigate(`/datasets/${String(dataset.id)}`);
                                    }}
                                  >
                                    Xem cột
                                  </RowMenuItem>
                                  {permissions.can('dataset', 'modify') && (
                                    <RowMenuItem
                                      icon={ROW_MENU_ICONS.edit}
                                      onClick={() => {
                                        close();
                                        setRenaming(dataset);
                                      }}
                                    >
                                      Đổi tên
                                    </RowMenuItem>
                                  )}
                                  {/* Gác bằng `modify`, không phải `delete`:
                                      chuyển thư mục không làm mất gì — cùng luật
                                      với route `PATCH /datasets/:id/folder`. */}
                                  {permissions.can('dataset', 'modify') && (
                                    <RowMenuItem
                                      icon={ROW_MENU_ICONS.folder}
                                      onClick={() => {
                                        close();
                                        setChuyenBo(dataset);
                                      }}
                                    >
                                      Chuyển tới thư mục
                                    </RowMenuItem>
                                  )}
                                  {permissions.can('dataset', 'delete') && (
                                    <RowMenuItem
                                      icon={ROW_MENU_ICONS.trash}
                                      danger
                                      onClick={() => {
                                        close();
                                        setDeleting(dataset);
                                      }}
                                    >
                                      Xoá bộ dữ liệu
                                    </RowMenuItem>
                                  )}
                                </>
                              )}
                            </RowMenu>
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
          </div>
        </div>

        {/* Bộ dữ liệu mới rơi vào thư mục ĐANG MỞ — cả hai đường vào kho đều
            nhận `folderId`, nên người dùng không phải xếp lại ngay sau khi tạo. */}
        <UploadWizard open={uploadOpen} folderId={dangMo} onClose={() => setUploadOpen(false)} />
        {/* Dùng lại đúng hộp thoại của trang Mô hình dữ liệu, chỉ mồi sẵn lựa
            chọn. Dựng một biểu mẫu thứ hai ở đây sẽ phải chép lại cả bốn thứ nó
            đang lo: workspace đích, cảnh báo bộ chưa nạp, cảnh báo bộ đang nạp,
            và việc điều hướng vào mô hình vừa tạo. */}
        <CreateDataModelModal
          open={taoMoHinh}
          initialSelected={[...chon]}
          onClose={() => setTaoMoHinh(false)}
        />
        <SyncTablesModal open={syncOpen} folderId={dangMo} onClose={() => setSyncOpen(false)} />
        <RenameDatasetModal dataset={renaming} onClose={() => setRenaming(null)} />

        <FolderDialog
          danhTu={DANH_TU}
          open={suaThuMuc !== undefined}
          folder={suaThuMuc ?? null}
          onClose={() => setSuaThuMuc(undefined)}
          loading={taoThuMuc.isPending || doiTenThuMuc.isPending}
          onSubmit={async (name) => {
            if (suaThuMuc == null) {
              const moi = await taoThuMuc.mutateAsync(name);
              // Mở luôn thư mục vừa tạo: người vừa gõ một cái tên đang muốn bỏ
              // thứ gì đó vào nó, không phải quay lại danh sách cũ.
              chonThuMuc(moi.id);
              return;
            }
            await doiTenThuMuc.mutateAsync({ id: suaThuMuc.id, name });
          }}
        />

        <MoveToFolderDialog
          muc={chuyenBo}
          folders={danhSachThuMuc}
          onClose={() => setChuyenBo(null)}
          loading={chuyenThuMuc.isPending}
          onMove={async (folderId) => {
            if (chuyenBo === null) return;
            await chuyenThuMuc.mutateAsync({ id: chuyenBo.id, folderId });
          }}
        />

        <ConfirmDialog
          open={xoaThuMucNao !== null}
          onClose={() => setXoaThuMucNao(null)}
          title="Xoá thư mục"
          confirmLabel="Xoá thư mục"
          danger
          loading={xoaThuMuc.isPending}
          onConfirm={(onError) => {
            if (xoaThuMucNao === null) return;
            xoaThuMuc.mutate(xoaThuMucNao.id, {
              onSuccess: () => {
                // Đang đứng trong chính thư mục vừa xoá thì về Chung — cũng là
                // nơi những bộ dữ liệu bên trong nó vừa quay về. Không dời đi
                // thì danh sách lọc theo một mã không còn tồn tại và trống trơn.
                if (dangMo === xoaThuMucNao.id) chonThuMuc(null);
                setXoaThuMucNao(null);
              },
              onError,
            });
          }}
        >
          Xoá thư mục <strong>{xoaThuMucNao?.name}</strong>?{' '}
          {xoaThuMucNao !== null && xoaThuMucNao.itemCount > 0 ? (
            <>
              <strong>{xoaThuMucNao.itemCount} bộ dữ liệu</strong> bên trong KHÔNG bị xoá — chúng
              quay về {CHUNG}.
            </>
          ) : (
            'Thư mục này đang trống.'
          )}
        </ConfirmDialog>

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

/** Tên chỗ đang mở, để câu chữ của màn hình trống gọi đúng chỗ. */
function tenThuMuc(id: number | null, folders: readonly FolderDto[]): string {
  if (id === null) return CHUNG;
  return folders.find((f) => f.id === id)?.name ?? 'Thư mục này';
}
