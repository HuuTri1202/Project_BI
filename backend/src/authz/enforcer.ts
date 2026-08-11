import {
  ACTIONS,
  RESOURCES,
  emptyPermissionMatrix,
  type Action,
  type PermissionMatrixDto,
  type Resource,
  type TenantRole,
} from '@bi/shared';
import { newEnforcer, newModelFromString, type Enforcer } from 'casbin';
import type { RowDataPacket } from 'mysql2';

import { mysqlPool } from '../config/mysql';
import { CASBIN_MODEL } from './model';

/**
 * Bộ thực thi phân quyền — §6.3, §6.4.
 *
 * ─── Vì sao tự nạp policy thay vì dùng adapter có sẵn ───────────────────────
 *
 * Adapter MySQL của Casbin là một gói riêng, tự mở connection pool thứ hai bằng
 * cấu hình riêng của nó. Dự án này đã có một pool được chỉnh kỹ trong
 * `config/mysql.ts` — `SET time_zone='+00:00'` mỗi connection, `dateStrings`
 * cho cột DATE, giới hạn 10 connection. Một pool thứ hai không có những thứ đó
 * là một đường đi vòng qua mọi quyết định đã cân nhắc.
 *
 * Chỗ này chỉ cần đúng một câu SELECT. Tự đọc rồi `addPolicy` vào enforcer
 * trong bộ nhớ là mười dòng, và nó dùng đúng pool của cả hệ thống.
 *
 * ─── Nạp một lần lúc khởi động, và điều đó an toàn ──────────────────────────
 *
 * Chỉ các dòng `p` được nạp — ma trận vai trò, thay đổi cỡ vài lần một năm.
 * KHÔNG nạp dòng `g` (ai giữ vai trò gì), vì thứ đó đổi hằng ngày và
 * `requireFreshMembership` đã đọc nó từ database ở MỖI request. Xem ghi chú dài
 * trong `authz/model.ts`.
 *
 * Nói cách khác: phần đứng yên nằm trong bộ nhớ, phần biến động đọc tươi mỗi
 * lần. Đó là lý do enforcer này không cần cơ chế làm mới nào.
 */

interface PolicyRow extends RowDataPacket {
  v0: string | null;
  v1: string | null;
  v2: string | null;
  v3: string | null;
}

let enforcerPromise: Promise<Enforcer> | null = null;

async function build(): Promise<Enforcer> {
  const enforcer = await newEnforcer(newModelFromString(CASBIN_MODEL));

  const [rows] = await mysqlPool.query<PolicyRow[]>(
    `SELECT v0, v1, v2, v3 FROM casbin_rule WHERE ptype = 'p' ORDER BY id`,
  );

  for (const row of rows) {
    // Dòng thiếu cột là dữ liệu hỏng — bỏ qua thay vì nhét `null` vào Casbin,
    // vì `addPolicy(null, ...)` tạo ra một luật khớp với không gì cả và sẽ nằm
    // im trong bảng, trông như đang bảo vệ thứ gì đó.
    if (row.v0 === null || row.v1 === null || row.v2 === null || row.v3 === null) continue;
    await enforcer.addPolicy(row.v0, row.v1, row.v2, row.v3);
  }

  if (rows.length === 0) {
    // Bảng rỗng = MỌI request bị từ chối. Đó là mặc định an toàn đúng đắn,
    // nhưng nó trông hệt như "ứng dụng hỏng", nên phải nói ra ở log khởi động
    // chứ không để người ta đi tìm trong 403.
    console.warn(
      '[authz] casbin_rule không có dòng `p` nào — mọi thao tác sẽ bị từ chối. Chạy `npm run db:migrate`.',
    );
  }

  return enforcer;
}

/**
 * Lấy enforcer, dựng một lần rồi dùng lại.
 *
 * Giữ PROMISE chứ không giữ enforcer đã resolve: hai request đến cùng lúc lúc
 * khởi động sẽ cùng chờ một lần dựng, thay vì cùng thấy `null` rồi cùng đọc
 * database và dựng hai enforcer.
 */
export function getEnforcer(): Promise<Enforcer> {
  enforcerPromise ??= build();
  return enforcerPromise;
}

/** Chỉ dành cho test: buộc dựng lại sau khi đổi dữ liệu policy. */
export function resetEnforcer(): void {
  enforcerPromise = null;
}

/**
 * Câu hỏi phân quyền: vai trò này, trong tổ chức này, được làm gì với cái gì.
 *
 * `tenantId` thành chuỗi vì Casbin so sánh chuỗi — truyền số vào sẽ so `3` với
 * `'*'` và không bao giờ khớp.
 */
export async function enforce(
  role: TenantRole,
  tenantId: number,
  resource: Resource,
  action: Action,
): Promise<boolean> {
  const enforcer = await getEnforcer();
  return enforcer.enforce(role, String(tenantId), resource, action);
}

/**
 * Trải toàn bộ quyền của một vai trò thành ma trận cho frontend (§6.8).
 *
 * Hỏi Casbin từng ô thay vì đọc thẳng bảng `casbin_rule`: bảng chứa cả `'*'` và
 * các dòng cụ thể, mà việc diễn giải dấu sao là của MATCHER. Tự diễn giải ở đây
 * là viết lần thứ hai một logic đã có, và bản thứ hai sẽ lệch — đúng lúc ai đó
 * thêm một dạng luật mới mà quên chỗ này.
 *
 * 7 tài nguyên × 4 hành động = 28 lần `enforce`, toàn bộ trong bộ nhớ, không
 * chạm database. Rẻ hơn nhiều so với một truy vấn.
 */
export async function permissionMatrixFor(
  role: TenantRole,
  tenantId: number,
): Promise<PermissionMatrixDto> {
  const enforcer = await getEnforcer();
  const matrix = emptyPermissionMatrix();

  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      if (await enforcer.enforce(role, String(tenantId), resource, action)) {
        matrix[resource].push(action);
      }
    }
  }

  return matrix;
}
