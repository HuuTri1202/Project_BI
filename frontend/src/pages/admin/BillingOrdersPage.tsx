import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_PROVIDER_LABELS } from '@bi/shared';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { Modal } from '../../components/ui/Modal';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, TableWrap, Td, THead, Th, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import type { AdminOrderDto } from '../../features/admin/billing/api';
import { useAdminOrders, useConfirmOrder } from '../../features/admin/billing/hooks';
import { OrderStatusBadge } from '../../features/billing/OrderStatusBadge';
import { dinhDangNgayGio, dinhDangTien } from '../../features/billing/format';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';

/**
 * Đơn hàng của MỌI tổ chức, và nút xác nhận đã nhận tiền — §11 mục 3.3.
 *
 * Đây là màn hình người vận hành mở ra mỗi ngày với sao kê ngân hàng bên cạnh:
 * dò mã đơn trên sao kê, tìm nó ở đây, đối chiếu số tiền, rồi xác nhận.
 */

interface OrderQuery {
  page: number;
  pageSize: number;
  status: string;
  provider: string;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
}

const DEFAULTS: OrderQuery = {
  page: 1,
  pageSize: 20,
  status: '',
  provider: '',
  q: '',
  sort: 'createdAt',
  order: 'desc',
};

const ALLOWED = {
  status: ORDER_STATUSES,
  provider: ['bank_transfer', 'payos', 'sepay', 'momo'],
  sort: ['createdAt', 'amount', 'status'],
  order: ['asc', 'desc'],
} as const;

/**
 * Hộp thoại xác nhận đã nhận tiền.
 *
 * ─── Vì sao BẮT nhập số tham chiếu, không cho để trống ─────────────────────
 *
 * Nó làm hai việc trong một ô: là khoá idempotency thật ở tầng database
 * (`uq_payment_txn_provider_ref`), và là sợi dây nối một lần xác nhận tay về
 * đúng một dòng sao kê khi có tranh chấp ba tháng sau. Bỏ nó là bỏ cả hai.
 *
 * ─── Số tiền điền sẵn nhưng SỬA ĐƯỢC ───────────────────────────────────────
 *
 * Khách chuyển thiếu vài nghìn là chuyện hằng ngày. Ép bằng đúng số tiền đơn
 * nghĩa là những lần lệch trở thành không ghi nhận được — và người vận hành sẽ
 * ghi bừa một con số cho xong, làm hỏng luôn phần đối soát.
 */
function ConfirmModal({
  order,
  onClose,
}: {
  order: AdminOrderDto | null;
  onClose: () => void;
}): React.ReactElement {
  const confirm = useConfirmOrder();
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [xong, setXong] = useState<string | null>(null);

  // Điền sẵn số tiền của đơn mỗi lần mở. `Modal` bọc thẻ <dialog> và không bị
  // tháo khỏi cây khi đóng, nên state sống qua các lần đóng mở — không đồng bộ
  // lại thì lần mở thứ hai mang số tiền của đơn trước.
  const [lastCode, setLastCode] = useState<string | null>(null);
  if (order !== null && order.orderCode !== lastCode) {
    setLastCode(order.orderCode);
    setRef('');
    setReason('');
    setAmount(String(order.amountVnd));
    setLoi(null);
    setXong(null);
  }

  function submit(): void {
    if (order === null) return;
    setLoi(null);

    const soTien = Number(amount);
    if (ref.trim() === '') {
      setLoi('Hãy nhập số tham chiếu giao dịch trên sao kê.');
      return;
    }
    if (!Number.isInteger(soTien) || soTien <= 0) {
      setLoi('Số tiền phải là số nguyên dương, đơn vị đồng.');
      return;
    }

    confirm.mutate(
      {
        code: order.orderCode,
        providerTxnRef: ref.trim(),
        amountVnd: soTien,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      },
      {
        onSuccess: (result) => {
          // `alreadyProcessed` KHÔNG phải lỗi — nói ra để người vận hành biết
          // họ không vừa ghi nhận tiền hai lần.
          setXong(
            result.alreadyProcessed
              ? 'Đơn này đã được ghi nhận từ trước. Không có gì thay đổi.'
              : 'Đã ghi nhận thanh toán và kích hoạt gói.',
          );
        },
        onError: (err) => setLoi(getApiError(err).message),
      },
    );
  }

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Xác nhận đã nhận tiền"
      description={
        order === null
          ? undefined
          : `${order.orderCode} · ${order.tenantName} · ${dinhDangTien(order.amountVnd)}`
      }
      footer={
        <>
          <Button onClick={onClose}>{xong === null ? 'Huỷ' : 'Đóng'}</Button>
          {xong === null && (
            <Button variant="primary" onClick={submit} loading={confirm.isPending}>
              Xác nhận
            </Button>
          )}
        </>
      }
    >
      {xong !== null ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">{xong}</p>
      ) : (
        <div className="space-y-3">
          {loi !== null && <ErrorState message={loi} />}

          <Field
            label="Số tham chiếu giao dịch"
            hint="Lấy từ sao kê ngân hàng. Bắt buộc — đây là thứ truy ngược lại được khi có tranh chấp."
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <Field
            label="Số tiền thực nhận (đồng)"
            hint="Điền sẵn theo đơn. Sửa lại nếu khách chuyển thiếu hoặc thừa."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Ghi chú"
            hint="Không bắt buộc. Ví dụ: ngày đối chiếu sao kê."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
            Thao tác này <strong>kích hoạt gói ngay</strong> cho tổ chức và được ghi vào nhật ký
            kiểm toán kèm tên bạn. Hãy chắc tiền đã thật sự về tài khoản.
          </p>
        </div>
      )}
    </Modal>
  );
}

