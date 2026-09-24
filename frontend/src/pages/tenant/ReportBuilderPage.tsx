import {
  ANNOTATION_KIND_LABELS,
  BILLING_ERROR_CODES,
  CANVAS_COLUMNS,
  CANVAS_DEFAULT_H,
  CANVAS_MAX_ANNOTATIONS,
  CANVAS_MAX_PAGES,
  CANVAS_MAX_VISUALS,
  parseFolderFilter,
  REPORT_NAME_MAX,
  type ReportDto,
} from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { useHetHanMuc } from '../../features/billing/hooks';
import { LimitAlert } from '../../features/billing/LimitAlert';
import { CubeOfflineNotice } from '../../features/datamodels/CubeOfflineNotice';
import {
  useDataModel,
  useDataModels,
  useExplorerFields,
  useExplorerStatus,
} from '../../features/datamodels/hooks';
import {
  useCreateCanvasReport,
  useReport,
  useUpdateCanvasReport,
} from '../../features/datasets/hooks';
import { CanvasBoard } from '../../features/reports/builder/CanvasBoard';
import { CanvasTools } from '../../features/reports/builder/CanvasTools';
import { isTextEntry, undoShortcut, useHistory } from '../../features/reports/builder/history';
import { ZoomViewport } from '../../features/reports/builder/ZoomViewport';
import { readZoom, writeZoom } from '../../features/reports/builder/zoom';
import { EditModelLink } from '../../features/reports/builder/EditModelLink';
import { PageTabs } from '../../features/reports/PageTabs';
import { ReportShell } from '../../features/reports/ReportShell';
import { SidePanel } from '../../features/reports/builder/SidePanel';
import {
  applyPatch,
  duplicateOf,
  moveInLayer,
  presetOf,
  type AnnotationPatch,
  type AnnotationPresetKey,
} from '../../features/reports/builder/annotation';
import { AnnotationPanel } from '../../features/reports/builder/AnnotationPanel';
import { InsertBar } from '../../features/reports/builder/InsertBar';
import type { DragField } from '../../features/reports/builder/dnd';
import { FieldsPanel } from '../../features/reports/builder/FieldsPanel';
import { groupBySheet } from '../../features/datamodels/sheets';
import { VisualPanel } from '../../features/reports/builder/VisualPanel';
import {
  assignField,
  blockerOf,
  emptyPage,
  emptyVisual,
  findSlot,
  fieldLabelsOf,
  fromDto,
  hasAnyVisual,
  hasUnsavedWork,
  newVisualId,
  nextPageName,
  pagesFromDto,
  readyPages,
  seriesUsed,
  slotForClick,
  snapshotOf,
  titleOf,
  type PageDraft,
  type VisualDraft,
} from '../../features/reports/builder/visual';
import { getApiError } from '../../services/apiClient';

/**
 * Trang SỬA một báo cáo — trình dựng, toàn màn hình.
 *
 * ═══ Xem và sửa lại tách ra làm hai trang (§10.13) ══════════════════════════
 *
 * §10.10 gộp chúng vào một trang. §10.13 tách lại, theo yêu cầu của người dùng
 * và với lý do đầy đủ ở `ReportViewPage`. Ranh giới bây giờ:
 *
 *   /reports/:id       XEM — mọi vai trò, một request cho cả trang
 *   /reports/:id/edit  SỬA — trang này
 *
 * ═══ Nhưng route này vẫn KHÔNG gác quyền ════════════════════════════════════
 *
 * Ai không sửa được mà tới đây thì bị ĐẨY về trang xem, chứ không rơi vào /403.
 * Ba lý do, và cả ba là chuyện thật:
 *
 *   - Viewer không có `datamodel:read` (migration 26). Link `/edit` đã được dán
 *     cho nhau từ §10.10 tới giờ, và một cái link cũ nên dẫn tới thứ người ta
 *     định xem chứ không tới một câu từ chối.
 *   - Báo cáo dựng trên BỘ DỮ LIỆU (§7.6) mang cấu hình dạng TÊN CỘT, còn
 *     trình dựng chỉ đọc được cấu hình dạng ID trường — nó thật sự không sửa
 *     được ở đây, kể cả bởi admin.
 *   - Đẩy về `/reports/:id` thì họ vẫn ĐỌC được báo cáo, và đó là thứ họ muốn.
 *
 * Chặn thật vẫn ở backend: `authorize('report','modify')` cho mỗi lần ghi.
 * Trang này chỉ quyết định hiện cái gì.
 */
export default function ReportPageFullScreen(): React.ReactElement {
  const params = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const editingId = toId(params['reportId']);
  const shortcutModel = toId(params['datamodelId']);

  const report = useReport(editingId);
  const loaded = report.data;

  /*
   * Đều bọc trong `ReportShell`: một `<ErrorState>` trần trên nền trắng toàn màn hình
   * là một ngõ cụt thật sự — không sidebar, không nút nào, chỉ còn nút Back của
   * trình duyệt.
   */
  if (report.isError) {
    return (
      <ReportShell onExit={() => void navigate('/reports')}>
        <ErrorState message={getApiError(report.error).message} />
      </ReportShell>
    );
  }

  if (editingId !== null && (report.isPending || loaded === undefined)) {
    return (
      <ReportShell onExit={() => void navigate('/reports')}>
        <TableSkeleton rows={6} />
      </ReportShell>
    );
  }

  /*
   * Hỏi CẢ HAI ô, không phải một.
   *
   * `report:modify` là quyền ghi báo cáo; `datamodel:read` là thứ trình dựng
   * cần để đọc chiều/thước đo. Hôm nay chưa vai trò nào có ô này mà thiếu ô
   * kia, nhưng thiếu một ô là trình dựng mở ra rồi mọi request bên trong ăn
   * 403 — tệ hơn hẳn một bản chỉ đọc chạy được.
   */
  const canEdit = permissions.can('report', 'modify') && permissions.readDataModels;

  /*
   * Không sửa được thì về trang XEM — không phải /403, và cũng không phải một
   * bản chỉ đọc dựng lại ngay tại đây.
   *
   * `replace`: người tới đây bằng một link `/edit` cũ không cố ý ghé qua trình
   * dựng, nên nó không đáng một nấc trong lịch sử — thiếu nó thì nút Back của
   * trình duyệt đẩy họ ngược vào đây rồi bật ra, mãi không thoát.
   */
  if (loaded !== undefined && (!canEdit || loaded.source !== 'datamodel')) {
    return <Navigate to={`/reports/${loaded.id}`} replace />;
  }

  return <Builder editingId={editingId} shortcutModel={shortcutModel} loaded={loaded} />;
}

