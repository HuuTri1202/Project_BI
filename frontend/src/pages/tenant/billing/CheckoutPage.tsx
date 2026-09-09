import { ORDER_STATUSES_LIVE, type BillingCycle } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '../../../components/ui/Button';
import { ErrorState, TableSkeleton } from '../../../components/ui/states';
import { QrCode } from '../../../features/billing/QrCode';
import { StaticQrImage } from '../../../features/billing/StaticQrImage';
import { conLai, dinhDangTien } from '../../../features/billing/format';
import {
  useCancelOrder,
  useCreateOrder,
  useInvalidateBilling,
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

/**
 * Số giây hiện màn "thành công" trước khi tự chuyển về trang gói.
 *
 * Đủ để đọc xong hai câu, chưa đủ để thành chờ đợi. Ngắn hơn thì cái xác nhận
 * duy nhất khách nhận được sau khi trả tiền chỉ loé lên rồi biến mất.
 */
const GIAY_TRUOC_KHI_CHUYEN = 4;

export function OrderDetailPage(): React.ReactElement {
  const { code } = useParams<{ code: string }>();
  const now = useDongHo();
  const navigate = useNavigate();
  const invalidate = useInvalidateBilling();

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

  /*
   * ─── Tiền về xong thì màn hình phải TỰ đi tiếp — §11.2 ───────────────────
   *
   * Trước đây nhánh `paid` chỉ vẽ một băng-rôn xanh rồi đứng im, và để lại HAI
   * việc cho người dùng:
   *
   *   1. tự bấm "Xem gói của tôi";
   *   2. và tới nơi thì thấy hạn mức CŨ, vì `useBillingSummary` giữ cache 30
   *      giây và không ai bảo nó rằng gói vừa đổi.
   *
   * Việc thứ hai tệ hơn nhiều: khách vừa trả tiền, mở trang gói, và thấy đúng
   * con số của gói Free. Không có gì nói rằng họ chỉ cần đợi thêm.
   *
   * `invalidate` chạy MỘT lần ngay khi trạng thái đổi; đồng hồ đếm ngược cho
   * khách kịp ĐỌC là đã thành công trước khi chuyển — ném họ sang màn khác ngay
   * lập tức thì cái xác nhận duy nhất họ nhận được chỉ loé lên một khoảnh khắc.
   */
  const daTra = hienTai === 'paid';
  const [conMayGiay, setConMayGiay] = useState(GIAY_TRUOC_KHI_CHUYEN);

  useEffect(() => {
    if (!daTra) return;

    void invalidate();
    const dong = setInterval(() => setConMayGiay((n) => n - 1), 1000);
    const hen = setTimeout(() => navigate('/billing'), GIAY_TRUOC_KHI_CHUYEN * 1000);

    return () => {
      clearInterval(dong);
      clearTimeout(hen);
    };
    // `invalidate` và `navigate` ổn định giữa các lần render; đưa vào đây chỉ
    // khiến hiệu ứng chạy lại và đặt lại đồng hồ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daTra]);

  if (order.isError) return <ErrorState message={getApiError(order.error).message} />;
  if (order.isPending || order.data === undefined) return <TableSkeleton rows={4} />;

  const don = order.data;
  const conCho = hienTai !== undefined && ORDER_STATUSES_LIVE.includes(hienTai);
  const conThoiGian = conLai(don.expiresAt, now);
  // Ví điện tử dùng bộ từ vựng KHÁC ngân hàng: không có "số tài khoản", không
  // có "nội dung chuyển khoản". Cùng ba trường dữ liệu, nhưng gọi bằng tên mà
  // khách nhìn thấy trong app của họ — nếu không, họ đi tìm một ô không tồn tại.
  const laViDienTu = don.provider === 'momo';

  // ─── Đã thanh toán ────────────────────────────────────────────────────────
  if (daTra) {
    return (
      <div className="mx-auto w-full max-w-lg overflow-y-auto pr-1">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-base font-semibold text-green-900">Thanh toán thành công</p>
          <p className="mt-1 text-sm text-green-800">
            Gói <strong>{don.planName}</strong> đã có hiệu lực ngay. Hạn mức của tổ chức đã được
            nâng lên.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/billing">
              <Button variant="primary">Xem gói của tôi</Button>
            </Link>
          </div>
          {/* Nút vẫn còn, và đó là chủ ý: đồng hồ nói trước chuyện sắp xảy ra,
              nhưng ai không muốn đợi thì bấm. Tự chuyển mà không báo là giật màn
              hình khỏi tay người đang đọc. */}
          <p className="mt-3 text-xs text-green-800">
            {conMayGiay > 0
              ? `Tự chuyển về trang gói sau ${conMayGiay} giây…`
              : 'Đang chuyển…'}
          </p>
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

  /*
   * ─── Tiền ĐÃ về nhưng chưa khớp số — §11.2 ──────────────────────────────
   *
   * `awaiting_confirmation` nằm trong `ORDER_STATUSES_LIVE`, nên nếu không có
   * nhánh này khách sẽ thấy lại đúng màn hình "quét mã QR đi" cho một khoản tiền
   * họ VỪA chuyển — và nút Huỷ đơn nằm ngay đó. Bấm vào thì không có gì xảy ra
   * (`cancelOrder` chỉ đụng đơn `pending`, cố ý, vì tiền đã vào tài khoản), nên
   * họ nhận một nút chết mà không hiểu vì sao.
   *
   * Không nói con số cụ thể ở đây. Hệ thống biết số tiền nhận được ít hơn, nhưng
   * "bạn chuyển thiếu 50.000đ" có thể sai — khách chuyển làm hai lần, hoặc ngân
   * hàng trừ phí, và đổ lỗi nhầm cho người vừa trả tiền là cách nhanh nhất biến
   * một việc nhỏ thành một cuộc tranh cãi.
   */
  if (hienTai === 'awaiting_confirmation') {
    return (
      <div className="mx-auto w-full max-w-lg overflow-y-auto pr-1">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-base font-semibold text-amber-900">Đã nhận được tiền của bạn</p>
          <p className="mt-1 text-sm text-amber-800">
            Khoản chuyển cho đơn <span className="font-mono">{don.orderCode}</span> đã về, nhưng
            số tiền chưa khớp với đơn nên cần quản trị viên đối chiếu. Gói sẽ bật ngay sau đó —
            màn hình này tự cập nhật, bạn không cần tải lại trang.
          </p>
          <div className="mt-4 flex justify-center gap-2">
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
          {/*
            Hai loại mã QR, và khác biệt giữa chúng phải nói ra chứ không chỉ
            hiện một hình vuông giống nhau:

              qrPayload    sinh RIÊNG cho đơn này, đã mang sẵn số tiền và mã
                           đơn. Khách quét là xong.
              staticQrUrl  ảnh QR nhận tiền CỐ ĐỊNH (MoMo). Khách phải TỰ nhập
                           số tiền và TỰ ghi mã đơn vào lời nhắn.

            Câu hướng dẫn dưới mã đổi theo, vì người quét mã tĩnh mà tưởng số
            tiền đã điền sẵn sẽ chuyển sai số — và đó là một khoản tiền người
            vận hành phải xử lý tay.
          */}
          {don.qrPayload !== null ? (
            <QrCode
              value={don.qrPayload}
              label={`Mã QR chuyển khoản ${dinhDangTien(don.amountVnd)}, nội dung ${don.orderCode}`}
            />
          ) : don.staticQrUrl !== null ? (
            <StaticQrImage
              path={don.staticQrUrl}
              label={`Mã QR nhận tiền của ${don.paymentMethodName}`}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Đơn này không có mã QR. Hãy chuyển khoản thủ công theo thông tin bên dưới.
            </p>
          )}

          {don.qrPayload !== null ? (
            <p className="mt-3 text-center text-sm text-slate-600">
              Quét mã bằng ứng dụng ngân hàng — số tiền và nội dung đã điền sẵn.
            </p>
          ) : (
            <p className="mt-3 text-center text-sm text-slate-600">
              Quét mã bằng {don.paymentMethodName}, rồi <strong>tự nhập số tiền</strong> và{' '}
              <strong>ghi mã đơn vào lời nhắn</strong> — hai thứ đó không nằm sẵn trong mã.
            </p>
          )}

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
        {/*
          Tiêu đề đổi theo loại mã. Với VietQR động thì khối này là ĐƯỜNG DỰ
          PHÒNG cho người không quét được; với mã tĩnh thì nó là thông tin BẮT
          BUỘC phải nhập tay — gọi nó là "hoặc" sẽ khiến người ta bỏ qua.
        */}
        <h2 className="text-sm font-semibold text-slate-900">
          {don.qrPayload !== null ? 'Hoặc chuyển khoản thủ công' : 'Thông tin phải nhập'}
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          {don.bankAccountNo !== null && (
            <div className="flex justify-between gap-3">
              {/* Ví điện tử không có "số tài khoản": ô đó đựng số điện thoại, và
                  gọi sai tên sẽ khiến người ta đi tìm một thứ không tồn tại. */}
              <dt className="text-slate-500">{laViDienTu ? 'Số điện thoại' : 'Số tài khoản'}</dt>
              <dd className="font-mono text-slate-900">{don.bankAccountNo}</dd>
            </div>
          )}
          {don.bankAccountName !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{laViDienTu ? 'Tên người nhận' : 'Chủ tài khoản'}</dt>
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
            <dt className="text-slate-500">{laViDienTu ? 'Lời nhắn' : 'Nội dung'}</dt>
            <dd className="font-mono text-base font-bold text-slate-900">{don.orderCode}</dd>
          </div>
        </dl>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-600">
          {laViDienTu ? 'Lời nhắn' : 'Nội dung chuyển khoản'} phải là <strong>đúng mã đơn</strong>,
          không thêm bớt ký tự nào — hệ thống đối chiếu bằng chuỗi này. Đơn được kích hoạt sau khi
          quản trị viên xác nhận đã nhận tiền.
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
