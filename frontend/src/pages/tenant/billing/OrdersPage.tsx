import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@bi/shared';
import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui/Button';
import { FilterSelect } from '../../../components/ui/ListToolbar';
import { Pagination } from '../../../components/ui/Pagination';
import { TBody, TableWrap, Td, THead, Th, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { dinhDangNgayGio, dinhDangTien } from '../../../features/billing/format';
import { useOrders } from '../../../features/billing/hooks';
import { OrderStatusBadge } from '../../../features/billing/OrderStatusBadge';
import { useListQueryState } from '../../../hooks/useListQueryState';
import { getApiError } from '../../../services/apiClient';

/**
 * Lịch sử đơn hàng — §11.
 *
 * Bộ lọc sống trong QUERY STRING chứ không trong `useState`, theo đúng khuôn
 * `DatasetsPage`: gửi link cho đồng nghiệp hoặc F5 phải giữ nguyên thứ đang xem.
 * Đó cũng là lý do tab của trang này phải là route thật — xem `BillingPage`.
 */

interface OrderQuery {
  page: number;
  pageSize: number;
  status: string;
  sort: string;
  order: 'asc' | 'desc';
}

const DEFAULTS: OrderQuery = {
  page: 1,
  pageSize: 20,
  status: '',
  sort: 'createdAt',
  order: 'desc',
};

const ALLOWED = {
  status: ORDER_STATUSES,
  sort: ['createdAt', 'amount', 'status'],
  order: ['asc', 'desc'],
} as const;

const STATUS_OPTIONS = ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

export default function OrdersPage(): React.ReactElement {
  const { query, update, reset } = useListQueryState<OrderQuery>({ ...DEFAULTS }, ALLOWED);
  const { data, isPending, isError, error, isPlaceholderData } = useOrders(query);

  const coLoc = query.status !== '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          id="order-status"
          label="Trạng thái"
          value={query.status}
          allLabel="Mọi trạng thái"
          options={STATUS_OPTIONS}
          onChange={(status) => update({ status })}
        />
      </div>

      {isError && <ErrorState message={getApiError(error).message} />}
      {isPending && <TableSkeleton />}

      {data !== undefined && data.items.length === 0 && (
        <EmptyState
          title={coLoc ? 'Không có đơn nào khớp bộ lọc' : 'Chưa có đơn hàng nào'}
          hint={
            coLoc
              ? 'Thử bỏ bộ lọc để xem toàn bộ lịch sử.'
              : 'Đơn hàng sẽ hiện ở đây sau lần nâng cấp gói đầu tiên.'
          }
          action={
            coLoc ? (
              <Button onClick={reset}>Xoá lọc</Button>
            ) : (
              <Link to="/billing/plans">
                <Button variant="primary">Xem bảng giá</Button>
              </Link>
            )
          }
        />
      )}

      {data !== undefined && data.items.length > 0 && (
        <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          <TableWrap fill>
            <THead>
              <Tr>
                <Th>Mã đơn</Th>
                <Th>Gói</Th>
                <Th>Số tiền</Th>
                <Th>Trạng thái</Th>
                <Th>Tạo lúc</Th>
              </Tr>
            </THead>
            <TBody>
              {data.items.map((order) => (
                <Tr key={order.id}>
                  <Td>
                    {/*
                      Mã đơn là link tới màn thanh toán — với đơn còn chờ thì đó
                      là đường quay lại mã QR, và đó là việc người dùng cần làm
                      nhất khi mở trang này.
                    */}
                    <Link
                      to={`/billing/orders/${order.orderCode}`}
                      className="font-mono text-xs text-brand-700 hover:underline"
                    >
                      {order.orderCode}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-sm text-slate-700">{order.planName}</span>
                    <span className="ml-1.5 text-xs text-slate-400">
                      {order.planDurationDays} ngày
                    </span>
                  </Td>
                  <Td>
                    <span className="text-sm tabular-nums text-slate-700">
                      {dinhDangTien(order.amountVnd)}
                    </span>
                  </Td>
                  <Td>
                    <OrderStatusBadge status={order.status as OrderStatus} />
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {dinhDangNgayGio(order.createdAt)}
                    </span>
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
    </div>
  );
}
