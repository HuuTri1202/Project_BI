import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { useWorkspace } from '../../workspace/useWorkspace';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateReportMenu } from '../../features/tenant/CreateReportMenu';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import {
  useDataModel,
  useDataModels,
  useDeleteDataModel,
} from '../../features/datamodels/hooks';
import { getApiError } from '../../services/apiClient';

/**
 * Trang CHI TIẾT một mô hình dữ liệu — §10.1.
 *
 * ─── Danh sách đã tách ra `/datamodels`, trang này luôn có id ───────────────
 *
 * Trước đây file này nhận cả `/datamodels` (không id, mở mô hình cập nhật gần
 * nhất) lẫn `/datamodels/:id`, và không có trang danh sách nào. Lý do đảo quyết
 * định đó nằm ở đầu `DataModelsPage` — tóm tắt: ô chọn trên breadcrumb chỉ cho
 * một cái tên mỗi lúc, nên nó đổi mô hình được nhưng không quản lý được.
 *
 * Hệ quả trực tiếp lên file này: `id` luôn có mặt. Không còn nhánh "chọn hộ mô
 * hình đầu tiên", không còn khung rỗng, không còn phải đếm mô hình ở workspace
 * khác — cả ba đều là chuyện của danh sách.
 *
 * Ô chọn trên breadcrumb được GIỮ: đổi nhanh giữa hai mô hình trong lúc đang
 * làm việc là việc khác với quản lý cả bộ, và nó nằm đúng chỗ tên mô hình xuất
 * hiện nên không phải học thêm gì.
 *
 * ─── Ba tab, đều làm thật ───────────────────────────────────────────────────
 *
 * Trước đây thanh này có chín tab: bốn cái làm thật và năm cái *sắp có* (Data
 * Blending, Measure Filters, Formula Measures, Pre-Aggregations, Row-level
 * Security) — vô hiệu, không có route, chỉ để phác lộ trình.
 *
 * Năm tab *sắp có* bỏ trước: chín tab tràn màn hình, đẻ ra một thanh cuộn ngang,
 * và bắt người dùng lướt qua năm thứ không bấm được để tìm thứ bấm được.
 *
 * Tab **Measures** bỏ sau, theo yêu cầu — thước đo vẫn tồn tại và vẫn được §10.2
 * gieo tự động cho mỗi cột số, chúng chỉ không còn màn quản lý riêng. Explorer
 * đọc chúng qua `/fields` như cũ, nên tab đó không đổi một dòng nào.
 *
 * ⚠️ Endpoint `/measures` phía backend GIỮ NGUYÊN. Xoá theo sẽ phá luôn
 * `explorerFields`, và dựng lại màn quản lý sau này sẽ phải viết lại cả tầng
 * dưới chứ không chỉ một file giao diện.
 */

interface TabDef {
  to: string;
  label: string;
  end?: boolean;
}

const TABS: TabDef[] = [
  { to: '', label: 'Schemas', end: true },
  { to: 'relationship', label: 'Relationship' },
  { to: 'explorer', label: 'Explorer' },
];

const TAB_CLASS = '-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors';

