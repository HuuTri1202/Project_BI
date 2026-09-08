import { ORDER_STATUSES_LIVE, type BillingCycle } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '../../../components/ui/Button';
import { ErrorState, TableSkeleton } from '../../../components/ui/states';
import { QrCode } from '../../../features/billing/QrCode';
import { conLai, dinhDangTien } from '../../../features/billing/format';
import {
  useCancelOrder,
  useCreateOrder,
  useOrder,
  useOrderStatus,
  usePaymentMethods,
  usePlans,
} from '../../../features/billing/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Màn thanh toán — §11.
 *
 * ═══ Trình duyệt KHÔNG BAO GIỜ tự đánh dấu đã thanh toán ═══════════════════
 *
 * Nó chỉ HỎI trạng thái mỗi ba giây và hiện lại thứ server trả về. Việc chuyển
 * một đơn sang `paid` là của webhook hoặc của người vận hành đối chiếu sao kê —
 * không có nút nào ở đây làm được điều đó, và cũng không có endpoint nào để
 * làm. Một nút "tôi đã chuyển tiền rồi" đổi trạng thái là cho không dịch vụ.
 *
 * ═══ Hai giai đoạn trong MỘT màn ══════════════════════════════════════════
 *
 *   /billing/checkout/:planId   chưa có đơn -> chọn phương thức rồi bấm tạo
 *   /billing/orders/:code       đã có đơn   -> hiện mã QR và chờ
 *
 * Tách làm hai route thật (không phải state) vì mã đơn PHẢI nằm trong URL:
 * người dùng đóng tab giữa chừng, hoặc gửi link cho kế toán, và phải quay lại
 * đúng mã QR đó. Một `useState` sẽ mất trắng ở lần F5 đầu tiên.
 */

