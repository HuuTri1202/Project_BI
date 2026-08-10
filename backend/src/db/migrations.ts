/**
 * Danh sách migration, chạy theo thứ tự `id` tăng dần.
 *
 * SQL viết thẳng trong TypeScript chứ không để file .sql rời, vì `tsc` KHÔNG
 * copy file .sql sang dist/ — bản build production sẽ thiếu migration mà không
 * báo lỗi gì. Viết trong .ts thì dev và production dùng đúng một nguồn.
 *
 * Cũng KHÔNG dùng infrastructure/mysql/init/*.sql cho việc này: thư mục đó chỉ
 * chạy đúng một lần khi volume MySQL còn rỗng, nên máy nào đã có volume cũ sẽ
 * âm thầm không có bảng.
 *
 * QUY TẮC: migration ĐÃ ĐẨY LÊN REMOTE thì không sửa nữa — máy người khác đã
 * chạy bản cũ rồi, sửa là hai máy ra hai schema khác nhau mà không ai biết.
 * Cần đổi gì thì thêm migration mới.
 *
 * Migration 1 dưới đây là NGOẠI LỆ đã được cân nhắc: bản đầu của nó chỉ tồn tại
 * trên nhánh `feature/login` chưa từng push, nên chưa máy nào ngoài máy tác giả
 * chạy qua. Viết lại một lần cho đúng vẫn sạch hơn là giao cho cả nhóm một
 * migration sai rồi kèm ngay một migration ALTER để chữa. Từ sau khi nhánh này
 * được push, quy tắc trên có hiệu lực tuyệt đối.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  /** Mỗi phần tử là một câu lệnh: mysql2 không cho nhiều câu trong một query. */
  readonly statements: readonly string[];
}

