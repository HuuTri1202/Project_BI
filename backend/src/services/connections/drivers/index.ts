import { clickhouseDriver } from './clickhouse';
import { mysqlDriver } from './mysql';
import type { ConnectionKind, Driver } from './types';

export * from './types';

/**
 * Bảng tra loại CSDL -> driver.
 *
 * `Record<ConnectionKind, Driver>` chứ không phải object thường: thêm một giá
 * trị vào `ConnectionKind` mà quên viết driver là LỖI BIÊN DỊCH, không phải một
 * `undefined` lúc chạy rồi thành 500 khi có người thật bấm nút.
 */
const DRIVERS: Record<ConnectionKind, Driver> = {
  mysql: mysqlDriver,
  clickhouse: clickhouseDriver,
};

export function driverFor(kind: ConnectionKind): Driver {
  return DRIVERS[kind];
}