export default function BillingOrdersPage(): React.ReactElement {
  const { query, update, reset } = useListQueryState<OrderQuery>({ ...DEFAULTS }, ALLOWED);
  const { data, isPending, isError, error, isPlaceholderData } = useAdminOrders(query);
  const [confirming, setConfirming] = useState<AdminOrderDto | null>(null);

  const coLoc = query.status !== '' || query.provider !== '' || query.q !== '';

  return (
    <Page width="full">
      <PageHeader
        title="Đơn hàng & thanh toán"
        description="Đơn của mọi tổ chức trên nền tảng. Đối chiếu sao kê rồi xác nhận đã nhận tiền."
      >
        <div className="mt-4">
          <ListToolbar
            search={query.q}
            onSearch={(q) => update({ q })}
            placeholder="Tìm theo mã đơn hoặc tên tổ chức…"
            hasFilter={coLoc}
            onReset={reset}
          >
            <FilterSelect
              id="order-status"
              label="Trạng thái"
              value={query.status}
              allLabel="Mọi trạng thái"
              options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
              onChange={(status) => update({ status })}
            />
            <FilterSelect
              id="order-provider"
              label="Cổng"
              value={query.provider}
              allLabel="Mọi cổng"
              options={Object.entries(PAYMENT_PROVIDER_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(provider) => update({ provider })}
            />
          </ListToolbar>
        </div>
      </PageHeader>

      <PageBody scroll={false}>
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton />}

        {data !== undefined && data.items.length === 0 && (
          <EmptyState
            title={coLoc ? 'Không có đơn nào khớp bộ lọc' : 'Chưa có đơn hàng nào'}
            hint={
              coLoc
                ? 'Thử bỏ bộ lọc để xem toàn bộ.'
                : 'Đơn sẽ hiện ở đây khi có tổ chức đặt mua gói.'
            }
            action={coLoc ? <Button onClick={reset}>Xoá lọc</Button> : undefined}
          />
        )}

        {data !== undefined && data.items.length > 0 && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap fill>
              <THead>
                <Tr>
                  <Th>Mã đơn</Th>
                  <Th>Tổ chức</Th>
                  <Th>Gói</Th>
                  <Th>Số tiền</Th>
                  <Th>Trạng thái</Th>
                  <Th>Tham chiếu</Th>
                  <Th>Tạo lúc</Th>
                  <Th> </Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((order) => (
                  <Tr key={order.id}>
                    <Td>
                      <code className="text-xs text-slate-700">{order.orderCode}</code>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-700">{order.tenantName}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-600">{order.planName}</span>
                    </Td>
                    <Td>
                      <span className="text-sm tabular-nums text-slate-700">
                        {dinhDangTien(order.amountVnd)}
                      </span>
                    </Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td>
                      {/* Mã tham chiếu đã ghi nhận. Có nó nghĩa là tiền đã được
                          đối chiếu về một dòng sao kê cụ thể. */}
                      {order.providerTxnRef === null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <code className="text-xs text-slate-500">{order.providerTxnRef}</code>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {dinhDangNgayGio(order.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      {/*
                        Nút chỉ hiện với đơn CHƯA đóng sổ.
                        Đơn `paid` thì không còn gì để xác nhận; đơn `cancelled`
                        và `refunded` thì backend từ chối kèm lý do — không mời
                        người ta bấm một nút chắc chắn báo lỗi.
                      */}
                      {['pending', 'awaiting_confirmation', 'expired', 'failed'].includes(
                        order.status,
                      ) && (
                        <Button size="sm" onClick={() => setConfirming(order)}>
                          Đã nhận tiền
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </TableWrap>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              unit="đơn"
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}

        <ConfirmModal order={confirming} onClose={() => setConfirming(null)} />
      </PageBody>
    </Page>
  );
}