/*
 * ─── Bốn quyết định đã thống nhất giữa hai người, schema này hiện thực đúng ───
 *
 * 1. Khoá chính BIGINT UNSIGNED AUTO_INCREMENT.
 * 2. Quan hệ user ↔ tenant nằm ở bảng nối `memberships`, KHÔNG phải cột
 *    `users.tenant_id`. Một người làm được ở nhiều tổ chức.
 * 3. Phiên đăng nhập lưu bằng localStorage + header Authorization (không đụng
 *    tới schema, ghi ở đây cho đủ bối cảnh).
 * 4. Vai trò khai bằng ENUM, không dùng bảng tra cứu `roles`. Có HAI trục vai
 *    trò độc lập:
 *
 *      users.role        ENUM('superadmin','user')          ← cấp NỀN TẢNG
 *      memberships.role  ENUM('admin','creator','viewer')   ← cấp TỔ CHỨC
 *
 *    `superadmin` là người vận hành hệ thống, đứng ngoài mọi tổ chức. Người
 *    dùng bình thường là `user`, và quyền thật của họ nằm ở `memberships.role`
 *    của từng tổ chức. Trộn hai trục vào một cột là thứ không gỡ ra được về sau.
 *
 * Quy ước ENUM cho toàn repo: thêm giá trị mới phải NỐI VÀO CUỐI. MySQL lưu
 * ENUM theo số thứ tự, nên chèn vào giữa là viết lại toàn bộ dữ liệu của bảng;
 * nối vào cuối là thao tác INSTANT chỉ đụng metadata.
 */

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create_auth_core',
    statements: [
      // ─── tenants: tổ chức/công ty, gốc của mọi thứ ───────────────────────
      `CREATE TABLE IF NOT EXISTS tenants (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name       VARCHAR(255) NOT NULL,
        slug       VARCHAR(100) NOT NULL,
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        deleted_at DATETIME(3)  NULL,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenants_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── users: định danh TOÀN CỤC, cố ý KHÔNG có tenant_id ──────────────
      //
      // Không có `tenant_id` ở đây là điểm khác quan trọng nhất so với bản
      // trước. Người dùng là một danh tính, việc họ thuộc tổ chức nào và giữ
      // vai trò gì là chuyện của `memberships`.
      //
      // `email` UNIQUE TOÀN CỤC: form đăng nhập chỉ có email + mật khẩu, không
      // có ô chọn tổ chức. Unique theo tenant sẽ biến một người thành hai dòng
      // với hai mật khẩu, và gộp lại sau khi đã có dữ liệu thật là cả một dự án
      // migrate. Collation _ci nên 'A@b.com' đụng 'a@b.com' — đúng ý, không nhà
      // cung cấp mail thật nào phân biệt hoa thường ở phần local.
      //
      // Ràng buộc UNIQUE mới là thứ THẬT SỰ chặn trùng email. Câu SELECT kiểm
      // tra trước chỉ để trả thông báo đẹp — giữa SELECT và INSERT luôn có khe
      // hở cho hai request đồng thời.
      //
      // `phone`, `job_title`, `date_of_birth` có sẵn để phục vụ form đăng ký
      // (§1.1). Cho phép NULL vì tài khoản do Admin tạo hoặc do seed sinh ra
      // không đi qua form đó.
      //
      // `email_verified_at` để NULL nghĩa là "chưa từng xác thực" — trung thực,
      // chứ không phải "đã xác thực". Cố ý KHÔNG ghi thời điểm hiện tại vào đây
      // lúc đăng ký: làm thế là phá huỷ vĩnh viễn khả năng phân biệt "đã xác
      // thực thật" với "được cấp trước khi có tính năng xác thực email".
      `CREATE TABLE IF NOT EXISTS users (
        id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email                VARCHAR(255) NOT NULL,
        password_hash        VARCHAR(255) NOT NULL,
        full_name            VARCHAR(255) NOT NULL,
        phone                VARCHAR(20)  NULL,
        job_title            VARCHAR(150) NULL,
        date_of_birth        DATE         NULL,
        role                 ENUM('superadmin','user') NOT NULL DEFAULT 'user',
        is_active            TINYINT(1)   NOT NULL DEFAULT 1,
        must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
        email_verified_at    DATETIME(3)  NULL,
        last_login_at        DATETIME(3)  NULL,
        deleted_at           DATETIME(3)  NULL,
        created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── memberships: user thuộc tenant nào, với vai trò gì ──────────────
      //
      // ĐÂY CHÍNH LÀ bảng gán vai trò. Không tách thêm bảng `user_roles`: vai
      // trò vốn gắn với tổ chức (quản trị ở công ty A nhưng chỉ xem ở công ty
      // B), nên bảng thành viên và bảng phân vai là cùng một thứ. Tách ra chỉ
      // để lặp lại cột tenant_id.
      //
      // Một dòng ở đây ánh xạ đúng 1:1 sang dòng `g, <user>, <role>, <domain>`
      // của Casbin với domain = tenant. Khi làm F3, bảng `casbin_rule` chỉ chứa
      // các dòng `p` (ma trận quyền); các dòng `g` sinh ra từ bảng này.
      //
      // UNIQUE (user_id, tenant_id): một user giữ MỘT vai trò trong một tổ
      // chức. Muốn đa vai trò thì bỏ UNIQUE này và đưa `role` vào khoá — đổi
      // được sau, chưa cần bây giờ. Tiền tố trái (user_id) phục vụ luôn truy
      // vấn "người này thuộc những tổ chức nào" của GET /auth/me.
      //
      // CASCADE cả hai chiều: membership không có ý nghĩa độc lập, xoá cứng user
      // hoặc tenant thì nó phải đi theo. Thực tế dùng xoá mềm nên cascade chỉ nổ
      // khi dọn dữ liệu test.
      `CREATE TABLE IF NOT EXISTS memberships (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id    BIGINT UNSIGNED NOT NULL,
        tenant_id  BIGINT UNSIGNED NOT NULL,
        role       ENUM('admin','creator','viewer') NOT NULL DEFAULT 'viewer',
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_memberships_user_tenant (user_id, tenant_id),
        KEY idx_memberships_tenant_role (tenant_id, role, is_active),
        CONSTRAINT fk_memberships_user FOREIGN KEY (user_id)
          REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── workspaces: cấp trên Project ────────────────────────────────────
      //     tenant -> workspace -> project -> dataset/chart
      //
      // `slug` chỉ duy nhất TRONG tenant: hai công ty đều có quyền đặt workspace
      // tên "Kinh doanh".
      //
      // UNIQUE (tenant_id, id) trông thừa vì `id` đã là khoá chính — nó KHÔNG
      // thừa: đây là đích cho khoá ngoại GHÉP của bảng `projects` bên dưới.
      // Không có nó thì MySQL từ chối tạo khoá ngoại đó.
      `CREATE TABLE IF NOT EXISTS workspaces (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id   BIGINT UNSIGNED NOT NULL,
        name        VARCHAR(255) NOT NULL,
        slug        VARCHAR(100) NOT NULL,
        description VARCHAR(500) NULL,
        created_by  BIGINT UNSIGNED NULL,
        deleted_at  DATETIME(3)  NULL,
        created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                 ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_workspaces_tenant_slug (tenant_id, slug),
        UNIQUE KEY uq_workspaces_tenant_id (tenant_id, id),
        KEY idx_workspaces_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_workspaces_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        -- SET NULL chứ không RESTRICT: workspace sống lâu hơn người tạo ra nó.
        CONSTRAINT fk_workspaces_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── projects: nơi gắn dataset/dashboard ─────────────────────────────
      //
      // `tenant_id` ở đây là dữ liệu LẶP (suy ra được qua workspace_id) và nó
      // xứng đáng, vì hai lý do:
      //
      //  1. Mọi truy vấn phân quyền thành `WHERE tenant_id = ? AND id = ?`, nên
      //     truy cập nhầm tổ chức biến thành "không có dòng nào" thay vì "thiếu
      //     một câu if".
      //  2. Nó cho phép khoá ngoại GHÉP bên dưới, khiến việc gắn project vào
      //     workspace của tổ chức khác là BẤT KHẢ THI ở tầng cơ sở dữ liệu, bất
      //     kể code phía trên làm gì. Đây là loại ràng buộc mạnh hơn mọi lớp
      //     kiểm tra trong ứng dụng, vì nó không quên được.
      `CREATE TABLE IF NOT EXISTS projects (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id    BIGINT UNSIGNED NOT NULL,
        workspace_id BIGINT UNSIGNED NOT NULL,
        name         VARCHAR(255) NOT NULL,
        description  VARCHAR(500) NULL,
        created_by   BIGINT UNSIGNED NULL,
        deleted_at   DATETIME(3)  NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_projects_workspace (workspace_id),
        KEY idx_projects_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_projects_workspace FOREIGN KEY (tenant_id, workspace_id)
          REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_projects_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },

  {
    id: 2,
    name: 'admin_area_membership_lifecycle',
    statements: [
      // ─── memberships.removed_at ──────────────────────────────────────────
      //
      // §3.4 có HAI thao tác khác nhau: "khoá" và "xoá mềm". Với mỗi cột
      // `is_active` thì hai thao tác cho ra CÙNG một trạng thái dữ liệu — danh
      // sách không phân biệt được ai bị khoá tạm với ai đã rời tổ chức, và thẻ
      // KPI "Tài khoản bị khoá" đếm luôn cả người đã bị gỡ. Chính yêu cầu ép
      // phải có cột này, không phải chuyện thêm cho đẹp.
      //
      // Dùng DATETIME thay vì boolean thứ hai vì nó trả lời được câu hỏi đầu
      // tiên người ta hỏi khi một người quay lại: "gỡ từ bao giờ?". Và nó khớp
      // idiom `deleted_at` mà mọi bảng khác đang dùng.
      //
      //   is_active=1, removed_at=NULL      -> thành viên bình thường
      //   is_active=0, removed_at=NULL      -> BỊ KHOÁ, vẫn trong danh sách
      //   is_active=0, removed_at=<lúc gỡ>  -> ĐÃ GỠ khỏi tổ chức
      //
      // Mời lại người đã gỡ = ON DUPLICATE KEY UPDATE trên uq_memberships_user_tenant
      // sẵn có, đặt removed_at=NULL. Không cần bảng lời mời riêng.
      //
      // An toàn khi triển khai: cả ba truy vấn membership hiện tại đều lọc
      // `is_active = 1`, mà thao tác gỡ luôn đặt `is_active = 0`, nên nếu chỗ
      // nào quên thêm `removed_at IS NULL` thì hậu quả là SỐ LIỆU SAI, không
      // phải lỗ hổng phân quyền. Vẫn thêm vào cả ba.
      `ALTER TABLE memberships
         ADD COLUMN removed_at DATETIME(3) NULL AFTER is_active`,

      // Index cho truy vấn chủ đạo của §3.3: "thành viên còn trong tổ chức này".
      // Thứ tự cột theo độ chọn lọc giảm dần và theo cách WHERE được viết:
      // tenant_id luôn có, removed_at luôn có, is_active chỉ khi lọc theo trạng
      // thái. idx_memberships_tenant_role vẫn giữ nguyên cho nhánh lọc theo vai trò.
      `ALTER TABLE memberships
         ADD KEY idx_memberships_tenant_live (tenant_id, removed_at, is_active)`,
    ],
  },

  {
    id: 3,
    name: 'workspace_lock_flag',
    statements: [
      // ─── workspaces.is_active ────────────────────────────────────────────
      //
      // Console hệ thống cần "khoá / mở workspace" — tạm ngừng một không gian
      // làm việc mà KHÔNG xoá nó. `deleted_at` không diễn tả được việc đó:
      // xoá là hành động một chiều mang nghĩa "biến mất khỏi danh sách", còn
      // khoá là trạng thái tạm và đảo ngược được.
      //
      // Cùng cặp cột với `tenants` và `users` (`is_active` + `deleted_at`), nên
      // ba bảng cùng một ngữ nghĩa: is_active=0 là tạm ngừng, deleted_at khác
      // NULL là đã xoá mềm.
      `ALTER TABLE workspaces
         ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER description`,

      // Truy vấn chủ đạo của console: workspace còn sống của một tổ chức.
      // idx_workspaces_tenant_deleted có sẵn vẫn giữ cho nhánh chỉ lọc deleted_at.
      `ALTER TABLE workspaces
         ADD KEY idx_workspaces_tenant_live (tenant_id, deleted_at, is_active)`,
    ],
  },
];