export default function DataModelPage(): React.ReactElement {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const canEdit = permissions.can('datamodel', 'modify');
  const canDelete = permissions.can('datamodel', 'delete');

  // Danh sách CHỈ phục vụ ô chọn trên breadcrumb. Từ khi `/datamodels` là trang
  // danh sách riêng, nó không còn quyết định mô hình nào được mở.
  const { current, options, select } = useWorkspace();

  // Mô hình của workspace ĐANG MỞ — cách ly giữa các workspace là có chủ đích.
  const list = useDataModels({
    page: 1,
    pageSize: 100,
    q: '',
    sort: 'updatedAt',
    order: 'desc',
  });
  const models = list.data?.items ?? [];

  // Id hong (`/datamodels/abc`, hoặc link cũ bị cắt) -> về danh sách. Trước đây
  // nhánh này lặng lẽ mở mô hình đầu tiên, nên một đường dẫn sai vẫn hiện ra một
  // mô hình nào đó và người dùng tưởng mình đang xem đúng thứ mình vừa bấm.
  const fromUrl = Number(id);
  const activeId = Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : null;

  const { data, isPending, isError, error } = useDataModel(activeId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteDataModel();

  /**
   * Kéo bộ chọn workspace theo mô hình đang mở.
   *
   * Danh sách lọc theo workspace, còn `GET /datamodels/:id` chỉ lọc theo tổ
   * chức — nên một link tới mô hình của workspace khác vẫn mở được, và khi đó
   * trang tự mâu thuẫn: nội dung hiện ra trong khi ô chọn trên breadcrumb không
   * có mục nào khớp.
   *
   * Đồng bộ theo chiều URL → workspace chứ không ngược lại: URL là thứ người
   * dùng vừa bấm vào, workspace chỉ là bộ lọc. Giữ được link chia sẻ mà không
   * phá cách ly — người nhận được chuyển sang đúng workspace của mô hình.
   */
  const workspaceOfModel = data?.workspaceId;
  useEffect(() => {
    if (workspaceOfModel === undefined || current === null) return;
    if (workspaceOfModel === current.id) return;
    // Chỉ chuyển sang workspace người này thật sự vào được; không tìm thấy nghĩa
    // là nó đã bị khoá hoặc xoá.
    if (options.some((w) => w.id === workspaceOfModel)) select(workspaceOfModel);
  }, [workspaceOfModel, current, options, select]);

  return (
    <Page>
      <PageHeader
        title="Mô hình dữ liệu"
        description={
          data === undefined
            ? 'Gắn nhãn ngữ nghĩa cho dữ liệu trong kho, khai quan hệ, rồi hỏi bằng Explorer.'
            : `${data.datasetCount} bảng · ${data.measureCount} thước đo · ${data.relationshipCount} quan hệ`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Create DataModel
              </Button>
            )}
            {canDelete && data !== undefined && (
              <Button onClick={() => setDeleting(true)}>
                <span className="text-red-600">Xoá mô hình</span>
              </Button>
            )}
            {/* §10.1 đặt nút này ở góc phải, và từ §10.8 nó tạo báo cáo dựng
                TRÊN CHÍNH mô hình đang mở. Truyền `datamodelId` xuống là đủ để
                nút bỏ bước hỏi nguồn — người dùng đã trả lời câu đó bằng việc
                mở trang này ra. */}
            {data !== undefined && <CreateReportMenu datamodelId={data.id} />}
          </div>
        }
      >
        {/* Breadcrumb — §10.1. Đốt cuối là ô CHỌN mô hình chứ không phải chữ
            tĩnh: đây là chỗ người dùng nhìn để biết mình đang ở đâu, nên cũng là
            chỗ hợp lý nhất để đổi sang mô hình khác. */}
        <nav className="mt-1 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Đường dẫn">
          <Link to="/datamodels" className="text-brand-700 hover:underline">
            Data Model
          </Link>
          <span aria-hidden="true" className="text-slate-400">
            ›
          </span>
          {models.length > 0 ? (
            <select
              value={activeId ?? ''}
              aria-label="Chọn mô hình dữ liệu"
              onChange={(e) => navigate(`/datamodels/${e.target.value}`)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-800"
            >
              {/* Id trên URL không nằm trong danh sách — mô hình đã bị xoá, hoặc
                  link được chia sẻ từ một workspace khác. Không có mục giữ chỗ
                  này thì trình duyệt hiển thị lựa chọn ĐẦU TIÊN, nên ô chọn khai
                  một cái tên trong khi phần thân báo "không tìm thấy". Tệ hơn:
                  bấm đúng cái tên đang hiện thì `change` không bắn, và người
                  dùng tưởng ô chọn bị hỏng. */}
              {activeId !== null && !models.some((m) => m.id === activeId) && (
                <option value={activeId}>— Không tìm thấy —</option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          ) : (
            <span aria-current="page" className="text-slate-500">
              …
            </span>
          )}
        </nav>

        {/* Thanh tab chỉ tồn tại khi CÓ mô hình để mở. Bốn tab xám không bấm
            được phía trên một lời mời tạo mô hình chỉ là nhiễu — chúng không nói
            thêm điều gì mà chính khung rỗng bên dưới chưa nói. */}
        {activeId !== null && (
          <nav
            className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200"
            aria-label="Mục của mô hình dữ liệu"
          >
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                // Đường dẫn TUYỆT ĐỐI: tab đang mở là route con, nên đường
                // dẫn tương đối tính từ chính nó chứ không từ trang — bấm
                // Relationship hai lần sẽ ra `/datamodels/21/relationship/
                // relationship`.
                to={`/datamodels/${activeId}${tab.to === '' ? '' : `/${tab.to}`}`}
                end={tab.end === true}
                className={({ isActive }) =>
                  `${TAB_CLASS} ${
                    isActive
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        )}
      </PageHeader>

      <PageBody scroll={false}>
        {list.isError && <ErrorState message={getApiError(list.error).message} />}

        {/* Id trên URL không đọc được thành số. Không có mô hình nào để render,
            và đứng lại trên một trang trống thì không dẫn tới đâu — trả người
            dùng về danh sách, nơi họ chọn được cái đúng. */}
        {activeId === null && <Navigate to="/datamodels" replace />}

        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && !isError && activeId !== null && <TableSkeleton rows={6} />}
        {data !== undefined && <Outlet context={data} />}
      </PageBody>

      <CreateDataModelModal open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Xoá mô hình dữ liệu"
        description={data?.name}
        confirmLabel="Xoá mô hình"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (activeId === null) return;
          remove.mutate(activeId, {
            onSuccess: () => {
              setDeleting(false);
              // Về đường dẫn không mang id, để trang tự chọn mô hình còn lại
              // gần nhất thay vì đứng trên một id vừa bị xoá.
              navigate('/datamodels');
            },
            onError,
          });
        }}
      >
        Mô hình bị ẩn khỏi danh sách (xoá mềm) cùng mọi thước đo và quan hệ của nó.{' '}
        <strong>Bộ dữ liệu và kho phân tích không bị đụng tới</strong> — mô hình chỉ là lời mô tả
        về chúng.
      </ConfirmDialog>
    </Page>
  );
}
