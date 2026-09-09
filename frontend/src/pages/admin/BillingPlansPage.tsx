import type { PlanDto } from '@bi/shared';
import { useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { TBody, TableWrap, Td, THead, Th, Tr } from '../../components/ui/Table';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import type { PlanWriteInput } from '../../features/admin/billing/api';
import {
  useAdminPlans,
  useCreatePlan,
  useDeletePlan,
  useUpdatePlan,
} from '../../features/admin/billing/hooks';
import { dinhDangHanMuc, dinhDangTien } from '../../features/billing/format';
import { getApiError } from '../../services/apiClient';

/**
 * Quản lý bảng giá — §11 mục 3.1.
 *
 * ═══ Ô trống nghĩa là KHÔNG GIỚI HẠN ══════════════════════════════════════
 *
 * Bốn ô hạn mức để trống thì gửi lên `null`, và `null` là "không giới hạn".
 * KHÔNG dùng `0` cho ý đó — `0` mang nghĩa ngược lại ("không được tạo cái
 * nào"), và một cột mang hai nghĩa đối nghịch là thứ code sẽ chọn sai.
 *
 * Chú thích dưới mỗi ô nói ra điều này, vì nó không tự hiển nhiên với người
 * đang điền form.
 */

/** Chuỗi rỗng -> `null` (không giới hạn); còn lại -> số. */
function toLimit(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function limitToText(value: number | null): string {
  return value === null ? '' : String(value);
}

interface FormState {
  code: string;
  name: string;
  description: string;
  priceVnd: string;
  durationDays: string;
  maxWorkspaces: string;
  maxReports: string;
  maxMembers: string;
  maxStorageGb: string;
  isPublic: boolean;
  isFeatured: boolean;
  sortOrder: string;
}

const GB = 1024 * 1024 * 1024;

function emptyForm(): FormState {
  return {
    code: '',
    name: '',
    description: '',
    priceVnd: '0',
    durationDays: '30',
    maxWorkspaces: '',
    maxReports: '',
    maxMembers: '',
    maxStorageGb: '',
    isPublic: true,
    isFeatured: false,
    sortOrder: '0',
  };
}

function formFrom(plan: PlanDto): FormState {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? '',
    priceVnd: String(plan.priceVnd),
    durationDays: String(plan.durationDays),
    maxWorkspaces: limitToText(plan.maxWorkspaces),
    maxReports: limitToText(plan.maxReports),
    maxMembers: limitToText(plan.maxMembers),
    // Nhập bằng GB cho người đọc, đổi sang byte khi gửi. Bắt người vận hành gõ
    // 5368709120 là mời một lỗi thêm bớt số 0 mà không ai phát hiện.
    maxStorageGb: plan.maxStorageBytes === null ? '' : String(plan.maxStorageBytes / GB),
    isPublic: plan.isPublic,
    isFeatured: plan.isFeatured,
    sortOrder: String(plan.sortOrder),
  };
}

function PlanModal({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  /** `null` = tạo mới. */
  plan: PlanDto | null;
  onClose: () => void;
}): React.ReactElement {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loi, setLoi] = useState<string | null>(null);
  const [lastId, setLastId] = useState<number | null | undefined>(undefined);

  // Nạp lại mỗi lần mở với một gói khác. `Modal` không bị tháo khỏi cây khi
  // đóng, nên state sống qua các lần đóng mở.
  const key = plan?.id ?? null;
  if (open && key !== lastId) {
    setLastId(key);
    setForm(plan === null ? emptyForm() : formFrom(plan));
    setLoi(null);
  }

  const set = (patch: Partial<FormState>): void => setForm((prev) => ({ ...prev, ...patch }));

  function submit(): void {
    setLoi(null);

    const gia = Number(form.priceVnd);
    const ngay = Number(form.durationDays);
    if (form.name.trim() === '') return setLoi('Hãy đặt tên cho gói.');
    if (!Number.isInteger(gia) || gia < 0) return setLoi('Giá phải là số nguyên không âm.');
    if (!Number.isInteger(ngay) || ngay < 0) return setLoi('Số ngày phải là số nguyên không âm.');

    const gb = toLimit(form.maxStorageGb);
    const input: PlanWriteInput = {
      name: form.name.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      priceVnd: gia,
      durationDays: ngay,
      maxWorkspaces: toLimit(form.maxWorkspaces),
      maxReports: toLimit(form.maxReports),
      maxMembers: toLimit(form.maxMembers),
      maxStorageBytes: gb === null ? null : gb * GB,
      isPublic: form.isPublic,
      isFeatured: form.isFeatured,
      sortOrder: Number(form.sortOrder) || 0,
    };

    const onError = (err: unknown): void => setLoi(getApiError(err).message);

    if (plan === null) {
      create.mutate({ ...input, code: form.code.trim() }, { onSuccess: onClose, onError });
    } else {
      update.mutate({ id: plan.id, input }, { onSuccess: onClose, onError });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan === null ? 'Thêm gói dịch vụ' : `Sửa gói ${plan.name}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={create.isPending || update.isPending}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loi !== null && <ErrorState message={loi} />}

        {plan === null ? (
          <Field
            label="Mã gói"
            hint="Chữ thường, số và gạch dưới. KHÔNG đổi được sau khi tạo — mã này được chụp vào mọi đơn hàng."
            value={form.code}
            onChange={(e) => set({ code: e.target.value })}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Mã gói <code className="rounded bg-slate-100 px-1.5 py-0.5">{plan.code}</code> không
            đổi được: nó đã được chụp vào những đơn hàng cũ.
          </p>
        )}

        <Field label="Tên gói" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        <Field
          label="Mô tả"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Giá (đồng)"
            hint="Số nguyên, đơn vị đồng. Không nhân 100."
            value={form.priceVnd}
            onChange={(e) => set({ priceVnd: e.target.value })}
          />
          <Field
            label="Số ngày một chu kỳ"
            hint="30 = một tháng. Chu kỳ năm tính bằng 12 lần số này."
            value={form.durationDays}
            onChange={(e) => set({ durationDays: e.target.value })}
          />
        </div>

        <p className="text-xs font-medium text-slate-600">
          Hạn mức — <strong>để trống nghĩa là không giới hạn</strong>, đừng điền 0.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Workspace tối đa"
            value={form.maxWorkspaces}
            onChange={(e) => set({ maxWorkspaces: e.target.value })}
          />
          <Field
            label="Báo cáo tối đa"
            value={form.maxReports}
            onChange={(e) => set({ maxReports: e.target.value })}
          />
          <Field
            label="Thành viên tối đa"
            value={form.maxMembers}
            onChange={(e) => set({ maxMembers: e.target.value })}
          />
          <Field
            label="Dung lượng (GB)"
            value={form.maxStorageGb}
            onChange={(e) => set({ maxStorageGb: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => set({ isPublic: e.target.checked })}
              className="rounded border-slate-300"
            />
            Hiện trên bảng giá
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(e) => set({ isFeatured: e.target.checked })}
              className="rounded border-slate-300"
            />
            Đánh dấu phổ biến
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Thứ tự
            <input
              type="text"
              value={form.sortOrder}
              onChange={(e) => set({ sortOrder: e.target.value })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}

export default function BillingPlansPage(): React.ReactElement {
  const { data, isPending, isError, error } = useAdminPlans();
  const remove = useDeletePlan();

  const [editing, setEditing] = useState<PlanDto | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<PlanDto | null>(null);

  return (
    <Page width="full">
      <PageHeader
        title="Gói dịch vụ"
        description="Bảng giá áp cho mọi tổ chức. Đổi giá KHÔNG ảnh hưởng những đơn đã tạo."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Thêm gói
          </Button>
        }
      />

      <PageBody scroll={false}>
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton rows={3} />}

        {data !== undefined && (
          <TableWrap fill>
            <THead>
              <Tr>
                <Th>Mã</Th>
                <Th>Tên</Th>
                <Th>Giá / chu kỳ</Th>
                <Th>Workspace</Th>
                <Th>Báo cáo</Th>
                <Th>Dung lượng</Th>
                <Th>Trạng thái</Th>
                <Th> </Th>
              </Tr>
            </THead>
            <TBody>
              {data.map((plan) => (
                <Tr key={plan.id}>
                  <Td>
                    <code className="text-xs text-slate-700">{plan.code}</code>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-800">{plan.name}</span>
                    {plan.isFeatured && (
                      <span className="ml-2">
                        <Badge tone="brand">phổ biến</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-sm tabular-nums text-slate-700">
                      {dinhDangTien(plan.priceVnd)}
                    </span>
                    <span className="ml-1 text-xs text-slate-400">/{plan.durationDays}n</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">
                      {dinhDangHanMuc(plan.maxWorkspaces)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">{dinhDangHanMuc(plan.maxReports)}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-600">
                      {dinhDangHanMuc(plan.maxStorageBytes, true)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={plan.isPublic ? 'success' : 'neutral'}>
                      {plan.isPublic ? 'Đang bán' : 'Đã ẩn'}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(plan);
                          setOpen(true);
                        }}
                      >
                        Sửa
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(plan)}>
                        Xoá
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        )}

        <PlanModal open={open} plan={editing} onClose={() => setOpen(false)} />

        <ConfirmDialog
          open={removing !== null}
          onClose={() => setRemoving(null)}
          title="Ẩn gói dịch vụ"
          description={removing?.name}
          confirmLabel="Ẩn gói"
          danger
          loading={remove.isPending}
          onConfirm={(onError) => {
            if (removing === null) return;
            remove.mutate(removing.id, { onSuccess: () => setRemoving(null), onError });
          }}
        >
          Gói bị ẩn khỏi bảng giá và không mua được nữa. <strong>Đơn hàng cũ và tổ chức đang
          dùng gói này KHÔNG bị ảnh hưởng</strong> — dòng gói vẫn còn để những đơn đó trỏ tới.
        </ConfirmDialog>
      </PageBody>
    </Page>
  );
}
