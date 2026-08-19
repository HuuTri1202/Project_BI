import type { Action, Resource } from '@bi/shared';
import type { RequestHandler } from 'express';

import { enforce } from '../authz/enforcer';
import { forbidden, unauthorized } from '../utils/httpError';

/**
 * Cổng phân quyền theo tài nguyên và hành động — §6.4.
 *
 * Luôn đặt SAU `authenticate` và SAU `requireFreshMembership`: nó đọc
 * `req.auth.role`, mà giá trị đáng tin của trường đó do `requireFreshMembership`
 * ghi đè từ database. Đặt trước, nó sẽ chấm điểm một vai trò có thể đã cũ tới 7
 * ngày (`JWT_EXPIRES_IN`).
 *
 * ─── Quan hệ với `requireRole` ──────────────────────────────────────────────
 *
 * `requireRole('admin')` hỏi "có phải vai trò này không". `authorize` hỏi "vai
 * trò này có được làm việc này không" — cùng một câu hỏi ở mức trừu tượng cao
 * hơn một bậc, và câu trả lời nằm trong database thay vì trong mã nguồn.
 *
 * Hai cái KHÔNG chồng nhau: mỗi route dùng đúng một. `authorize` là mặc định từ
 * §6 trở đi. `requireRole` giữ nguyên ở những chỗ câu hỏi thật sự là về danh
 * tính vai trò chứ không phải về một hành động cụ thể.
 *
 * ─── Điều middleware này KHÔNG làm ──────────────────────────────────────────
 *
 * Nó không biết gì về `:id` trên URL. Cho qua ở đây chỉ nghĩa là "vai trò này
 * được xoá workspace", KHÔNG phải "được xoá workspace SỐ 7". Việc dòng số 7 có
 * thuộc tổ chức của người gọi hay không do `WHERE tenant_id = ?` trong
 * repository trả lời, và đó mới là thứ chặn đọc chéo tổ chức.
 *
 * Trộn hai câu hỏi vào một là cách sinh ra lỗ hổng IDOR mà mọi lớp phân quyền
 * đều báo xanh.
 */
export function authorize(resource: Resource, action: Action): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(unauthorized());
      return;
    }

    enforce(auth.role, auth.tenantId, resource, action)
      .then((allowed) => {
        if (!allowed) {
          // Thông báo nêu đúng thao tác bị chặn thay vì một câu chung chung.
          // Người dùng cần biết mình thiếu quyền gì để đi hỏi đúng thứ.
          next(forbidden(`Vai trò của bạn không được phép ${describe(action, resource)}.`));
          return;
        }
        next();
      })
      .catch(next);
  };
}

const ACTION_VERBS: Record<Action, string> = {
  read: 'xem',
  modify: 'thay đổi',
  invite: 'mời người vào',
  delete: 'xoá',
};

const RESOURCE_NOUNS: Record<Resource, string> = {
  dataset: 'bộ dữ liệu',
  datamodel: 'mô hình dữ liệu',
  report: 'báo cáo',
  chart: 'biểu đồ',
  workspace: 'workspace',
  member: 'thành viên',

  tenant: 'thông tin tổ chức',
  connection: 'kết nối CSDL',
};

function describe(action: Action, resource: Resource): string {
  return `${ACTION_VERBS[action]} ${RESOURCE_NOUNS[resource]}`;
}
