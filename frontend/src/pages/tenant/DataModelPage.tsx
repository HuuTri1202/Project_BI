import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { CreateReportMenu } from '../../features/tenant/CreateReportMenu';
import { CreateDataModelModal } from '../../features/datamodels/CreateDataModelModal';
import { useDataModel, useDeleteDataModel } from '../../features/datamodels/hooks';
import { getApiError } from '../../services/apiClient';

/**
 * Trang chi tiết Data Model — §8.1.
 *
 * `/datamodels` là DANH SÁCH (§8.1), `/datamodels/:id` là trang này. Bấm tên
 * model ở bảng danh sách để vào đây.
 *
 * Nhãn để nguyên tiếng Anh — Data Model, Schema, Field, Measure, Dimension đều
 * là thuật ngữ Cube.js, dịch ra sẽ khiến người đọc tài liệu Cube không nối được
 * hai bên. Câu giải thích và thông báo lỗi vẫn tiếng Việt như phần còn lại.
 *
 * ─── Chín tab, bốn cái làm thật ─────────────────────────────────────────────
 *
 * Năm tab còn lại nằm trong đề bài nhưng KHÔNG có mô tả yêu cầu nào, nên xây
 * chúng là tự bịa ra yêu cầu. Chúng hiện ở trạng thái *sắp có*, vô hiệu, đúng
 * khuôn `CreateReportMenu` — kể cả chi tiết dùng `aria-disabled` chứ không phải
 * thuộc tính `disabled`, vì nút `disabled` biến mất khỏi luồng Tab và trình đọc
 * màn hình bỏ qua hoàn toàn, nên người dùng bàn phím không bao giờ biết mục đó
 * tồn tại.
 *
 * Tab chưa xây KHÔNG có route: chúng render `<span>` chứ không phải `NavLink`,
 * nên không có đường nào bấm vào rồi rơi vào 404.
 */

interface TabDef {
  to: string;
  label: string;
  ready: boolean;
  end?: boolean;
}

const TABS: TabDef[] = [
  { to: '', label: 'Schemas', ready: true, end: true },
  { to: 'relationship', label: 'Relationship', ready: true },
  { to: 'measures', label: 'Measures', ready: true },
  { to: 'explorer', label: 'Explorer', ready: true },
  { to: 'blending', label: 'Data Blending', ready: false },
  { to: 'measure-filters', label: 'Measure Filters', ready: false },
  { to: 'formula-measures', label: 'Formula Measures', ready: false },
  { to: 'pre-aggregations', label: 'Pre-Aggregations', ready: false },
  { to: 'rls', label: 'Row-level Security', ready: false },
];

const TAB_CLASS = '-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors';

export default function DataModelPage(): React.ReactElement {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const canEdit = permissions.can('datamodel', 'modify');
  const canDelete = permissions.can('datamodel', 'delete');

  const fromUrl = Number(id);
  const activeId = Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : null;

  const { data, isPending, isError, error } = useDataModel(activeId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteDataModel();


  return (
    <Page>
      <PageHeader
        title={data?.name ?? "Data Model"}
        description={
          data === undefined
            ? 'Manage Data Model'
            : `${data.datasetCount} schemas · ${data.relationshipCount} relationships · ${data.reportCount} reports`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Create Model
              </Button>
            )}
            {canDelete && data !== undefined && (
              <Button onClick={() => setDeleting(true)}>
                <span className="text-red-600">Delete</span>
              </Button>
            )}
            {/* §10.1 đặt nút này ở góc phải. Nó dùng lại `CreateReportMenu` đã
                có chứ không dựng mới — báo cáo dựng TỪ MỘT MÔ HÌNH là việc của
                §11, và bày ra một nút thứ ba đang mờ thì tệ hơn. */}
            <CreateReportMenu />
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
          <span aria-current="page" className="text-slate-500">
            {data?.name ?? '…'}
          </span>
        </nav>

        {/* Chín tab tràn màn hình hẹp, nên dải này tự cuộn ngang. `border-b`
            chạy hết chiều ngang còn tab active đè lên bằng viền riêng. */}
        <nav
          className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200"
          aria-label="Mục của Data Model"
        >
          {TABS.map((tab) =>
            tab.ready && activeId !== null ? (
              <NavLink
                key={tab.to}
                // Điều hướng theo đường dẫn TUYỆT ĐỐI: `/datamodels` và
                // `/datamodels/:id` là hai nhánh route khác nhau, nên đường dẫn
                // tương đối sẽ ra kết quả khác nhau ở hai nhánh.
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
            ) : (
              <span
                key={tab.to}
                aria-disabled="true"
                tabIndex={0}
                title={
                  tab.ready
                    ? 'Chưa mở model nào'
                    : 'Chức năng này chưa được xây dựng'
                }
                className={`${TAB_CLASS} flex cursor-not-allowed items-center gap-1.5 border-transparent text-slate-400`}
              >
                {tab.label}
                {!tab.ready && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    sắp có
                  </span>
                )}
              </span>
            ),
          )}
        </nav>
      </PageHeader>

      <PageBody scroll={false}>
        {activeId === null && (
          <ErrorState message="Địa chỉ không hợp lệ — không có model nào ứng với đường dẫn này." />
        )}
        {activeId !== null && isError && <ErrorState message={getApiError(error).message} />}
        {activeId !== null && isPending && !isError && <TableSkeleton rows={6} />}
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
