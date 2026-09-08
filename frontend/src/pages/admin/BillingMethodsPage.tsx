import { PAYMENT_PROVIDER_LABELS } from '@bi/shared';
import { useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import type { AdminPaymentMethodDto } from '../../features/admin/billing/api';
import {
  useAdminPaymentMethods,
  useUpdatePaymentMethod,
} from '../../features/admin/billing/hooks';
import { getApiError } from '../../services/apiClient';

/**
 * Cấu hình phương thức thanh toán — §11 mục 3.2.
 *
 * ═══ Đây là màn hình phải làm xong TRƯỚC khi bán được gói nào ══════════════
 *
 * Migration cố ý gieo phương thức chuyển khoản với số tài khoản để TRỐNG — số
 * tài khoản là dữ liệu vận hành thật, không thuộc mã nguồn. Nên ở mọi lần cài
 * mới, đây là bước đầu tiên, và `POST /orders` từ chối tạo đơn cho tới khi nó
 * xong.
 *
 * ═══ Khoá bí mật: chỉ HIỆN bốn ký tự cuối, chỉ GỬI khi đổi ════════════════
 *
 * Backend không bao giờ trả khoá đầy đủ. Ô nhập để trống nghĩa là "giữ nguyên"
 * — bắt gửi lại khoá mỗi lần sửa một chữ trong tên hiển thị nghĩa là ai muốn
 * đổi tên cũng phải biết khoá API, thứ mà người dựng cấu hình ban đầu có thể đã
 * không chia sẻ.
 */

function MethodModal({
  method,
  onClose,
}: {
  method: AdminPaymentMethodDto | null;
  onClose: () => void;
}): React.ReactElement {
  const update = useUpdatePaymentMethod();

  const [name, setName] = useState('');
  const [bin, setBin] = useState('');
  const [accNo, setAccNo] = useState('');
  const [accName, setAccName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [secret, setSecret] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);

  if (method !== null && method.id !== lastId) {
    setLastId(method.id);
    setName(method.name);
    setBin(method.bankBin ?? '');
    setAccNo(method.bankAccountNo ?? '');
    setAccName(method.bankAccountName ?? '');
    setInstructions(method.instructions ?? '');
    // Ô khoá bí mật LUÔN mở ra rỗng, kể cả khi đã có khoá. Điền sẵn một chuỗi
    // giả (`••••`) sẽ khiến người dùng bấm Lưu và vô tình gửi chuỗi đó lên.
    setSecret('');
    setLoi(null);
  }

  function submit(): void {
    if (method === null) return;
    setLoi(null);

    /*
     * Dọn dấu phân cách TRƯỚC khi kiểm và trước khi gửi.
     *
     * `trim()` một mình chỉ cắt hai đầu, nên `"0011 0045 67890"` — đúng cách
     * người ta dán từ ứng dụng ngân hàng — vẫn còn khoảng trắng ở giữa và bị
     * server từ chối. Backend cũng dọn (xem `bankField` trong admin/schemas),
     * và cả hai cùng dọn là chủ ý: server là chỗ ràng buộc SỐNG, còn ở đây dọn
     * sớm để người dùng thấy ngay giá trị thật sự được lưu.
     */
    const gonBin = bin.replace(/[\s.-]/g, '');
    const gonAcc = accNo.replace(/[\s.-]/g, '');

    if (gonBin !== '' && !/^\d{6}$/.test(gonBin)) {
      return setLoi('Mã ngân hàng phải là đúng 6 chữ số (BIN theo NAPAS).');
    }
    if (gonAcc !== '' && !/^[0-9A-Za-z]{4,32}$/.test(gonAcc)) {
      return setLoi('Số tài khoản chỉ gồm chữ và số, dài 4–32 ký tự.');
    }

    update.mutate(
      {
        id: method.id,
        input: {
          name: name.trim(),
          instructions: instructions.trim() === '' ? null : instructions.trim(),
          bankBin: gonBin === '' ? null : gonBin,
          bankAccountNo: gonAcc === '' ? null : gonAcc,
          bankAccountName: accName.trim() === '' ? null : accName.trim(),
          // Bỏ trống = GIỮ NGUYÊN. Không gửi trường này lên khi rỗng.
          ...(secret.trim() === '' ? {} : { webhookSecret: secret.trim() }),
        },
      },
      { onSuccess: onClose, onError: (err) => setLoi(getApiError(err).message) },
    );
  }

  return (
    <Modal
      open={method !== null}
      onClose={onClose}
      title={method === null ? '' : `Cấu hình ${method.name}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={update.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loi !== null && <ErrorState message={loi} />}

        <Field label="Tên hiển thị" value={name} onChange={(e) => setName(e.target.value)} />

        <p className="text-xs font-medium text-slate-600">
          Tài khoản nhận tiền — thông tin này được in lên chính mã QR khách quét.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Mã ngân hàng (BIN)"
            hint="6 chữ số theo NAPAS. Vietcombank 970436, Techcombank 970407, MB 970422."
            value={bin}
            onChange={(e) => setBin(e.target.value)}
          />
          <Field
            label="Số tài khoản"
            hint="Dán thoải mái — khoảng trắng và dấu gạch được bỏ tự động."
            value={accNo}
            onChange={(e) => setAccNo(e.target.value)}
          />
        </div>
        <Field
          label="Tên chủ tài khoản"
          hint="Viết không dấu, đúng như trên sao kê ngân hàng."
          value={accName}
          onChange={(e) => setAccName(e.target.value)}
        />

        <Field
          label="Hướng dẫn hiện cho khách"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <Field
          label="Khoá bí mật webhook"
          hint={
            method?.webhookSecretHint === null || method === null
              ? 'Chưa cấu hình. Chỉ cần khi dùng cổng có webhook (PayOS, Sepay, MoMo).'
              : `Đang dùng khoá kết thúc bằng "${method.webhookSecretHint}". Để trống = giữ nguyên.`
          }
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export default function BillingMethodsPage(): React.ReactElement {
  const { data, isPending, isError, error } = useAdminPaymentMethods();
  const [editing, setEditing] = useState<AdminPaymentMethodDto | null>(null);

  return (
    <Page>
      <PageHeader
        title="Phương thức thanh toán"
        description="Tài khoản nhận tiền và khoá bí mật của các cổng. Chưa cấu hình thì không tạo được đơn nào."
      />

      <PageBody>
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton rows={2} />}

        {data !== undefined && (
          <div className="space-y-3">
            {data.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">{m.name}</h2>
                      <Badge tone="neutral">{PAYMENT_PROVIDER_LABELS[m.provider]}</Badge>
                      {/*
                        Hai nhãn khác nhau, và khác biệt đó quan trọng: "Đang
                        bật" mà chưa cấu hình đủ thì khách bấm mua sẽ nhận lỗi —
                        nên phải nói ra chứ không chỉ hiện màu xanh.
                      */}
                      <Badge tone={m.isConfigured ? 'success' : 'warning'}>
                        {m.isConfigured ? 'Sẵn sàng' : 'Chưa cấu hình đủ'}
                      </Badge>
                    </div>
                    {m.instructions !== null && (
                      <p className="mt-1 text-sm text-slate-500">{m.instructions}</p>
                    )}
                  </div>
                  <Button onClick={() => setEditing(m)}>Cấu hình</Button>
                </div>

                <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Ngân hàng (BIN)</dt>
                    <dd className="font-mono text-slate-800">{m.bankBin ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Số tài khoản</dt>
                    <dd className="font-mono text-slate-800">{m.bankAccountNo ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Chủ tài khoản</dt>
                    <dd className="text-right text-slate-800">{m.bankAccountName ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Khoá webhook</dt>
                    <dd className="font-mono text-slate-800">
                      {/* Bốn ký tự cuối, do backend cắt. Đủ để nhận ra khoá vừa
                          dán, không đủ để dựng lại nó. */}
                      {m.webhookSecretHint === null ? '—' : `••••${m.webhookSecretHint}`}
                    </dd>
                  </div>
                </dl>

                {!m.isConfigured && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Thiếu thông tin tài khoản nhận tiền, nên chưa tổ chức nào tạo được đơn qua
                    phương thức này.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <MethodModal method={editing} onClose={() => setEditing(null)} />
      </PageBody>
    </Page>
  );
}