/**
 * Trình dựng báo cáo — §10.9, mở rộng thành KHUNG NHIỀU Ô ở §10.10.
 *
 * ═══ Vì sao nó rời khỏi tab Mô hình dữ liệu ═════════════════════════════════
 *
 * Tới §10.9 trang này chỉ vào được từ trong một mô hình, và đường dẫn của nó
 * (`/datamodels/:id/report/new`) nói đúng điều đó. Hệ quả là việc "làm một báo
 * cáo" trông như một tính năng phụ của việc "quản lý mô hình" — người dùng phải
 * biết mình sẽ dùng mô hình nào TRƯỚC khi tìm được chỗ bắt đầu.
 *
 * Từ §10.10 báo cáo là một khu riêng: `/reports/new`, vào từ mục Báo cáo trên
 * thanh bên, và câu hỏi "mô hình nào" được hỏi NGAY TRONG trang. Đường cũ vẫn
 * còn — nó chỉ là lối tắt điền sẵn mô hình, không còn là lối duy nhất.
 *
 * ═══ Và vì sao nó cũng rời khỏi cả khung sidebar ════════════════════════════
 *
 * Trang này KHÔNG dùng `UserLayout` — nó chiếm trọn màn hình và tự dựng thanh
 * công cụ của mình. Xem khối route toàn màn hình trong `App.tsx` để biết lý do
 * đầy đủ; ba điều nó bắt trang phải tự lo:
 *
 *   1. LỐI RA. Không còn sidebar để bấm về chỗ khác, nên mũi tên ← ở góc trái
 *      là đường về duy nhất và không được phép vắng mặt ở BẤT KỲ trạng thái
 *      nào — kể cả màn hình lỗi. Đó là lý do có `ReportShell` và mọi lối ra
 *      sớm đều đi qua nó.
 *   2. CẢNH BÁO CHƯA LƯU. Trước đây lỡ tay bấm sang mục khác thì mất khung
 *      đang dựng — khó chịu nhưng còn đỡ, vì sidebar luôn ở đó nhắc rằng mình
 *      đang "trong ứng dụng". Giờ hai lối ra đều là hành động dứt khoát, nên cả
 *      hai đều hỏi lại khi có việc chưa lưu (`dirty`), và `beforeunload` lo nốt
 *      trường hợp đóng tab.
 *   3. CHIỀU CAO. `h-screen` bắt đầu lại chuỗi chiều cao mà `UserLayout` vẫn
 *      giữ hộ; đứt ở đây thì mọi `h-full` bên dưới vô nghĩa.
 *
 * ═══ Ba đường vào, một trang ════════════════════════════════════════════════
 *
 *   /reports/new                       chọn mô hình trong trang
 *   /datamodels/:datamodelId/report/new  lối tắt, mô hình điền sẵn
 *   /reports/:reportId/edit            sửa một báo cáo đã có
 *
 * Tên tham số KHÁC nhau nên trang không phải đoán `:id` là id của cái gì.
 *
 * ═══ Mở một báo cáo MỘT biểu đồ thì sao ═════════════════════════════════════
 *
 * Nó được nạp thành một khung một ô, rộng hết bề ngang. Bấm Lưu là nó thành báo
 * cáo nhiều ô thật sự (backend ghi cột `canvas`) — một chiều, không quay lại.
 * Không mất gì: ô đó giữ nguyên cấu hình cũ, và backend vẫn chép ô đầu tiên vào
 * `chart_type`/`config` nên mọi thứ đọc hai cột đó đọc ra đúng biểu đồ ấy.
 *
 * ═══ Bố cục ba cột, xếp theo đường đi của tay ═══════════════════════════════
 *
 *   khung (nhiều ô)  |  cấu hình ô ĐANG CHỌN  |  Mô hình dữ liệu
 *
 * Bảng trường ở ngoài cùng bên phải, ngay cạnh các ô thả — kéo một trường chỉ
 * phải đi qua vài chục pixel.
 */