/** Đồng hồ đếm ngược, cập nhật mỗi giây. */
function useDongHo(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Giai đoạn 1: chọn phương thức và tạo đơn ────────────────────────────────

export function CheckoutPage(): React.ReactElement {
  const { planId } = useParams<{ planId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const cycle: BillingCycle = params.get('cycle') === 'yearly' ? 'yearly' : 'monthly';

  const plans = usePlans();
  const methods = usePaymentMethods();
  const create = useCreateOrder();

  const [methodId, setMethodId] = useState<number | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  const plan = plans.data?.find((p) => String(p.id) === planId);
  const sanSang = (methods.data ?? []).filter((m) => m.isConfigured);

  // Chỉ có một phương thức dùng được thì chọn sẵn: bắt người dùng bấm vào lựa
  // chọn duy nhất là hỏi một câu chỉ có một câu trả lời.
  useEffect(() => {
    if (methodId === null && sanSang.length === 1) setMethodId(sanSang[0]?.id ?? null);
  }, [methodId, sanSang]);

  if (plans.isPending || methods.isPending) return <TableSkeleton rows={4} />;

  if (plan === undefined) {
    return (
      <ErrorState message="Không tìm thấy gói này. Có thể nó vừa được gỡ khỏi bảng giá." />
    );
  }

  function taoDon(): void {
    setLoi(null);
    if (methodId === null) {
      setLoi('Hãy chọn một phương thức thanh toán.');
      return;
    }

    create.mutate(
      { planId: Number(planId), paymentMethodId: methodId, cycle },
      {
        // Đưa thẳng tới màn chờ tiền, và URL mang mã đơn — đóng tab rồi mở lại
        // vẫn về đúng chỗ.
        onSuccess: (order) => navigate(`/billing/orders/${order.orderCode}`),
        onError: (err) => setLoi(getApiError(err).message),
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 overflow-y-auto pr-1">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Xác nhận đơn hàng</h2>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Gói</dt>
            <dd className="font-medium text-slate-900">{plan.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Chu kỳ</dt>
            <dd className="text-slate-700">{cycle === 'yearly' ? '12 tháng' : '1 tháng'}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2">
            <dt className="font-medium text-slate-700">Tổng cộng</dt>
            {/*
              Số tiền hiện ở đây là con số backend sẽ chốt, nhưng nó được TÍNH
              LẠI ở backend chứ không nhận từ đây — xem `createOrderBodySchema`.
              Nếu hai bên lệch, người dùng thấy giá khác lúc bấm, chứ không bị
              tính sai tiền.
            */}
            <dd className="text-lg font-bold tabular-nums text-slate-900">
              {dinhDangTien(cycle === 'yearly' ? plan.priceVnd * 10 : plan.priceVnd)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Phương thức thanh toán</h2>

        {sanSang.length === 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Hệ thống chưa cấu hình phương thức thanh toán nào. Hãy báo quản trị viên hệ thống
            điền thông tin tài khoản nhận tiền.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {sanSang.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  methodId === m.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  checked={methodId === m.id}
                  onChange={() => setMethodId(m.id)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{m.name}</span>
                  {m.instructions !== null && (
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                      {m.instructions}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {loi !== null && <ErrorState message={loi} />}

      <div className="flex gap-2">
        <Link to="/billing/plans">
          <Button>Quay lại</Button>
        </Link>
        <Button
          variant="primary"
          onClick={taoDon}
          loading={create.isPending}
          disabled={sanSang.length === 0}
        >
          Tạo đơn thanh toán
        </Button>
      </div>
    </div>
  );
}

// ─── Giai đoạn 2: chờ tiền về ────────────────────────────────────────────────

export function OrderDetailPage(): React.ReactElement {
  const { code } = useParams<{ code: string }>();
  const now = useDongHo();

  const order = useOrder(code ?? null);
  const cancel = useCancelOrder();

  /*
   * Trạng thái đến từ endpoint NHẸ, không từ `useOrder`.
   *
   * `useOrder` trả cả chuỗi QR — vài trăm byte, và ta hỏi lại mỗi ba giây. Chỉ
   * dừng vòng hỏi khi đơn rời khỏi `ORDER_STATUSES_LIVE`, danh sách lấy từ
   * `@bi/shared` để giao diện và backend không nói hai đằng.
   */
  const status = useOrderStatus(code ?? null);
  const hienTai = status.data?.status ?? order.data?.status;

  if (order.isError) return <ErrorState message={getApiError(order.error).message} />;
  if (order.isPending || order.data === undefined) return <TableSkeleton rows={4} />;

  const don = order.data;
  const conCho = hienTai !== undefined && ORDER_STATUSES_LIVE.includes(hienTai);
  const conThoiGian = conLai(don.expiresAt, now);

  // ─── Đã thanh toán ────────────────────────────────────────────────────────
  if (hienTai === 'paid') {
    return (
      <div className="mx-auto w-full max-w-lg overflow-y-auto pr-1">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-base font-semibold text-green-900">Thanh toán thành công</p>
          <p className="mt-1 text-sm text-green-800">
            Gói <strong>{don.planName}</strong> đã có hiệu lực ngay.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/billing">
              <Button variant="primary">Xem gói của tôi</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Đơn đã đóng vì lý do khác ────────────────────────────────────────────
  if (!conCho) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4 overflow-y-auto pr-1">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-base font-semibold text-slate-900">
            Đơn <span className="font-mono">{don.orderCode}</span> đã đóng
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {hienTai === 'expired'
              ? 'Đơn đã quá hạn thanh toán. Hãy tạo đơn mới — thao tác này không mất phí.'
              : 'Đơn không còn ở trạng thái chờ thanh toán.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/billing/plans">
              <Button variant="primary">Chọn gói khác</Button>
            </Link>
            <Link to="/billing/orders">
              <Button>Xem lịch sử đơn</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Đang chờ tiền ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 overflow-y-auto pr-1">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col items-center">
          {don.qrPayload !== null ? (
            <QrCode
              value={don.qrPayload}
              label={`Mã QR chuyển khoản ${dinhDangTien(don.amountVnd)}, nội dung ${don.orderCode}`}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Đơn này không có mã QR. Hãy chuyển khoản thủ công theo thông tin bên dưới.
            </p>
          )}

          <p className="mt-3 text-center text-sm text-slate-600">
            Quét mã bằng ứng dụng ngân hàng — số tiền và nội dung đã điền sẵn.
          </p>

          {/*
            Đồng hồ đếm ngược là thông tin THẬT, không phải sức ép bán hàng:
            `expiresAt` là một mốc tuyệt đối do server đặt, và hết giờ thì đơn
            thành `expired` thật.
          */}
          {conThoiGian !== null ? (
            <p className="mt-2 text-sm text-slate-500">
              Mã còn hiệu lực <strong className="tabular-nums text-slate-900">{conThoiGian}</strong>
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700">
              Đơn đã quá hạn. Màn hình sẽ tự cập nhật trong giây lát.
            </p>
          )}
        </div>
      </div>

      {/* Chuyển khoản thủ công: không phải ai cũng quét được QR, và người dùng
          máy tính bàn thì phải tự gõ. Mã đơn để chữ to và font đơn cách vì đây
          là chuỗi họ phải chép chính xác. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Hoặc chuyển khoản thủ công</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {don.bankAccountNo !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Số tài khoản</dt>
              <dd className="font-mono text-slate-900">{don.bankAccountNo}</dd>
            </div>
          )}
          {don.bankAccountName !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Chủ tài khoản</dt>
              <dd className="text-right text-slate-900">{don.bankAccountName}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Số tiền</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {dinhDangTien(don.amountVnd)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
            <dt className="text-slate-500">Nội dung</dt>
            <dd className="font-mono text-base font-bold text-slate-900">{don.orderCode}</dd>
          </div>
        </dl>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-600">
          Nội dung chuyển khoản phải là <strong>đúng mã đơn</strong>, không thêm bớt ký tự nào —
          hệ thống đối chiếu bằng chuỗi này. Đơn được kích hoạt sau khi quản trị viên xác nhận đã
          nhận tiền.
        </p>
      </div>

      <div className="flex justify-between gap-2">
        <Link to="/billing/orders">
          <Button>Để sau</Button>
        </Link>
        <Button
          variant="danger"
          loading={cancel.isPending}
          onClick={() => cancel.mutate(don.orderCode)}
        >
          Huỷ đơn
        </Button>
      </div>
    </div>
  );
}
