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
import { dinhDangDungLuong, dinhDangHanMuc, dinhDangTien } from '../../features/billing/format';
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

/**
 * Đọc một ô hạn mức: `null` = KHÔNG GIỚI HẠN, `undefined` = gõ sai.
 *
 * ═══ Vì sao phải phân biệt hai thứ đó ══════════════════════════════════════
 *
 * Bản trước trả `null` cho CẢ ô trống lẫn giá trị không đọc được. Ô trống nghĩa
 * là "không giới hạn", nên gõ `abc` hay `0.5` vào "Workspace tối đa" sẽ lặng lẽ
 * cấp cho gói đó **vô hạn workspace** — không báo lỗi, không hiện gì, và người
 * vận hành rời màn hình tin rằng mình vừa đặt một hạn mức.
 *
 * Nó dễ xảy ra hơn vẻ ngoài: ô dung lượng trước đây tính bằng GB, nên một gói
 * 500 MB hiện ra là `0.48828125`. Chỉ cần mở hộp thoại đó lên sửa tên gói rồi
 * bấm Lưu là dung lượng thành vô hạn.
 *
 * `undefined` tách bạch cho `submit` có chỗ dừng lại và nói ra.
 */
function docHanMuc(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
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
  maxStorage: string;
  donViDungLuong: DonViDungLuong;
  isPublic: boolean;
  isFeatured: boolean;
  sortOrder: string;
}

type DonViDungLuong = 'MB' | 'GB';

/**
 * Đơn vị NHẬP LIỆU của ô dung lượng. Database vẫn lưu BYTE.
 *
 * ═══ Vì sao cho CHỌN đơn vị thay vì chốt một cái ═══════════════════════════
 *
 * Bắt người vận hành gõ `5368709120` là mời một lỗi thêm bớt số 0 mà không ai
 * phát hiện, nên ô này phải nhận một đơn vị người đọc được. Nhưng mọi đơn vị
 * đơn lẻ đều hỏng ở một đầu, vì `docHanMuc` chỉ nhận SỐ NGUYÊN:
 *
 *   - Chốt GB: gói 500 MB thành `0.48828125` → bị từ chối, không gõ nổi.
 *   - Chốt MB: gói 50 GB thành `51200` → gõ được, nhưng người vận hành phải tự
 *     nhân 1024 trong đầu, và một con số 5 chữ số thì sai một chữ cũng không
 *     nhìn ra.
 *
 * Nên đơn vị là một lựa chọn của người điền: họ gõ con số họ đang nghĩ (`500`
 * hoặc `50`) rồi chỉ vào đơn vị của nó. Không còn phép nhân nào phải làm tay.
 *
 * ─── Đổi đơn vị KHÔNG đổi con số đã gõ ─────────────────────────────────────
 *
 * Bấm sang GB khi ô đang là `500` cho ra 500 GB, chứ không quy `500 MB` thành
 * `0.48828125`. Hai nút này khai Ý NGHĨA của con số, không phải cách xem nó.
 *
 * Hướng còn lại nghe "bảo toàn giá trị" hơn nhưng tự chặn chính nó: quy đổi
 * 500 MB sang GB luôn ra số thập phân, mà số thập phân thì bị từ chối — nên
 * người muốn chuyển một gói MB sang đơn vị GB sẽ mắc kẹt ở một form không lưu
 * được, đúng vào thao tác mà hai cái nút này sinh ra để phục vụ.
 *
 * Bù lại, bấm nhầm đơn vị là lệch 1024 lần, nên nó KHÔNG được âm thầm: gợi ý
 * dưới ô luôn hiện lại kích thước qua `dinhDangDungLuong` — đúng hàm mà bảng giá
 * dùng — nên con số khách sẽ thấy nằm ngay trước mắt người đang điền.
 *
 * 1024 chứ không 1000, khớp với `dinhDangDungLuong`. Lệch nhau thì gõ 10240 MB
 * rồi màn hình hiện "10,7 GB", và người vận hành sẽ sửa đi sửa lại một con số
 * vốn đã đúng.
 */
const DON_VI: Record<DonViDungLuong, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

/**
 * Chọn đơn vị để MỞ một gói đã có: đơn vị lớn nhất mà con số còn là số nguyên.
 *
 * Gói `pro` (5368709120 byte) mở ra là `5` + GB chứ không phải `5120` + MB, vì
 * con số người vận hành đang nghĩ trong đầu là "5 GB". Gói `free` (104857600)
 * không chia hết cho GB nên mở ra `100` + MB.
 *
 * ⚠️ Byte lẻ tới mức không tròn cả MB (chỉ xảy ra nếu ai đó ghi thẳng vào
 * database) thì ô hiện số thập phân và `submit` TỪ CHỐI, kèm tên ô. Cố ý ồn ào:
 * tự làm tròn ở đây là lặng lẽ đổi hạn mức của một gói đang bán, chỉ vì có người
 * mở hộp thoại ra sửa cái tên.
 */