function Builder({
  editingId,
  shortcutModel,
  loaded,
}: {
  editingId: number | null;
  shortcutModel: number | null;
  /** Báo cáo đang sửa, ĐÃ nạp xong. `undefined` = đang dựng báo cáo mới. */
  loaded: ReportDto | undefined;
}): React.ReactElement {
  const navigate = useNavigate();
  const permissions = usePermissions();

  /** Mô hình người dùng chọn trong trang — chỉ dùng ở luồng tạo mới. */
  const [pickedModel, setPickedModel] = useState<number | null>(null);
  const modelId =
    editingId !== null ? (loaded?.datamodelId ?? null) : (shortcutModel ?? pickedModel);

  const model = useDataModel(modelId);
  const status = useExplorerStatus(modelId);
  const fields = useExplorerFields(modelId);

  // Danh sách mô hình CHỈ tải khi trang thật sự phải hỏi — tức là tạo mới và
  // chưa có mô hình nào được chọn. Sửa một báo cáo thì không bao giờ hỏi.
  const models = useDataModels(
    { page: 1, pageSize: 100, q: '', sort: 'updatedAt', order: 'desc' },
    { enabled: editingId === null && shortcutModel === null },
  );

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  /**
   * Các TRANG của báo cáo — §10.12.
   *
   * Trước bản này chỗ này là một mảng ô phẳng. Đổi thành mảng trang chứ không
   * thêm một trường `pageId` vào từng ô: lồng nhau làm cho "xoá một trang" là
   * một phép xoá một phần tử, chứ không phải một phép lọc phải nhớ chạy ở bốn
   * chỗ — và bỏ sót một chỗ nghĩa là ô mồ côi vẫn đi vào bản lưu.
   */
  /*
   * Trang khởi tạo dựng ĐÚNG MỘT LẦN, rồi dùng cho cả state lẫn mốc so sánh.
   *
   * Gọi `emptyPage()` hai lần sinh hai mã trang khác nhau, và `snapshotOf` mang
   * mã trang — nên mốc sẽ không bao giờ khớp với trạng thái, và một trình dựng
   * vừa mở ra đã tự nhận là "Chưa lưu". Hỏi thừa vài lần là người dùng học được
   * cách bấm "Rời đi" mà không đọc, và lần cần hỏi thật cũng mất tác dụng.
   */
  const [initialPages] = useState<PageDraft[]>(() => [emptyPage('Trang 1')]);
  /**
   * Hoàn tác / làm lại — §10.20. Lịch sử giữ MẢNG TRANG, không giữ tên báo cáo:
   * tên nằm trong một ô nhập chữ, và ở đó Ctrl+Z là của chính ô đó. Xem
   * `history.ts`.
   */
  const history = useHistory<PageDraft[]>(() => initialPages);
  const pages = history.present;
  const resetHistory = history.reset;
  /** Mức thu phóng khung — §10.20. Sở thích của người ngồi trước màn hình. */
  const [zoom, setZoom] = useState(readZoom);
  const [activePageId, setActivePageId] = useState<string | null>(() => null);
  const [selectedId, setSelectedId] = useState<string | null>(() => null);
  /**
   * Hộp văn bản đang ở chế độ GÕ CHỮ (§10.18).
   *
   * Ở trang chứ không ở `CanvasBoard`: bấm "Văn bản" trên thanh Chèn phải thả
   * hộp xuống VÀ mở ngay ô gõ chữ — người vừa bấm nút đó muốn viết, không muốn
   * bấm đúp thêm một lần nữa.
   */
  const [typingId, setTypingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragField | null>(null);
  /** Lỗi của lần Lưu gần nhất — giữ cả MÃ để nhận ra vượt hạn mức gói (§11.2). */
  const [saveError, setSaveError] = useState<{ message: string; code: string } | null>(null);
  /** Tổ chức đã dùng hết số báo cáo của gói — chỉ đáng nói khi đang dựng MỚI. */
  const hetHanMuc = useHetHanMuc('reports');
  /*
   * `?folder=` — thư mục người dùng đang đứng khi bấm "Tạo báo cáo" (§10.25).
   *
   * Qua URL chứ không qua `navigate(state)`: state của history biến mất khi F5,
   * và một người dựng báo cáo nửa chừng rồi tải lại trang sẽ lặng lẽ lưu nó vào
   * Chung thay vì thư mục họ đang mở. Vắng mặt = Chung, đúng mặc định.
   *
   * Chỉ có nghĩa khi TẠO MỚI: sửa một báo cáo đã có thì thư mục của nó là thứ
   * đã lưu, và đường lưu (`updateCanvasReport`) không đụng tới cột đó.
   */
  const [searchParams] = useSearchParams();
  const folderMoi = parseFolderFilter(searchParams.get('folder') ?? undefined) ?? null;
  /**
   * Yêu cầu đổi mô hình đang chờ xác nhận.
   *
   * Bọc trong một object chứ không phải `number | null` suông: `to: null` là
   * một đích hợp lệ — nó nghĩa là "quay về màn chọn mô hình". Dùng `null` cho
   * cả "không có yêu cầu nào" lẫn "đổi về màn chọn" thì nút Đổi mô hình không
   * bao giờ mở được hộp thoại.
   */
  const [switching, setSwitching] = useState<{ to: number | null } | null>(null);
  /** Đường dẫn đang chờ xác nhận rời đi, khi còn việc chưa lưu. */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** Vừa lưu xong — hiện "Đã lưu" một lát rồi tắt. */
  const [justSaved, setJustSaved] = useState(false);

  const create = useCreateCanvasReport();
  const update = useUpdateCanvasReport();

  /**
   * Mốc "đã lưu" để đối chiếu — xem `hasUnsavedWork`.
   *
   * Dựng mới thì mốc là khung RỖNG; sửa một báo cáo có sẵn thì mốc được đặt lại
   * ngay lúc nạp xong. Không đặt lại thì người chỉ ghé xem rồi thoát sẽ bị hỏi
   * "bỏ thay đổi?" cho một thay đổi không tồn tại — và hỏi thừa vài lần là
   * người ta bấm Có theo phản xạ, lần cần hỏi thật cũng mất tác dụng luôn.
   */
  const [baseline, setBaseline] = useState<string>(() => snapshotOf('', readyPages(initialPages)));

  /*
   * Nạp báo cáo cũ vào khung, ĐÚNG MỘT LẦN.
   *
   * `seeded` chứ không phải `[loaded]` suông: react-query trả lại dữ liệu sau
   * mỗi lần refetch (đổi tab cửa sổ là đủ), và không có cờ này thì mọi thứ người
   * dùng vừa kéo sẽ bị ghi đè bằng bản đã lưu — mất việc mà không báo gì.
   */
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || loaded === undefined || loaded.source !== 'datamodel') return;

    setName(loaded.name);

    if (loaded.canvas !== null) {
      const list = pagesFromDto(loaded.canvas);
      // `reset` chứ không `set`: nạp bản đã lưu không phải thứ để hoàn tác —
      // bấm Ctrl+Z ngay khi mở báo cáo mà ra một khung trống là mất cả báo cáo.
      resetHistory(list);
      setActivePageId(list[0]?.id ?? null);
      setSelectedId(list[0]?.visuals[0]?.id ?? null);
      setBaseline(snapshotOf(loaded.name, readyPages(list)));
    } else if (loaded.modelConfig !== null && loaded.chartType !== null) {
      // Báo cáo một biểu đồ (§10.8/§10.9) → khung một ô, rộng hết bề ngang.
      const one = fromDto({
        id: newVisualId(),
        chartType: loaded.chartType,
        config: loaded.modelConfig,
        x: 0,
        y: 0,
        w: CANVAS_COLUMNS,
        h: CANVAS_DEFAULT_H,
      });
      const only: PageDraft = { ...emptyPage('Trang 1'), visuals: [one] };
      resetHistory([only]);
      setActivePageId(only.id);
      setSelectedId(one.id);
      // Mốc so sánh là khung MỘT Ô vừa dựng ra, không phải khung rỗng — mở một
      // báo cáo cũ rồi thoát ngay thì không có gì để mất, và không nên bị hỏi.
      setBaseline(snapshotOf(loaded.name, readyPages([only])));
    }

    setSeeded(true);
  }, [seeded, loaded, resetHistory]);

  const dimensions = fields.data?.dimensions ?? [];
  const measures = fields.data?.measures ?? [];

  /**
   * Ô đang chọn — TÍNH RA, không lưu, và có ô mặc định là ô đầu tiên.
   *
   * Trước đây một `useEffect` chọn hộ ô đầu tiên khi `selectedId` còn `null`,
   * và nó đã hỏng thật: khi trang mở một báo cáo CÓ SẴN, hai effect chạy trong
   * cùng một lượt — effect nạp báo cáo đặt `selectedId` theo ô vừa nạp, effect
   * chọn-hộ đọc `selectedId` cũ (vẫn `null`) và ghi đè bằng id của ô RỖNG khởi
   * tạo. Ô rỗng đó không còn trong `drafts`, nên bảng cấu hình đứng im ở câu
   * "Bấm vào một ô trên khung" và bấm một trường không có tác dụng gì.
   *
   * Tính ra thì không có hai nguồn sự thật để tranh nhau: `selectedId` chỉ ghi
   * lựa chọn CÓ Ý CỦA NGƯỜI DÙNG, còn cái mặc định là một phép suy ra.
   */
  /*
   * Trang đang mở — TÍNH RA, cùng lập luận với `selected` ngay dưới: `activePageId`
   * chỉ ghi lựa chọn CÓ Ý của người dùng, còn cái mặc định là một phép suy ra.
   * Nó cũng là đường lui khi trang đang mở vừa bị xoá.
   */
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;
  const drafts = activePage?.visuals ?? [];
  const annotations = activePage?.annotations ?? [];

  /**
   * Mọi phép sửa khung đi qua đây, nên mọi phép sửa đều hoàn tác được.
   *
   * `key` khác `null` thì gộp với thay đổi CÙNG khoá ngay trước thành một bước:
   * gõ một câu, giữ phím mũi tên, kéo bộ chọn màu. Mang theo trang đang mở để
   * hoàn tác một thay đổi ở trang 2 thì mở lại trang 2 — không thì người dùng
   * bấm Ctrl+Z ở trang 1 và không thấy gì đổi.
   */
  function setPages(update: (list: PageDraft[]) => PageDraft[], key: string | null = null): void {
    history.set(update, { key, pageId: activePage?.id ?? null });
  }

  function undo(): void {
    const pageId = history.undo();
    if (pageId !== null) setActivePageId(pageId);
    // Hộp chữ đang gõ có thể vừa bị hoàn tác mất; ô gõ không được treo lại.
    setTypingId(null);
  }

  function redo(): void {
    const pageId = history.redo();
    if (pageId !== null) setActivePageId(pageId);
    setTypingId(null);
  }

  /*
   * Ctrl+Z / Ctrl+Y trên cả trang, TRỪ khi đang gõ chữ trong một ô nhập — ở đó
   * trình duyệt tự hoàn tác chữ của ô, đúng thứ người đang gõ chờ đợi.
   *
   * Handler đọc qua ref: gắn lại listener sau mỗi lượt vẽ thì một phím bấm rơi
   * đúng khe giữa gỡ và gắn sẽ mất.
   */
  const shortcuts = useRef({ undo, redo });
  shortcuts.current = { undo, redo };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const what = undoShortcut(event);
      if (what === null || isTextEntry(event.target)) return;
      // Hộp thoại đang mở ("Rời khỏi trình dựng?") thì phím tắt không được sửa
      // khung phía sau lưng nó.
      if (document.querySelector('dialog[open]') !== null) return;
      event.preventDefault();
      shortcuts.current[what]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function changeZoom(next: number): void {
    setZoom(next);
    writeZoom(next);
  }

  /*
   * Chú thích đang chọn — hỏi TRƯỚC ô biểu đồ.
   *
   * `selected` có đường lui về ô đầu tiên khi không có gì được chọn. Hỏi nó
   * trước thì bấm vào một hộp văn bản vẫn mở bảng cấu hình của biểu đồ số 1 —
   * mã của hộp không có trong `drafts`, và đường lui thắng.
   */
  const selectedAnnotation = annotations.find((a) => a.id === selectedId) ?? null;
  const selected =
    selectedAnnotation !== null
      ? null
      : (drafts.find((d) => d.id === selectedId) ?? drafts[0] ?? null);

  // Số BẢNG có trường — cùng phép gom mà bảng trường dùng, nên hai con số không
  // lệch nhau được.
  const sheetCount = groupBySheet(dimensions, measures).length;

  const labelOf = (draft: VisualDraft): string => {
    // Cùng luật đặt tên với backend, để tiêu đề ô ở đây khớp trang xem khi hai
    // trường trùng tên — §10.21.
    const ten = fieldLabelsOf(draft, dimensions, measures);
    return titleOf(draft, ten.dimension, ten.measure);
  };

  // ─── Sửa một ô ─────────────────────────────────────────────────────────────

  /**
   * Đổi danh sách ô của TRANG ĐANG MỞ.
   *
   * Mọi phép sửa ô đi qua đúng hàm này, nên không có đường nào lỡ tay sửa ô của
   * một trang khác — thứ sẽ không có lỗi nào báo và chỉ lộ ra khi người dùng
   * chuyển sang trang đó.
   */
  function editPage(
    change: (list: VisualDraft[]) => VisualDraft[],
    key: string | null = null,
  ): void {
    const pageId = activePage?.id;
    if (pageId === undefined) return;
    setPages(
      (list) => list.map((p) => (p.id === pageId ? { ...p, visuals: change(p.visuals) } : p)),
      key,
    );
  }

  /**
   * Sửa một ô. `merge` (mặc định): cùng ô, cùng NHÓM trường, sửa liền tay thì gộp
   * một bước hoàn tác — gõ tiêu đề, giữ mũi tên. Cú kéo thả xong thì không gộp:
   * hai cú kéo liền nhau là hai việc người dùng muốn lùi riêng.
   */
  function patch(id: string, changes: Partial<VisualDraft>, merge = true): void {
    editPage(
      (list) => list.map((d) => (d.id === id ? { ...d, ...changes } : d)),
      merge ? mergeKey('o', id, changes) : null,
    );
  }

  function addVisual(): void {
    if (drafts.length >= CANVAS_MAX_VISUALS) return;
    const fresh = emptyVisual(findSlot(drafts));
    editPage((list) => [...list, fresh]);
    setSelectedId(fresh.id);
  }

  // ─── Chú thích — §10.18 ────────────────────────────────────────────────────

  /** Cùng vai trò với `editPage`, cho mảng chú thích của trang đang mở. */
  function editAnnotations(
    change: (list: PageDraft['annotations']) => PageDraft['annotations'],
    key: string | null = null,
  ): void {
    const pageId = activePage?.id;
    if (pageId === undefined) return;
    setPages(
      (list) =>
        list.map((p) => (p.id === pageId ? { ...p, annotations: change(p.annotations) } : p)),
      key,
    );
  }

  function addAnnotation(key: AnnotationPresetKey): void {
    if (annotations.length >= CANVAS_MAX_ANNOTATIONS) return;
    const preset = presetOf(key);
    // Tìm chỗ trống giữa CẢ biểu đồ lẫn chú thích: một hộp chữ thả đè lên biểu
    // đồ là một hộp chữ người dùng phải đi tìm rồi kéo ra.
    const fresh = preset.make(
      newVisualId(),
      findSlot([...drafts, ...annotations], preset.w, preset.h),
    );
    editAnnotations((list) => [...list, fresh]);
    setSelectedId(fresh.id);
    setTypingId(fresh.kind === 'text' ? fresh.id : null);
  }

  function patchAnnotation(id: string, changes: AnnotationPatch, merge = true): void {
    editAnnotations(
      (list) => list.map((a) => (a.id === id ? applyPatch(a, changes) : a)),
      merge ? mergeKey('c', id, changes) : null,
    );
  }

  function removeAnnotation(id: string): void {
    editAnnotations((list) => list.filter((a) => a.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (typingId === id) setTypingId(null);
  }

  function duplicateAnnotation(id: string): void {
    const source = annotations.find((a) => a.id === id);
    if (source === undefined || annotations.length >= CANVAS_MAX_ANNOTATIONS) return;
    const copy = duplicateOf(source, newVisualId());
    editAnnotations((list) => [...list, copy]);
    setSelectedId(copy.id);
  }

  function removeVisual(id: string): void {
    editPage((list) => {
      const next = list.filter((d) => d.id !== id);
      // Một trang không còn ô nào thì không có gì để thao tác lên, nên xoá ô
      // cuối cùng sẽ để lại một ô trống thay vì một khoảng trắng.
      return next.length === 0 ? [emptyVisual({ x: 0, y: 0 })] : next;
    });
    if (selectedId === id) setSelectedId(null);
  }

  // ─── Sửa TRANG ─────────────────────────────────────────────────────────────

  function addPage(): void {
    if (pages.length >= CANVAS_MAX_PAGES) return;
    const fresh = emptyPage(nextPageName(pages));
    setPages((list) => [...list, fresh]);
    setActivePageId(fresh.id);
    // Chọn luôn ô trống của trang mới: người vừa thêm trang muốn dựng biểu đồ
    // ngay, và bảng cấu hình bên phải phải có thứ để hiện.
    setSelectedId(fresh.visuals[0]?.id ?? null);
    setTypingId(null);
  }

  function renamePage(id: string, name: string): void {
    setPages((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function removePage(id: string): void {
    // Trang cuối cùng không xoá được — `PageTabs` đã giấu nút, đây là chốt thứ
    // hai cho đường bàn phím và cho mọi lần gọi khác về sau.
    if (pages.length <= 1) return;
    setPages((list) => list.filter((p) => p.id !== id));
    // Không cần chọn hộ trang khác: `activePage` tự rơi về trang đầu.
    if (activePageId === id) setActivePageId(null);
    setSelectedId(null);
    setTypingId(null);
  }

  /** Bấm một trường trong bảng: đổ vào ô ĐANG CHỌN. */
  function addByClick(field: DragField): void {
    if (selected === null) return;
    const slot = slotForClick(selected, field, new Set(dimensions.map((f) => f.id)));
    const changes = assignField(selected, slot, field);
    if (changes !== null) patch(selected.id, changes);
  }

  // ─── Đổi mô hình ───────────────────────────────────────────────────────────

  /** Có gì để mất khi đổi mô hình không — ID trường chỉ có nghĩa trong một mô hình. */
  const hasWork = pages.some(
    (p) =>
      p.visuals.some((d) => d.dimensionId !== null || d.measureId !== null) ||
      // Chú thích không phụ thuộc mô hình, nhưng đổi mô hình dọn cả khung — nên
      // một tiêu đề vừa gõ cũng là thứ sẽ mất, và cũng đáng một câu hỏi lại.
      p.annotations.length > 0,
  );

  function switchModel(to: number | null): void {
    if (!hasWork) {
      applySwitch(to);
      return;
    }
    setSwitching({ to });
  }

  function applySwitch(to: number | null): void {
    setPickedModel(to);
    // Cả TRANG cũng bị dọn, không chỉ các ô: id chiều và thước đo chỉ có nghĩa
    // trong một mô hình, nên giữ lại một trang tên "Doanh thu theo vùng" trống
    // rỗng là giữ lại một cái vỏ không còn ruột.
    const fresh = emptyPage('Trang 1');
    // `reset`: hoàn tác về khung của mô hình CŨ là đổ lại những mã trường không
    // tồn tại trong mô hình mới.
    history.reset([fresh]);
    setActivePageId(fresh.id);
    setSelectedId(fresh.visuals[0]?.id ?? null);
    setTypingId(null);
  }

  // ─── Lưu ───────────────────────────────────────────────────────────────────

  const ready = readyPages(pages);

  const suggestedName = (() => {
    const first = pages.flatMap((p) => p.visuals).find((d) => blockerOf(d) === null);
    return first === undefined ? '' : labelOf(first);
  })();
  const effectiveName = nameTouched || name !== '' ? name : suggestedName;

  const canSave =
    permissions.can('report', 'modify') &&
    modelId !== null &&
    hasAnyVisual(pages) &&
    effectiveName.trim() !== '';

  const saving = create.isPending || update.isPending;

  /*
   * `!saving`: trong lúc lệnh lưu đang bay, trang KHÔNG được coi là còn việc
   * chưa lưu — nếu không thì `beforeunload` gắn lại đúng lúc chuyển trang.
   */
  const dirty = !saving && hasUnsavedWork(baseline, effectiveName, pages);

  // Sửa tiếp là "Đã lưu" hết đúng ngay, không đợi hết 2,5 giây — nhãn đó nói về
  // trạng thái hiện tại chứ không phải về một sự kiện trong quá khứ.
  const savedLabel = justSaved && !dirty;

  /**
   * Lưu xong thì Ở LẠI — trang này CHÍNH LÀ trang báo cáo.
   *
   * Trước bản này, lưu xong là nhảy sang `/reports/:id` để người dùng thấy kết
   * quả. Trang đó không còn nữa, nên "nhảy sang trang xem" giờ là nhảy về
   * đúng chỗ đang đứng — một lần chuyển hướng không làm gì, và tệ hơn: mốc
   * `baseline` không được cập nhật nên chấm "Chưa lưu" vẫn sáng sau khi đã lưu
   * xong.
   *
   * Nên ở đây tự đặt lại mốc và bật "Đã lưu" trong vài giây. Đó cũng là toàn bộ
   * phản hồi mà lần lưu này có — repo chưa có hệ thống thông báo nổi.
   */
  function save(): void {
    if (modelId === null || !hasAnyVisual(pages)) return;
    setSaveError(null);

    const onError = (err: unknown): void => {
      const { message, error } = getApiError(err);
      setSaveError({ message, code: error });
    };

    if (editingId !== null) {
      update.mutate(
        { id: editingId, input: { name: effectiveName.trim(), canvas: { pages: ready } } },
        {
          onSuccess: () => {
            setBaseline(snapshotOf(effectiveName, ready));
            setJustSaved(true);
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      {
        datamodelId: modelId,
        name: effectiveName.trim(),
        canvas: { pages: ready },
        folderId: folderMoi,
      },
      {
        onSuccess: (created) => {
          /*
           * Đổi URL sang báo cáo VỪA TẠO, và `replace` để nút Back không quay
           * lại một trang dựng trống.
           *
           * Đường dẫn đổi (`/reports/new` -> `/reports/:id/edit`) nên component
           * mount lại và tự đặt mốc từ bản đã lưu — không cần `setBaseline` ở
           * đây. Không đổi URL thì F5 mở ra một trang dựng trống, và người dùng
           * tưởng mất bài.
           */
          void navigate(`/reports/${created.id}/edit`, { replace: true });
        },
        onError,
      },
    );
  }

  // ─── Rời trang ─────────────────────────────────────────────────────────────

  /**
   * Lối ra: về trang XEM báo cáo đang sửa, hoặc về DANH SÁCH nếu đang dựng mới.
   *
   * Đi tới một chỗ CỤ THỂ, không phải `navigate(-1)`: người mở trang này bằng
   * một link dán từ đồng nghiệp không có lịch sử để lùi, và `-1` sẽ đẩy họ ra
   * khỏi hẳn ứng dụng.
   *
   * Sửa xong thì chỗ muốn tới là chính báo cáo vừa sửa — người ta vào đây từ
   * nút "Chỉnh sửa" của trang đó (§10.13), nên ← trả họ về đúng chỗ đã đứng.
   * Dựng MỚI thì chưa có trang xem nào để về, và danh sách là nơi báo cáo vừa
   * lưu sẽ hiện ra.
   */
  const exitTo = editingId === null ? '/reports' : `/reports/${editingId}`;

  /**
   * Rời trang tới `path`, hỏi lại nếu còn việc chưa lưu.
   *
   * Nhận một đường dẫn chứ không chỉ biết đường về: tới §10.18 nó còn chở cả
   * đường sang trang mô hình. Từ §10.19 đường đó mở TAB MỚI và không làm mất
   * khung nữa (`EditModelLink`), nên không còn đi qua đây.
   */
  function goTo(path: string): void {
    if (dirty) {
      setLeaving(path);
      return;
    }
    void navigate(path);
  }

  function leave(): void {
    goTo(exitTo);
  }

  /*
   * Đóng tab / F5 / dán URL khác vào thanh địa chỉ.
   *
   * Hộp thoại của `leave()` không với tới được những đường đó — chúng rời khỏi
   * SPA chứ không đi qua router. Chỉ gắn khi THẬT SỰ có việc chưa lưu: gắn
   * thường trực thì mỗi lần F5 trình duyệt lại hỏi "rời khỏi trang?" cho một
   * trang trống, và người dùng học được cách bấm Rời đi mà không đọc.
   */
  // "Đã lưu" tự tắt: một nhãn nằm mãi trên thanh công cụ thôi mang tin sau vài
  // giây, và người dùng sẽ không phân biệt được nó với trạng thái hiện tại.
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Trình duyệt cũ đọc `returnValue`; bản mới chỉ cần `preventDefault`. Văn
      // bản đặt ở đây KHÔNG hiện ra — mọi trình duyệt đều dùng câu của riêng nó.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const cubeDown = status.data !== undefined && !status.data.cubeReady;

  return (
    <ReportShell
      onExit={leave}
      exitLabel={editingId === null ? 'Quay lại danh sách báo cáo' : 'Quay lại trang xem báo cáo'}
      title={
        <input
          type="text"
          value={effectiveName}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          placeholder="Báo cáo chưa đặt tên"
          aria-label="Tên báo cáo"
          maxLength={REPORT_NAME_MAX}
          className="w-full rounded-lg border border-transparent px-2 py-1 text-base font-bold text-slate-900 transition-colors hover:border-slate-300 focus:border-brand-500 focus:bg-white"
        />
      }
      actions={
        <>
          {/* Dấu chấm "chưa lưu" — thay cho việc phải nhớ mình đã sửa gì. Ẩn ở
              màn hẹp, nơi mọi pixel ngang đều đắt.

              "Đã lưu" ở cùng chỗ là toàn bộ phản hồi của một lần lưu: trang
              không còn nhảy đi đâu nữa, nên nếu chỗ này im lặng thì bấm Lưu
              trông y hệt như không bấm. */}
          {dirty && (
            <span className="hidden items-center gap-1.5 pr-1 text-xs text-slate-500 sm:flex">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Chưa lưu
            </span>
          )}
          {savedLabel && (
            <span className="hidden items-center gap-1.5 pr-1 text-xs text-emerald-700 sm:flex">
              <span aria-hidden="true">✓</span>
              Đã lưu
            </span>
          )}
          {/* "Thoát", KHÔNG phải "Huỷ": hộp thoại xác nhận ngay sau đó có sẵn
              một nút "Huỷ" nghĩa là Ở LẠI. Hai nút cùng chữ mà ngược nghĩa,
              cách nhau vài chục pixel, là cách chắc chắn làm người ta bấm nhầm
              đúng cái nút phá huỷ công việc của mình. */}
          <Button onClick={leave}>Thoát</Button>
          <Button variant="primary" disabled={!canSave} loading={saving} onClick={save}>
            {editingId === null ? 'Lưu báo cáo' : 'Lưu thay đổi'}
          </Button>
        </>
      }
    >
      {saveError !== null &&
        (saveError.code === BILLING_ERROR_CODES.LIMIT_EXCEEDED ? (
          <div className="shrink-0">
            <LimitAlert message={saveError.message} code={saveError.code} />
          </div>
        ) : (
          <div className="mb-3 shrink-0">
            <ErrorState message={saveError.message} />
          </div>
        ))}

      {/* Báo TRƯỚC, lúc người dùng còn chưa bỏ công dựng gì: báo cáo mới sẽ không
          lưu được. Sửa báo cáo có sẵn thì không đếm thêm gì nên không cần nói.
          Server vẫn là nơi chặn thật — xem `trongHanMuc`. */}
      {editingId === null && hetHanMuc !== null && saveError === null && (
        <p
          role="status"
          className="mb-3 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          {hetHanMuc} Báo cáo đang dựng sẽ không lưu được cho tới khi xoá bớt báo cáo cũ hoặc nâng
          cấp gói.
        </p>
      )}

      {/* Chưa chọn mô hình: cả trang chỉ hỏi đúng một câu. Hiện sẵn khung và
          ba cột trống bên cạnh sẽ là ba cột không dùng được. */}
      {modelId === null ? (
        <section className="mx-auto w-full max-w-lg overflow-y-auto py-10">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Dựng trên mô hình nào?</h2>
            <p className="mt-1 mb-4 text-sm text-slate-500">
              Báo cáo lấy chiều và thước đo từ một mô hình dữ liệu. Chọn xong là vào thẳng khung
              dựng — kéo thả và xem biểu đồ đổi theo ngay.
            </p>
            <SearchSelect
              label="Mô hình dữ liệu"
              value={pickedModel}
              noun="mô hình"
              rows={6}
              onChange={(id) => {
                if (id !== null) switchModel(id);
              }}
              options={(models.data?.items ?? []).map((m) => ({
                value: m.id,
                label: m.name,
                hint: `${m.datasetCount} bảng · ${m.measureCount} thước đo`,
              }))}
              hint={
                models.isPending
                  ? 'Đang tải danh sách mô hình…'
                  : (models.data?.items.length ?? 0) === 0
                    ? 'Workspace này chưa có mô hình nào. Hãy tạo mô hình ở mục Mô hình dữ liệu trước.'
                    : undefined
              }
            />
          </div>
        </section>
      ) : (
        <div className="flex h-full min-h-0 gap-4">
          {/* ─── Khung ────────────────────────────────────────────────── */}
          {/* Cột dọc ba tầng: thanh trên cùng đứng yên, khung CUỘN, thanh thẻ
              trang ghim ở mép dưới. Để cả ba cùng cuộn thì hai thứ người dùng
              cần nhất — nút "Thêm biểu đồ" và các thẻ trang — trôi mất ngay khi
              khung dài hơn một màn hình. */}
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="font-medium text-slate-800">{model.data?.name ?? '…'}</span>
                {editingId === null && shortcutModel === null && (
                  <button
                    type="button"
                    onClick={() => switchModel(null)}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    Đổi mô hình
                  </button>
                )}
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                {/* Đếm theo TRANG ĐANG MỞ, vì trần cũng là của một trang. Một
                    con số gộp cả báo cáo sẽ nói "9/12" trong lúc trang này còn
                    thừa mười chỗ. */}
                <span className="text-slate-500">
                  {drafts.length}/{CANVAS_MAX_VISUALS} biểu đồ
                  {pages.length > 1 &&
                    ` · trang ${pages.findIndex((p) => p.id === activePage?.id) + 1}/${pages.length}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CanvasTools
                  canUndo={history.canUndo}
                  canRedo={history.canRedo}
                  onUndo={undo}
                  onRedo={redo}
                  zoom={zoom}
                  onZoom={changeZoom}
                  zoomDisabled={cubeDown}
                />
                <Button
                  onClick={addVisual}
                  disabled={drafts.length >= CANVAS_MAX_VISUALS || cubeDown}
                >
                  + Thêm biểu đồ
                </Button>
              </div>
            </div>

            {/* Thanh Chèn nằm NGOÀI vùng cuộn, cùng lý do với nút "Thêm biểu
                đồ": nó phải còn đó khi khung dài hơn một màn hình. */}
            <InsertBar
              onInsert={addAnnotation}
              disabledReason={
                cubeDown
                  ? 'Khung đang ẩn trong lúc Cube chưa chạy.'
                  : annotations.length >= CANVAS_MAX_ANNOTATIONS
                    ? `Một trang tối đa ${CANVAS_MAX_ANNOTATIONS} chú thích.`
                    : undefined
              }
            />

            <ZoomViewport zoom={cubeDown ? 1 : zoom}>
              {cubeDown ? (
                <CubeOfflineNotice
                  command={status.data?.command ?? ''}
                  onRetry={() => void status.refetch()}
                  retrying={status.isFetching}
                >
                  Bố cục khung của bạn không mất đi — bật Cube xong bấm Thử lại là các biểu đồ hiện
                  ra.
                </CubeOfflineNotice>
              ) : (
                <CanvasBoard
                  /* Khoá theo TRANG: đổi trang là dựng lại cả khung, nên
                     `groupPage` của từng ô không đi theo sang trang mới. */
                  key={activePage?.id ?? 'none'}
                  drafts={drafts}
                  annotations={annotations}
                  selectedId={selectedAnnotation?.id ?? selected?.id ?? null}
                  editingId={typingId}
                  modelId={modelId}
                  tenBaoCao={name}
                  labelOf={labelOf}
                  onSelect={setSelectedId}
                  onChange={patch}
                  onRemove={removeVisual}
                  onChangeAnnotation={patchAnnotation}
                  onRemoveAnnotation={removeAnnotation}
                  onEditText={setTypingId}
                />
              )}
            </ZoomViewport>

            {/* Thanh thẻ LUÔN hiện trong trình dựng, kể cả khi mới có một trang
                — đó là chỗ duy nhất có nút "+", nên giấu nó đi khi chỉ có một
                trang là giấu luôn đường tạo trang thứ hai. Trang XEM thì ngược
                lại: ở đó không có gì để thêm. */}
            {activePage !== null && (
              <PageTabs
                pages={pages}
                activeId={activePage.id}
                onSelect={(id) => {
                  setActivePageId(id);
                  // Bỏ lựa chọn ô: id của ô trang cũ không có trong trang mới,
                  // và `selected` sẽ tự rơi về ô đầu của trang vừa mở.
                  setSelectedId(null);
                  setTypingId(null);
                }}
                edit={{ onAdd: addPage, onRename: renamePage, onRemove: removePage }}
              />
            )}
          </section>

          {/* ─── Cấu hình ô đang chọn ─────────────────────────────────── */}
          {/* Hai cột bên GẤP LẠI được từ §10.15 — xem `SidePanel`. Khoá nhớ đặt
              theo VIỆC của cột ("visual", "fields") chứ không theo chiều rộng
              hay thứ tự, để đổi bố cục sau này không làm mất lựa chọn đã lưu
              của người dùng. */}
          {/* Tên cột đổi theo thứ đang chọn — "Chỉnh biểu đồ" trên đầu một bảng
              toàn nút căn lề với màu chữ là một cái tên nói sai. Khoá nhớ thì
              KHÔNG đổi: gấp cột lại khi đang chọn hộp văn bản thì chọn sang biểu
              đồ nó vẫn phải gấp. */}
          <SidePanel
            title={
              selectedAnnotation === null
                ? 'Chỉnh biểu đồ'
                : `Chỉnh ${ANNOTATION_KIND_LABELS[selectedAnnotation.kind].toLowerCase()}`
            }
            storageKey="visual"
            width="w-72"
          >
            {selectedAnnotation !== null ? (
              <AnnotationPanel
                annotation={selectedAnnotation}
                onChange={(changes) => patchAnnotation(selectedAnnotation.id, changes)}
                onRemove={() => removeAnnotation(selectedAnnotation.id)}
                onDuplicate={() => duplicateAnnotation(selectedAnnotation.id)}
                onMove={(to) =>
                  editAnnotations((list) => moveInLayer(list, selectedAnnotation.id, to))
                }
              />
            ) : selected === null ? (
              <p className="text-xs leading-snug text-slate-400">
                Bấm vào một ô trên khung để sửa biểu đồ của nó.
              </p>
            ) : (
              <VisualPanel
                draft={selected}
                dimensions={dimensions}
                measures={measures}
                dragging={dragging}
                onChange={(changes) => patch(selected.id, changes)}
              />
            )}
          </SidePanel>

          {/* ─── Mô hình dữ liệu ──────────────────────────────────────── */}
          <SidePanel title="Mô hình dữ liệu" storageKey="fields" width="w-64">
            {/* Hàng đầu cột: bộ đếm bên trái, nút sang trang mô hình bên phải.

                Nút hiện ở MỌI trạng thái của bảng trường, kể cả lúc đọc lỗi
                hay mô hình chưa có trường nào — đó chính là lúc người dùng cần
                sang trang mô hình nhất. Xem `EditModelLink`.

                Gác bằng `readDataModels`, đúng ô mà route `/datamodels/:id`
                hỏi: sửa một báo cáo có sẵn KHÔNG đòi quyền đó, và một nút dẫn
                thẳng vào trang 403 thì tệ hơn không có nút. */}
            <div className="flex shrink-0 items-center justify-between gap-2">
              {/* Đếm BẢNG và TRƯỜNG, không đếm "chiều" với "thước đo".
                  Bảng trường bên dưới đã thôi chia theo vai trò, nên một dòng
                  "30 chiều · 13 thước đo" ngay trên nó lại dựng lại đúng cái
                  ranh giới vừa bỏ — và ranh giới đó do phép đoán của backend
                  vẽ ra, không phải do người dùng. */}
              <p className="min-w-0 truncate text-xs text-slate-400">
                {fields.isError
                  ? 'Không đọc được mô hình'
                  : fields.isPending
                    ? 'Đang đọc mô hình…'
                    : `${sheetCount} bảng · ${dimensions.length + measures.length} trường`}
              </p>
              {permissions.readDataModels && (
                <EditModelLink modelId={modelId} canEdit={permissions.can('datamodel', 'modify')} />
              )}
            </div>
            {fields.isError ? (
              <p className="mt-2 text-xs text-red-600">{getApiError(fields.error).message}</p>
            ) : fields.isPending ? null : (
              <FieldsPanel
                dimensions={dimensions}
                measures={measures}
                used={usedBy(selected)}
                onPick={addByClick}
                onDragStart={setDragging}
                onDragEnd={() => setDragging(null)}
              />
            )}
          </SidePanel>
        </div>
      )}

      <ConfirmDialog
        open={switching !== null}
        onClose={() => setSwitching(null)}
        title="Đổi mô hình dữ liệu"
        confirmLabel="Đổi và bắt đầu lại"
        danger
        // Không có vòng mạng nào ở đây — đổi mô hình chỉ đụng state trong
        // trình duyệt, nên không bao giờ có gì để chờ.
        loading={false}
        onConfirm={() => {
          if (switching !== null) applySwitch(switching.to);
          setSwitching(null);
        }}
      >
        Chiều và thước đo thuộc về đúng một mô hình, nên đổi mô hình sẽ xoá toàn bộ khung đang dựng.
        Báo cáo chưa lưu thì không khôi phục lại được.
      </ConfirmDialog>

      <ConfirmDialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title="Rời khỏi trình dựng?"
        confirmLabel="Rời đi, không lưu"
        danger
        loading={false}
        onConfirm={() => {
          const to = leaving;
          setLeaving(null);
          if (to !== null) void navigate(to);
        }}
      >
        Khung đang dựng chưa được lưu. Rời đi bây giờ là mất toàn bộ thay đổi.
      </ConfirmDialog>
    </ReportShell>
  );
}

/** Trường đang được ô ĐANG CHỌN dùng — để bảng trường tô sáng đúng ba cái. */
function usedBy(draft: VisualDraft | null): Set<number> {
  if (draft === null) return new Set();
  return new Set(
    [draft.dimensionId, draft.measureId, seriesUsed(draft)].filter(
      (id): id is number => id !== null,
    ),
  );
}

function toId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Khoá gộp bước hoàn tác cho một lần sửa: cùng loại, cùng mã, cùng NHÓM trường.
 *
 * Đổi cỡ chữ rồi đổi màu chữ liền tay là hai bước — hai việc khác nhau; gõ
 * mười chữ vào cùng một hộp là một bước.
 */
function mergeKey(kind: 'o' | 'c', id: string, changes: object): string {
  return `${kind}:${id}:${Object.keys(changes).sort().join(',')}`;
}
