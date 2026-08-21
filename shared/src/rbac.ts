import type { TenantRole } from './dto';

/**
 * Từ vựng phân quyền — §6.1.
 *
 * Ba trục của một câu hỏi phân quyền: AI (`TenantRole`) được làm GÌ (`Action`)
 * lên CÁI GÌ (`Resource`), trong phạm vi tổ chức nào (domain của Casbin).
 *
 * Đặt ở `@bi/shared` để backend và frontend gọi cùng một tên. Gõ sai
 * `'wokspace'` phải là lỗi biên dịch, không phải một lần `enforce` lặng lẽ trả
 * về `false` rồi thành 403 mà không ai hiểu vì sao.
 */

export const RESOURCES = [
  'dataset',
  'datamodel',
  'report',
  'chart',
  'workspace',
  /**
   * Không có trong danh sách của §6.2 nhưng bắt buộc phải có: §6.3 nói Admin
   * được `invite`, mà mời thì phải mời VÀO đâu đó. Không có resource này thì
   * hành động `invite` không gắn được vào cái gì cả.
   */
  'member',
  /** Project là cấp trên Dataset/Report — đã có bảng thật từ migration 1. */
  /**
   * Chính TỔ CHỨC: đổi tên công ty, và sau này là mọi cấu hình cấp tổ chức.
   *
   * §6.2 của tài liệu có liệt kê tài nguyên này ("Thêm hai tài nguyên mới là
   * Tenant và Workspace") nhưng code trước đây chỉ có `workspace`, nên lời hứa
   * "Admin sửa được thông tin Company" không có endpoint nào thực hiện.
   *
   * Thêm vào đây là Admin có quyền NGAY nhờ dòng `(*, *)` — không cần thêm dòng
   * nào vào `casbin_rule`. Creator và Viewer cố ý không được gì: đổi tên công ty
   * là việc của người quản trị tổ chức.
   */
  'tenant',
  /**
   * Kết nối tới CSDL của khách hàng (§8).
   *
   * Tách khỏi `dataset` vì hai thứ có mức nhạy cảm khác hẳn: một dataset là
   * metadata về bảng, còn một connection chứa MẬT KHẨU mở được cả CSDL nguồn.
   * Gộp chung nghĩa là ai đồng bộ được dataset cũng sửa được thông tin đăng
   * nhập — không phải điều ta muốn cho vai trò `creator`.
   */
  'connection',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['read', 'modify', 'invite', 'delete'] as const;

export type Action = (typeof ACTIONS)[number];

/** Nhãn tiếng Việt cho màn hiển thị ma trận quyền. */
export const RESOURCE_LABELS: Record<Resource, string> = {
  dataset: 'Bộ dữ liệu',
  datamodel: 'Mô hình dữ liệu',
  report: 'Báo cáo',
  chart: 'Biểu đồ',
  workspace: 'Workspace',
  member: 'Thành viên',
  tenant: 'Tổ chức',
  connection: 'Kết nối CSDL',
};

export const ACTION_LABELS: Record<Action, string> = {
  read: 'Xem',
  modify: 'Sửa',
  invite: 'Mời',
  delete: 'Xoá',
};

/**
 * Quyền hiệu lực của người gọi, do backend tính bằng Casbin rồi trả về.
 *
 * Frontend KHÔNG tự suy ra ma trận này. Trước §6 nó có một bảng chép tay trong
 * `permissions.ts`, và bảng chép tay thì sớm muộn cũng lệch khỏi policy thật —
 * lệch kiểu nào cũng tệ: hiện nút dẫn tới 403, hoặc giấu mất chức năng người
 * dùng có quyền dùng.
 */
export type PermissionMatrixDto = Record<Resource, Action[]>;

/**
 * Ma trận MẶC ĐỊNH — §6.3.
 *
 * Đây là nguồn để sinh các dòng `p` của bảng `casbin_rule` (xem migration 4).
 * Sau khi migration chạy, THẨM QUYỀN thuộc về database: sửa policy lúc chạy thì
 * sửa ở đó, không sửa ở đây. Hằng số này còn lại hai việc:
 *
 *   1. Là dữ liệu gieo cho migration.
 *   2. Là giá trị tạm cho frontend vẽ giao diện trong lúc `GET /v1/permissions`
 *      chưa trả lời — thà vẽ đúng trong 99% trường hợp còn hơn nháy một nhịp
 *      không có nút nào.
 *
 * Quy ước: `'*'` nghĩa là mọi giá trị của trục đó.
 */
export interface PolicyRule {
  role: TenantRole;
  resource: Resource | '*';
  action: Action | '*';
}

export const DEFAULT_POLICY: readonly PolicyRule[] = [
  // ─── Admin: toàn quyền trong tổ chức của mình ────────────────────────────
  //
  // Một dòng `*, *` thay cho 28 dòng liệt kê. Đổi lại, thêm một resource mới
  // vào RESOURCES là Admin có quyền ngay — đúng ý: người quản trị tổ chức không
  // nên bị khoá khỏi một tính năng mới chỉ vì ai đó quên thêm một dòng policy.
  { role: 'admin', resource: '*', action: '*' },

  // ─── Creator: tạo và sửa NỘI DUNG, không đụng tới cơ cấu tổ chức ─────────
  //
  // `delete` chỉ có ở những tài nguyên Creator TỰ DỰNG RA từ đầu: dataset và
  // report (§7.8, migration 6). Không xoá được thứ mình vừa tạo
  // nghĩa là mỗi lần tải nhầm file là một bản ghi rác nằm lại vĩnh viễn và phải
  // đi nhờ Admin.
  //
  // `datamodel` nhận `delete` từ §10, khi nó có endpoint thật. Trước đó nó cố ý
  // không có — cấp một quyền trước khi có thứ để áp dụng là cách policy lệch dần
  // khỏi thực tế mà không ai nhận ra.
  //
  // `chart` vẫn KHÔNG có `delete`, vì lý do đó vẫn còn đúng với nó.
  { role: 'creator', resource: 'dataset', action: 'read' },
  { role: 'creator', resource: 'dataset', action: 'modify' },
  { role: 'creator', resource: 'dataset', action: 'delete' },
  { role: 'creator', resource: 'datamodel', action: 'read' },
  { role: 'creator', resource: 'datamodel', action: 'modify' },
  { role: 'creator', resource: 'datamodel', action: 'delete' },
  { role: 'creator', resource: 'report', action: 'read' },
  { role: 'creator', resource: 'report', action: 'modify' },
  { role: 'creator', resource: 'report', action: 'delete' },
  { role: 'creator', resource: 'chart', action: 'read' },
  { role: 'creator', resource: 'chart', action: 'modify' },
  // Thấy workspace và danh sách thành viên, nhưng không sửa được.
  { role: 'creator', resource: 'workspace', action: 'read' },
  { role: 'creator', resource: 'member', action: 'read' },
  /*
   * `connection:read` — CHỈ đọc, và đó là toàn bộ điểm của dòng này.
   *
   * Creator có `dataset:modify`, tức là được đồng bộ bảng về từ CSDL nguồn:
   * `GET /connections/:id/tables` và `POST /connections/:id/sync` đều gác bằng
   * ô đó, cố ý, với lý do ghi ngay tại route — "ai đồng bộ được thì xem được
   * danh sách bảng".
   *
   * Nhưng bước ZERO của thao tác ấy là CHỌN kết nối, và nó gọi
   * `GET /connections` nằm sau `connection:read`. Thiếu dòng này, creator mở
   * hộp thoại "Đồng bộ từ CSDL" ra và thấy một ô chọn rỗng — rỗng không kèm
   * lời giải thích nào, vì request 403 nên danh sách là `undefined` chứ không
   * phải mảng rỗng, và nhánh "chưa có kết nối nào" cũng không chạy.
   *
   * ─── Vì sao đọc thì được mà sửa thì không ─────────────────────────────────
   *
   * Lý lẽ tách `connection` khỏi `dataset` là: connection chứa MẬT KHẨU mở được
   * cả CSDL nguồn, nên "ai đồng bộ được dataset cũng SỬA được thông tin đăng
   * nhập" là điều không muốn. Lý lẽ đó nói về `modify`, không nói về `read` —
   * và `ConnectionDto` cố ý không mang mật khẩu ra ngoài (nó nằm trong
   * `secretBox`, AES-256-GCM, có bài test riêng canh việc nó không lọt vào bất
   * kỳ phản hồi nào). Cái creator thấy là tên, host, cổng, tên đăng nhập của
   * một CSDL mà họ vốn đã được phép rút dữ liệu về.
   *
   * `modify` và `delete` vẫn CHỈ admin: thêm, sửa, xoá kết nối là việc đụng tới
   * thông tin đăng nhập, và nó ở nguyên chỗ cũ.
   */
  { role: 'creator', resource: 'connection', action: 'read' },
  /*
   * `connection:modify` và `:delete` — creator dựng KẾT NỐI RIÊNG của mình.
   *
   * Đây là chỗ Casbin hết tác dụng, và phải nói rõ vì nó dễ đọc nhầm thành
   * "creator sửa được mọi kết nối của tổ chức". Casbin chấm điểm trên TÀI
   * NGUYÊN, không trên từng dòng — nó chỉ trả lời được "vai trò này có được
   * sửa kết nối nói chung không", không trả lời được "cái kết nối NÀY".
   *
   * Nên hai dòng này chỉ mở cánh cửa; ranh giới thật nằm trong chính câu SQL:
   * `update` và `softDelete` mang thêm `AND created_by = ?` khi người gọi không
   * phải admin, và `findSecret` lọc theo cùng luật đó. Không dòng nào đi qua
   * một lần `if` trong tầng service rồi mới xuống database — điều kiện nằm
   * TRONG câu lệnh, nên không có khe hở giữa lúc kiểm và lúc ghi.
   *
   * Vì sao cần cả `delete`: cùng lập luận đã dùng cho `dataset` và `report` ở
   * migration 6 — không xoá được thứ mình vừa tạo nghĩa là mỗi lần gõ nhầm là
   * một bản ghi rác nằm lại vĩnh viễn và phải đi nhờ Admin.
   */
  { role: 'creator', resource: 'connection', action: 'modify' },
  { role: 'creator', resource: 'connection', action: 'delete' },

  // ─── Viewer: chỉ đọc, và chỉ tới KẾT LUẬN ────────────────────────────────
  //
  // CỐ Ý KHÔNG có `dataset:read` và `datamodel:read`. Trước đây có cả hai, với
  // lý lẽ "viewer là vai trò chỉ đọc nên cho đọc hết". Lý lẽ đó nhìn nhầm chỗ:
  // câu hỏi không phải "đọc hay ghi" mà là "được thấy tới đâu".
  //
  // Một báo cáo là một LÁT CẮT đã được người dựng chọn ra. Bộ dữ liệu nằm dưới
  // nó gần như luôn rộng hơn: bản xem trước dữ liệu thô, đủ mọi cột kể cả những
  // cột không hề xuất hiện trên biểu đồ, tên bảng và tên CSDL nguồn. Mô hình dữ
  // liệu còn đi xa hơn — Explorer cho tự đặt câu hỏi MỚI trên chính dữ liệu đó.
  // Mời một người vào xem doanh thu theo tháng không phải là đồng ý cho họ mở
  // bảng lương ra đọc, mà hai thứ ấy thường nằm chung một kho.
  //
  // Siết ở đây KHÔNG làm hỏng việc mà viewer được mời vào để làm:
  // `GET /reports/:id/data` gọi thẳng `aggregateFromModel` /
  // `aggregateInWarehouse` trong cùng tiến trình, không đi qua
  // `authorize('datamodel', 'read')` hay `authorize('dataset', 'read')`. Biểu đồ
  // vẫn ra số, chỉ có đường vòng sang kho là đóng lại.
  //
  // Hệ quả kèm theo, đã cân nhắc: viewer mất luôn `GET /datasets/:id/load` —
  // tức là không còn tự biết "số liệu này nạp lần cuối lúc nào". Đó là cái giá
  // thật của việc đóng cửa kho, và chỗ đúng để trả lại thông tin ấy là chính
  // trang báo cáo, không phải bằng cách mở lại cả Kho dữ liệu.
  { role: 'viewer', resource: 'report', action: 'read' },
  { role: 'viewer', resource: 'chart', action: 'read' },
  { role: 'viewer', resource: 'workspace', action: 'read' },
  { role: 'viewer', resource: 'member', action: 'read' },
];

/**
 * Ma trận rỗng — mặc định an toàn khi chưa biết vai trò.
 *
 * Liệt kê tay từng khoá thay vì `Object.fromEntries(RESOURCES.map(...))`. Bản
 * dựng động cho ra `{ [k: string]: never[] }` và buộc phải ép kiểu — mà ép kiểu
 * ở đây là tắt đúng thứ ta cần: thêm một tài nguyên vào `RESOURCES` mà quên cập
 * nhật chỗ này thì `Record<Resource, Action[]>` KHÔNG đủ khoá và biên dịch hỏng
 * ngay. Vài dòng lặp đổi lấy một lỗi biên dịch thay vì một ô quyền lặng lẽ
 * `undefined` lúc chạy.
 */
export function emptyPermissionMatrix(): PermissionMatrixDto {
  return {
    dataset: [],
    datamodel: [],
    report: [],
    chart: [],
    workspace: [],
    member: [],
    tenant: [],
    connection: [],
  };
}

/**
 * Trải `DEFAULT_POLICY` thành ma trận cho MỘT vai trò.
 *
 * Dùng ở frontend làm giá trị tạm, và ở test để đối chiếu kết quả Casbin với
 * bảng nguồn — nếu hai thứ lệch nhau thì hoặc migration gieo sai, hoặc matcher
 * viết sai, và cả hai đều là loại lỗi không tự lộ ra.
 */
export function matrixForRole(role: TenantRole | null | undefined): PermissionMatrixDto {
  const matrix = emptyPermissionMatrix();
  if (!role) return matrix;

  for (const rule of DEFAULT_POLICY) {
    if (rule.role !== role) continue;
    const resources = rule.resource === '*' ? RESOURCES : [rule.resource];
    const actions = rule.action === '*' ? ACTIONS : [rule.action];
    for (const resource of resources) {
      for (const action of actions) {
        if (!matrix[resource].includes(action)) matrix[resource].push(action);
      }
    }
  }
  return matrix;
}

/** Tra cứu một ô trong ma trận. */
export function can(
  matrix: PermissionMatrixDto,
  resource: Resource,
  action: Action,
): boolean {
  return matrix[resource]?.includes(action) ?? false;
}