function doDungLuong(bytes: number | null): {
  maxStorage: string;
  donViDungLuong: DonViDungLuong;
} {
  if (bytes === null) return { maxStorage: '', donViDungLuong: 'MB' };
  if (bytes % DON_VI.GB === 0) {
    return { maxStorage: String(bytes / DON_VI.GB), donViDungLuong: 'GB' };
  }
  return { maxStorage: String(bytes / DON_VI.MB), donViDungLuong: 'MB' };
}

/** Hai nút khai đơn vị của con số vừa gõ — xem khối `DON_VI` ở trên. */
function NutDonVi({
  value,
  onChange,
}: {
  value: DonViDungLuong;
  onChange: (donVi: DonViDungLuong) => void;
}): React.ReactElement {
  return (
    <span className="flex overflow-hidden rounded-md border border-slate-300">
      {(Object.keys(DON_VI) as DonViDungLuong[]).map((donVi) => (
        <button
          key={donVi}
          type="button"
          // `aria-pressed` chứ không chỉ đổi màu: trình đọc màn hình không thấy
          // được nền xanh, và đơn vị là nửa còn lại của giá trị đang điền.
          aria-pressed={value === donVi}
          onClick={() => onChange(donVi)}
          className={`px-2 py-1 text-xs font-medium transition-colors ${
            value === donVi
              ? 'bg-brand-500 text-white'
              : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          {donVi}
        </button>
      ))}
    </span>
  );
}

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
    maxStorage: '',
    donViDungLuong: 'MB',
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
    // Số + đơn vị người đọc được, đổi sang byte khi gửi — xem `DON_VI`.
    ...doDungLuong(plan.maxStorageBytes),
    isPublic: plan.isPublic,
    isFeatured: plan.isFeatured,
    sortOrder: String(plan.sortOrder),
  };
}

/** Xuất ra để test được luật đơn vị và luật hạn mức mà không phải dựng cả trang. */
export function PlanModal({
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

  /*
   * Gợi ý dưới ô dung lượng: kích thước mà KHÁCH sẽ đọc được.
   *
   * Nó tồn tại vì bấm nhầm MB/GB lệch 1024 lần mà con số trên màn hình không đổi
   * gì cả. Dòng này đổi, nên cái nhầm đó có chỗ lộ ra ngay lúc đang điền thay vì
   * nằm lại trong bảng giá.
   *
   * Cố ý dùng chính `dinhDangDungLuong` của bảng giá chứ không tự viết lại phép
   * chia: một cách tính thứ hai ở đây sẽ là chỗ để hai màn hình nói hai con số.
   */
  const soDungLuong = docHanMuc(form.maxStorage);
  const goiYDungLuong =
    soDungLuong === undefined
      ? 'Phải là số nguyên — hãy đổi đơn vị thay vì gõ số lẻ.'
      : soDungLuong === null
        ? 'Để trống = không giới hạn.'
        : `Khách thấy: ${dinhDangDungLuong(soDungLuong * DON_VI[form.donViDungLuong])}`;

  function submit(): void {
    setLoi(null);

    const gia = Number(form.priceVnd);
    const ngay = Number(form.durationDays);
    if (form.name.trim() === '') return setLoi('Hãy đặt tên cho gói.');
    if (!Number.isInteger(gia) || gia < 0) return setLoi('Giá phải là số nguyên không âm.');
    if (!Number.isInteger(ngay) || ngay < 0) return setLoi('Số ngày phải là số nguyên không âm.');

    /*
     * Bốn ô hạn mức đọc CÙNG một kiểu, và ô nào gõ sai thì dừng ngay — xem
     * `docHanMuc`. Để trống vẫn hợp lệ: đó là cách khai "không giới hạn".
     */
    const hanMuc = [
      ['Workspace tối đa', form.maxWorkspaces],
      ['Báo cáo tối đa', form.maxReports],
      ['Thành viên tối đa', form.maxMembers],
      ['Dung lượng', form.maxStorage],
    ] as const;
    for (const [nhan, raw] of hanMuc) {
      if (docHanMuc(raw) === undefined) {
        return setLoi(`"${nhan}" phải là số nguyên không âm, hoặc để trống nếu không giới hạn.`);
      }
    }

    const dungLuong = docHanMuc(form.maxStorage) ?? null;
    const input: PlanWriteInput = {
      name: form.name.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      priceVnd: gia,
      durationDays: ngay,
      maxWorkspaces: docHanMuc(form.maxWorkspaces) ?? null,
      maxReports: docHanMuc(form.maxReports) ?? null,
      maxMembers: docHanMuc(form.maxMembers) ?? null,
      maxStorageBytes: dungLuong === null ? null : dungLuong * DON_VI[form.donViDungLuong],
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
            label="Dung lượng"
            hint={goiYDungLuong}
            value={form.maxStorage}
            onChange={(e) => set({ maxStorage: e.target.value })}
            suffix={
              <NutDonVi
                value={form.donViDungLuong}
                onChange={(donViDungLuong) => set({ donViDungLuong })}
              />
            }
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
