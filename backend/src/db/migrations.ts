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

  {
    id: 4,
    name: 'casbin_rule',
    statements: [
      // ─── casbin_rule: ma trận quyền của §6.3 ─────────────────────────────
      //
      // Tên bảng và tên cột (`ptype`, `v0`…`v5`) là QUY ƯỚC CỦA CASBIN, không
      // phải lựa chọn của ta — mọi adapter chính thức đọc đúng hình dạng này.
      // Đổi tên cột cho "dễ hiểu hơn" là tự khoá mình khỏi việc thay adapter.
      //
      // Ánh xạ sang model (xem `authz/model.ts`):
      //   ptype='p' -> v0=vai trò  v1=tenantId  v2=tài nguyên  v3=hành động
      //   ptype='g' -> v0=người    v1=vai trò    v2=tenantId
      //
      // `v1 = '*'` ở mọi dòng gieo bên dưới: ma trận vai trò giống nhau ở MỌI
      // tổ chức. Cột domain vẫn giữ để sau này một công ty muốn nới/siết riêng
      // thì thêm dòng với `v1 = '<tenantId>'`, không phải đổi schema.
      //
      // Cột dài 100 và cho NULL vì Casbin dùng chung bảng này cho cả `p` lẫn
      // `g`, mà hai loại dùng số cột khác nhau.
      //
      // `uq_casbin_rule` chặn dòng trùng ở tầng DATABASE. Nếu không, chạy lại
      // phần gieo hoặc gọi `addPolicy` hai lần sẽ nhân đôi luật: Casbin vẫn cho
      // kết quả đúng (`some(allow)` nên trùng không đổi kết quả), nhưng bảng
      // phình dần và người đọc không biết dòng nào mới là thật.
      //
      // LƯU Ý cho người sửa file này: KHÔNG đặt dấu backtick vào bên trong chuỗi
      // template — kể cả trong một câu chú thích SQL `--`. Nó đóng chuỗi ngay tại
      // đó và lỗi hiện ra dưới dạng một thông báo cú pháp TypeScript ở dòng khác
      // hẳn. Mọi chú thích để ở đây, ngoài chuỗi.
      `CREATE TABLE IF NOT EXISTS casbin_rule (
        id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ptype VARCHAR(10)  NOT NULL,
        v0    VARCHAR(100) NULL,
        v1    VARCHAR(100) NULL,
        v2    VARCHAR(100) NULL,
        v3    VARCHAR(100) NULL,
        v4    VARCHAR(100) NULL,
        v5    VARCHAR(100) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_casbin_rule (ptype, v0, v1, v2, v3, v4, v5),
        KEY idx_casbin_ptype (ptype)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── Gieo ma trận mặc định ───────────────────────────────────────────
      //
      // Viết thẳng ra đây thay vì `for` trên `DEFAULT_POLICY` của @bi/shared,
      // vì migration ĐÃ CHẠY là bất biến: nội dung nó ghi vào database phải đọc
      // được từ chính file này mãi mãi, không phụ thuộc phiên bản hiện tại của
      // một hằng số ở package khác. `DEFAULT_POLICY` sau này đổi thì thêm
      // migration mới, và bài test `rbac` sẽ bắt được lúc hai bên lệch nhau.
      //
      // INSERT IGNORE để chạy lại trên database đã có dữ liệu là vô hại.
      `INSERT IGNORE INTO casbin_rule (ptype, v0, v1, v2, v3) VALUES
         ('p', 'admin',   '*', '*',         '*'),

         ('p', 'creator', '*', 'dataset',   'read'),
         ('p', 'creator', '*', 'dataset',   'modify'),
         ('p', 'creator', '*', 'datamodel', 'read'),
         ('p', 'creator', '*', 'datamodel', 'modify'),
         ('p', 'creator', '*', 'report',    'read'),
         ('p', 'creator', '*', 'report',    'modify'),
         ('p', 'creator', '*', 'chart',     'read'),
         ('p', 'creator', '*', 'chart',     'modify'),
         ('p', 'creator', '*', 'project',   'read'),
         ('p', 'creator', '*', 'project',   'modify'),
         ('p', 'creator', '*', 'project',   'delete'),
         ('p', 'creator', '*', 'workspace', 'read'),
         ('p', 'creator', '*', 'member',    'read'),

         ('p', 'viewer',  '*', 'dataset',   'read'),
         ('p', 'viewer',  '*', 'datamodel', 'read'),
         ('p', 'viewer',  '*', 'report',    'read'),
         ('p', 'viewer',  '*', 'chart',     'read'),
         ('p', 'viewer',  '*', 'project',   'read'),
         ('p', 'viewer',  '*', 'workspace', 'read'),
         ('p', 'viewer',  '*', 'member',    'read')`,
    ],
  },

  {
    id: 5,
    name: 'personal_tenant',
    statements: [
      // ─── tenants.owner_user_id: tổ chức RIÊNG của một người ──────────────
      //
      // Người tự đăng ký lập ra công ty của mình và làm admin ở đó. Người được
      // Admin tổ chức khác tạo tài khoản thì trước đây KHÔNG có gì của riêng
      // mình — chỉ là thành viên trong tổ chức của người mời. Cột này cho họ một
      // không gian riêng ngang hàng: cùng bảng `tenants`, cùng workspace mặc
      // định, cùng vai trò `admin`.
      //
      // MỘT cột duy nhất, cố ý KHÔNG thêm `kind ENUM('org','personal')` song
      // song: hai cột cùng trả lời một câu hỏi là hai nguồn sự thật, và chúng
      // sẽ lệch nhau ở đúng chỗ không ai nhìn. `owner_user_id IS NOT NULL` đã
      // là định nghĩa đầy đủ của "tổ chức cá nhân", và nó còn nói thêm được
      // CỦA AI — thứ mà một cột ENUM không nói được.
      //
      // `ON DELETE SET NULL` chứ không CASCADE, theo đúng khuôn
      // fk_workspaces_creator. CASCADE sẽ xoá cả tenant, mà fk_workspaces_tenant
      // là RESTRICT nên thao tác đó chỉ nổ lỗi. Hệ thống dùng xoá mềm nên nhánh
      // này gần như không bao giờ chạy; khi nó chạy, tổ chức chỉ mất dấu chủ
      // sở hữu chứ không kéo theo dữ liệu nào biến mất.
      `ALTER TABLE tenants
         ADD COLUMN owner_user_id BIGINT UNSIGNED NULL AFTER slug,
         ADD CONSTRAINT fk_tenants_owner FOREIGN KEY (owner_user_id)
           REFERENCES users (id) ON DELETE SET NULL`,

      // UNIQUE trên cột cho phép NULL: MySQL coi mỗi NULL là một giá trị khác
      // nhau, nên MỌI tổ chức thật (owner_user_id = NULL) vẫn sống chung thoải
      // mái, còn "mỗi người tối đa MỘT tổ chức cá nhân" thì được database bảo
      // đảm. Đặt ràng buộc ở đây thay vì kiểm bằng một câu SELECT trước khi
      // INSERT: giữa SELECT và INSERT luôn có khe hở cho hai request đồng thời,
      // và hậu quả là một người có hai không gian riêng mà không ai gỡ được.
      `ALTER TABLE tenants ADD UNIQUE KEY uq_tenants_owner (owner_user_id)`,
    ],
  },

  {
    id: 6,
    name: 'data_connections',
    statements: [
      // ─── connections: CSDL CỦA KHÁCH HÀNG mà tổ chức trỏ tới ─────────────
      //
      // Đây là bảng đầu tiên trong dự án chạm tới hệ thống bên ngoài, nên có
      // ba điểm khác mọi bảng trước đó:
      //
      // 1. `password_cipher` là MÃ HOÁ ĐỐI XỨNG, không phải hash. Mật khẩu
      //    người dùng chỉ cần so khớp nên bcrypt một chiều là đủ; mật khẩu CSDL
      //    thì phải LẤY LẠI ĐƯỢC mới mở được kết nối. Xem services/connections/
      //    secretBox.ts. TEXT chứ không VARCHAR: bản mã dài hơn bản rõ và còn
      //    mang theo iv + thẻ xác thực.
      //
      // 2. KHÔNG có cột nào lưu mật khẩu dạng rõ, kể cả tạm. Không có đường
      //    nào để một câu SELECT vô tình phơi nó ra log.
      //
      // 3. `last_test_error` lưu lý do lần kiểm tra gần nhất thất bại. Người
      //    vận hành mở danh sách phải thấy ngay kết nối nào đang hỏng và hỏng
      //    vì sao, thay vì phải bấm thử từng cái.
      //
      // UNIQUE (tenant_id, name): trùng tên trong CÙNG tổ chức mới là lỗi; hai
      // công ty đều đặt tên "CRM sản xuất" là chuyện bình thường.
      //
      // UNIQUE (tenant_id, id) trông thừa vì `id` đã là khoá chính — nó KHÔNG
      // thừa: đây là đích cho khoá ngoại GHÉP của `datasets` bên dưới, đúng
      // khuôn mà `workspaces` làm cho `projects`.
      `CREATE TABLE IF NOT EXISTS connections (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id       BIGINT UNSIGNED NOT NULL,
        name            VARCHAR(255) NOT NULL,
        kind            ENUM('mysql','postgres','clickhouse') NOT NULL,
        host            VARCHAR(255) NOT NULL,
        port            SMALLINT UNSIGNED NOT NULL,
        database_name   VARCHAR(255) NOT NULL,
        username        VARCHAR(255) NOT NULL,
        password_cipher TEXT NOT NULL,
        last_tested_at  DATETIME(3)  NULL,
        last_test_error VARCHAR(500) NULL,
        created_by      BIGINT UNSIGNED NULL,
        deleted_at      DATETIME(3)  NULL,
        created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                     ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_connections_tenant_name (tenant_id, name),
        UNIQUE KEY uq_connections_tenant_id (tenant_id, id),
        KEY idx_connections_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_connections_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE CASCADE,
        -- Kết nối sống lâu hơn người tạo ra nó, giống workspace.
        CONSTRAINT fk_connections_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── datasets: mỗi BẢNG NGUỒN thành một tập dữ liệu ──────────────────
      //
      // `tenant_id` lặp lại dù suy ra được qua `connection_id`, và nó xứng đáng
      // vì đúng hai lý do đã dùng cho `projects`:
      //
      //  1. Mọi truy vấn thành `WHERE tenant_id = ? AND id = ?`, nên đọc nhầm
      //     tổ chức biến thành "không có dòng nào" thay vì "thiếu một câu if".
      //  2. Nó cho phép khoá ngoại GHÉP bên dưới, khiến việc gắn dataset vào
      //     connection của tổ chức KHÁC là bất khả thi ở tầng cơ sở dữ liệu.
      //
      // UNIQUE (tenant_id, connection_id, source_schema, source_table) là thứ
      // biến "đồng bộ lần hai" thành ON DUPLICATE KEY UPDATE. Thiếu nó, mỗi lần
      // bấm Đồng bộ là nhân đôi toàn bộ kho dữ liệu.
      //
      // `name` tách khỏi `source_table` vì mục 8.9 cho đổi tên hiển thị. Đổi
      // tên KHÔNG được làm mất dấu bảng nguồn, nếu không lần đồng bộ sau sẽ
      // tưởng đó là bảng mới và tạo thêm một dataset nữa.
      //
      // `column_count` là dữ liệu dẫn xuất từ `dataset_columns`, giữ ở đây để
      // bảng danh sách (8.5) không phải đếm bằng truy vấn con trên mỗi dòng.
      // Chỉ cập nhật trong cùng transaction với việc ghi cột.
      //
      // ON DELETE RESTRICT: xoá connection phải dọn dataset trước. Cascade sẽ
      // xoá lặng lẽ hàng trăm dataset — và mô hình dữ liệu dựng trên chúng —
      // vì một cú bấm nhầm.
      `CREATE TABLE IF NOT EXISTS datasets (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id     BIGINT UNSIGNED NOT NULL,
        connection_id BIGINT UNSIGNED NOT NULL,
        source_schema VARCHAR(255) NOT NULL,
        source_table  VARCHAR(255) NOT NULL,
        name          VARCHAR(255) NOT NULL,
        column_count  INT UNSIGNED NOT NULL DEFAULT 0,
        synced_at     DATETIME(3)  NULL,
        deleted_at    DATETIME(3)  NULL,
        created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                   ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_datasets_source (tenant_id, connection_id, source_schema, source_table),
        KEY idx_datasets_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_datasets_connection FOREIGN KEY (tenant_id, connection_id)
          REFERENCES connections (tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── dataset_columns: schema của bảng nguồn ──────────────────────────
      //
      // Bảng RIÊNG chứ không phải một cột JSON trong `datasets`. Section 09 sẽ
      // định nghĩa dimension và measure trỏ tới từng cột cụ thể, mà một mảng
      // JSON thì không đặt được khoá ngoại lên phần tử của nó — đến lúc đó sẽ
      // phải di trú dữ liệu thật thay vì chỉ thêm một bảng.
      //
      // CASCADE theo dataset: cột không có ý nghĩa độc lập.
      //
      // `ordinal` giữ đúng thứ tự cột của bảng nguồn. Sắp theo tên trông gọn
      // hơn nhưng người đọc schema mong thấy đúng thứ tự họ đã khai trong CSDL.
      `CREATE TABLE IF NOT EXISTS dataset_columns (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        dataset_id  BIGINT UNSIGNED NOT NULL,
        name        VARCHAR(255) NOT NULL,
        data_type   VARCHAR(100) NOT NULL,
        is_nullable TINYINT(1)   NOT NULL DEFAULT 1,
        ordinal     INT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dataset_columns_name (dataset_id, name),
        KEY idx_dataset_columns_order (dataset_id, ordinal),
        CONSTRAINT fk_dataset_columns_dataset FOREIGN KEY (dataset_id)
          REFERENCES datasets (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },

  {
    id: 7,
    name: 'connection_ssl',
    statements: [
      // ─── use_ssl: bọc kết nối trong TLS ──────────────────────────────────
      //
      // Không có cột này thì mọi CSDL nằm trên Internet công cộng đều nối
      // không được — ClickHouse Cloud chỉ nhận HTTPS ở cổng 8443 và đóng phăng
      // socket khi nhận HTTP thô, còn MySQL của các nhà cung cấp dịch vụ thì
      // bắt buộc TLS.
      //
      // TRẠNG THÁI LƯU LẠI chứ không suy ra từ `port`. Suy ra thì đọc rất gọn
      // ("8443 nghĩa là TLS") nhưng số cổng chỉ là quy ước: một máy chủ tự dựng
      // hoàn toàn có thể chạy TLS ở 9000, và khi đoán sai thì thứ người dùng
      // nhận được là "máy chủ đóng kết nối" — câu không chỉ ra được ai phải sửa
      // gì. Một cột TINYINT rẻ hơn nhiều so với lớp lỗi ấy.
      //
      // DEFAULT 0: những kết nối đã lưu trước migration này đều đang chạy HTTP
      // thô và vẫn phải chạy y như cũ sau khi nâng cấp.
      `ALTER TABLE connections ADD COLUMN use_ssl TINYINT(1) NOT NULL DEFAULT 0 AFTER port`,

      // ─── Thu hẹp ENUM: bỏ 'postgres' ─────────────────────────────────────
      //
      // ⚠️ Đây là ngoại lệ của quy ước "ENUM chỉ nối thêm vào cuối" ghi ở đầu
      // file, nên phải nói rõ vì sao nó an toàn ở ĐÚNG trường hợp này: giá trị
      // 'postgres' chưa bao giờ rời khỏi nhánh đang phát triển, nên không có
      // dòng dữ liệu thật nào mang nó.
      //
      // Nếu vẫn còn một dòng như vậy, MySQL ở chế độ strict sẽ dừng migration
      // với "Data truncated for column 'kind'" thay vì lặng lẽ biến giá trị đó
      // thành chuỗi rỗng. Dừng ồn ào là hành vi đúng: người vận hành phải tự
      // quyết định xử lý kết nối đó thế nào, không phải để một câu ALTER quyết
      // hộ.
      `ALTER TABLE connections MODIFY COLUMN kind ENUM('mysql','clickhouse') NOT NULL`,
    ],
  },

  {
    id: 8,
    name: 'unify_datasets_with_file_source',
    statements: [
      // ─── MỘT khái niệm "bộ dữ liệu", HAI nguồn ───────────────────────────
      //
      // §8 dựng `datasets` cho bảng đồng bộ từ CSDL khách hàng. §7 cần bộ dữ
      // liệu đến từ file Excel/CSV tải lên. Hai thứ đó KHÔNG phải hai khái niệm
      // — với người dùng thì cả hai đều là "bộ dữ liệu tôi có thể dựng báo cáo
      // lên", và họ không nên phải nhớ mình đã nạp nó bằng đường nào để tìm lại.
      //
      // Nên MỞ RỘNG bảng của §8 thay vì tạo bảng thứ hai. Bảng thứ hai nghĩa là
      // hai trang danh sách, hai câu truy vấn cho mọi chỗ đếm, và một câu hỏi
      // "cái nào là cái nào" lặp lại vĩnh viễn.
      //
      // Migration này CHỈ ALTER, không CREATE lại: dữ liệu §8 đã có trên máy
      // người khác và phải sống sót.

      // `source` phân biệt hai nguồn. DEFAULT 'connection' để mọi dòng đã có
      // được gán đúng mà không cần câu UPDATE riêng.
      //
      // Đặt 'connection' TRƯỚC 'file' trong ENUM vì đó là giá trị đã tồn tại;
      // quy ước ENUM của repo là nối giá trị mới vào cuối.
      `ALTER TABLE datasets
         ADD COLUMN source ENUM('connection','file') NOT NULL DEFAULT 'connection'
           AFTER tenant_id`,

      // ─── workspace_id: cho CẢ HAI nguồn ──────────────────────────────────
      //
      // §8 để bộ dữ liệu ở phạm vi tổ chức, §7 gắn vào workspace. Chọn phạm vi
      // workspace cho cả hai: project và report đều thuộc workspace, nên để
      // riêng bộ dữ liệu ở phạm vi tổ chức là một ngoại lệ mà người dùng phải
      // học thuộc.
      //
      // NULL được, và đó là chủ ý cho dữ liệu CŨ: những bộ dữ liệu §8 tạo trước
      // migration này chưa thuộc workspace nào. Ép NOT NULL sẽ phải bịa ra một
      // workspace cho chúng — bịa sai thì dữ liệu của người ta nhảy sang bộ phận
      // khác. Giao diện hiện chúng ở mục "chưa gán workspace" để người dùng tự
      // quyết định.
      //
      // Bộ dữ liệu MỚI luôn có workspace: tầng ứng dụng bắt buộc, xem
      // `repositories/datasets.ts`.
      `ALTER TABLE datasets
         ADD COLUMN workspace_id BIGINT UNSIGNED NULL AFTER source,
         ADD KEY idx_datasets_workspace (tenant_id, workspace_id, deleted_at),
         ADD CONSTRAINT fk_datasets_workspace FOREIGN KEY (tenant_id, workspace_id)
           REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE`,

      // ─── Ba cột của §8 thành tuỳ chọn ────────────────────────────────────
      //
      // Bộ dữ liệu từ file không có kết nối, không có schema nguồn, không có
      // bảng nguồn. Giữ NOT NULL thì phải nhét giá trị giả vào — và một
      // `connection_id = 0` trỏ vào hư không là thứ sẽ làm hỏng một câu JOIN nào
      // đó về sau.
      //
      // Khoá ngoại phải gỡ trước khi đổi cột sang NULL, rồi gắn lại.
      `ALTER TABLE datasets DROP FOREIGN KEY fk_datasets_connection`,
      `ALTER TABLE datasets
         MODIFY COLUMN connection_id BIGINT UNSIGNED NULL,
         MODIFY COLUMN source_schema VARCHAR(255) NULL,
         MODIFY COLUMN source_table  VARCHAR(255) NULL`,
      `ALTER TABLE datasets
         ADD CONSTRAINT fk_datasets_connection FOREIGN KEY (tenant_id, connection_id)
           REFERENCES connections (tenant_id, id) ON DELETE RESTRICT`,

      // ─── Cột riêng của nguồn FILE ────────────────────────────────────────
      //
      // Tất cả đều NULL được: dòng của §8 không có chúng. Ràng buộc "file thì
      // phải có s3_key" nằm ở tầng ứng dụng — MySQL không có CHECK ràng buộc
      // theo giá trị cột khác một cách đáng tin trên mọi phiên bản.
      //
      // `truncated` tồn tại vì `row_count` một mình nói dối: 50000 có thể là
      // "file có đúng 50000 dòng" hoặc "file có nửa triệu dòng và ta cắt". Trong
      // sản phẩm BI, để người ta tin vào một biểu đồ thiếu chín phần mười dữ
      // liệu là kiểu sai tệ nhất, nên sự thật đó phải nằm trong schema.
      `ALTER TABLE datasets
         ADD COLUMN project_id        BIGINT UNSIGNED NULL AFTER workspace_id,
         ADD COLUMN original_filename VARCHAR(255) NULL AFTER name,
         ADD COLUMN file_ext          ENUM('csv','xlsx') NULL AFTER original_filename,
         ADD COLUMN file_size_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER file_ext,
         ADD COLUMN s3_key            VARCHAR(512) NULL AFTER file_size_bytes,
         ADD COLUMN sheet_name        VARCHAR(255) NULL AFTER s3_key,
         ADD COLUMN status            ENUM('pending','ready','failed') NOT NULL DEFAULT 'ready'
                                      AFTER sheet_name,
         ADD COLUMN error_message     VARCHAR(500) NULL AFTER status,
         ADD COLUMN row_count         INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_message,
         ADD COLUMN truncated         TINYINT(1) NOT NULL DEFAULT 0 AFTER row_count,
         ADD COLUMN created_by        BIGINT UNSIGNED NULL,
         ADD KEY idx_datasets_s3_key (s3_key),
         ADD CONSTRAINT fk_datasets_creator FOREIGN KEY (created_by)
           REFERENCES users (id) ON DELETE SET NULL`,

      // `status` mặc định 'ready' để mọi dòng §8 đã có được gán đúng: chúng đã
      // đồng bộ xong. Chỉ nguồn file mới đi qua 'pending'.
      //
      // KHÔNG đặt UNIQUE trên `s3_key`: một file Excel nhiều sheet sinh ra NHIỀU
      // bộ dữ liệu cùng trỏ vào một object trên S3. Hệ quả phải nhớ: xoá một bộ
      // dữ liệu KHÔNG được xoá file, vì những bộ anh em vẫn cần nó.

      // ─── dataset_columns: thêm tầng ngữ nghĩa ────────────────────────────
      //
      // §8 lưu kiểu THÔ của CSDL (`data_type` = 'varchar(255)', 'bigint'...).
      // §7 cần thêm một tầng nữa: cột này là chữ hay số, dùng để nhóm hay để đo,
      // và tên người dùng muốn thấy trên biểu đồ.
      //
      // Giữ nguyên `name`, `ordinal`, `data_type`, `is_nullable` của §8 —
      // code của họ đọc đúng những cột đó và không được đổi.
      `ALTER TABLE dataset_columns
         ADD COLUMN field_name    VARCHAR(255) NULL AFTER name,
         ADD COLUMN semantic_type ENUM('text','number','date','boolean') NULL AFTER data_type,
         ADD COLUMN field_role    ENUM('dimension','measure') NULL AFTER semantic_type,
         ADD COLUMN included      TINYINT(1) NOT NULL DEFAULT 1 AFTER field_role`,

      // Danh tính của một cột là VỊ TRÍ, không phải TÊN.
      //
      // §6 đặt UNIQUE (dataset_id, name) — đúng với nguồn `connection`, vì CSDL
      // không cho hai cột cùng tên trong một bảng. Với file thì sai: bảng tính
      // thật rất hay có hai cột "Ghi chú", và ràng buộc đó biến một file hoàn
      // toàn bình thường thành lỗi 500 lúc nhập.
      //
      // `ordinal` đúng cho CẢ HAI nguồn và bắt được đúng lỗi mà ràng buộc cũ
      // muốn bắt: một cột bị ghi hai lần. Tên trùng giờ được `commit.ts` xử lý ở
      // tầng `field_name` — thứ làm khoá của document JSON và vì thế mới thật sự
      // bắt buộc phải duy nhất.
      `ALTER TABLE dataset_columns
         DROP INDEX uq_dataset_columns_name,
         ADD UNIQUE KEY uq_dataset_columns_ordinal (dataset_id, ordinal)`,

      // ─── dataset_rows: dữ liệu thật của nguồn FILE ───────────────────────
      //
      // Chỉ nguồn file mới có bảng này. Bộ dữ liệu §8 đọc thẳng từ CSDL nguồn
      // qua kết nối, không sao chép dòng nào sang đây.
      //
      // Mỗi dòng là một document JSON thay vì sinh một bảng riêng cho mỗi bộ dữ
      // liệu. DDL lúc chạy nghĩa là: xoá mềm để lại một bảng mồ côi mà không
      // migration nào mô tả, và một tên cột do người dùng đặt trong Excel đi
      // thẳng vào câu CREATE TABLE.
      //
      // Khoá chính GHÉP (dataset_id, row_index), không có id tự tăng: dòng dữ
      // liệu không có danh tính riêng ngoài vị trí của nó trong file. Khoá ghép
      // cũng là khoá gom cụm của InnoDB, nên đọc cả bộ dữ liệu là đọc tuần tự
      // trên đĩa thay vì nhảy theo secondary index.
      `CREATE TABLE IF NOT EXISTS dataset_rows (
        dataset_id BIGINT UNSIGNED NOT NULL,
        row_index  INT UNSIGNED NOT NULL,
        data       JSON NOT NULL,
        PRIMARY KEY (dataset_id, row_index),
        CONSTRAINT fk_dataset_rows_dataset FOREIGN KEY (dataset_id)
          REFERENCES datasets (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── reports: một biểu đồ dựng trên một bộ dữ liệu ───────────────────
      //
      // `chart_type` và `config` để NULL: wizard tạo bản ghi RỖNG, người dùng
      // dựng biểu đồ sau trên trang Report. NULL ở đây là dữ liệu thật — nó phân
      // biệt "chưa ai dựng biểu đồ" với "đã dựng và chọn biểu đồ cột".
      //
      // `config` là JSON chứ không phải một loạt cột: mỗi loại biểu đồ cần một
      // bộ tham số khác nhau, và biểu đồ tròn không có trục X. Trải thành cột
      // nghĩa là phần lớn cột luôn NULL, và thêm một loại biểu đồ là một
      // migration.
      //
      // ON DELETE RESTRICT với dataset: xoá bộ dữ liệu mà cuốn theo báo cáo của
      // người khác là mất dữ liệu ngoài ý muốn.
      `CREATE TABLE IF NOT EXISTS reports (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id    BIGINT UNSIGNED NOT NULL,
        workspace_id BIGINT UNSIGNED NOT NULL,
        dataset_id   BIGINT UNSIGNED NOT NULL,
        name         VARCHAR(255) NOT NULL,
        chart_type   ENUM('bar','line','area','pie','table') NULL,
        config       JSON NULL,
        created_by   BIGINT UNSIGNED NULL,
        deleted_at   DATETIME(3)  NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_reports_workspace_live (workspace_id, deleted_at),
        KEY idx_reports_tenant_deleted (tenant_id, deleted_at),
        KEY idx_reports_dataset (dataset_id),
        CONSTRAINT fk_reports_workspace FOREIGN KEY (tenant_id, workspace_id)
          REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_reports_dataset FOREIGN KEY (dataset_id)
          REFERENCES datasets (id) ON DELETE RESTRICT,
        CONSTRAINT fk_reports_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── §7.8 Creator được XOÁ bộ dữ liệu và báo cáo ─────────────────────
      //
      // Migration 4 chỉ cho Creator read + modify trên hai tài nguyên này.
      // Người tạo một bộ dữ liệu từ file của chính mình mà không xoá được nó thì
      // mỗi lần tải nhầm file là một bản ghi rác nằm lại vĩnh viễn và phải đi
      // nhờ Admin. Đó cũng chính là lý do migration 4 đã cho Creator xoá
      // `project`.
      //
      // ⚠️ Bài test `rbac.integration` đối chiếu số dòng trong bảng với
      // `DEFAULT_POLICY.length` của @bi/shared. Sửa ở đây mà quên sửa bên kia là
      // đỏ ngay — đó chính là việc của bài test đó.
      `INSERT IGNORE INTO casbin_rule (ptype, v0, v1, v2, v3) VALUES
         ('p', 'creator', '*', 'dataset', 'delete'),
         ('p', 'creator', '*', 'report',  'delete')`,
    ],
  },

  {
    id: 9,
    name: 'clickhouse_ingest',
    statements: [
      // ═══ §9 Nạp dữ liệu vào ClickHouse ═══════════════════════════════════
      //
      // Đây là mục đầu tiên nền tảng GIỮ dữ liệu THẬT của khách hàng, ngược hẳn
      // nguyên tắc của §8 (chỉ chép cấu trúc). Dữ liệu không nằm trong MySQL —
      // nó sang ClickHouse. Những bảng dưới đây chỉ là SỔ GHI CHÉP: ai bấm nạp
      // lúc nào, chạy tới đâu, dòng nào hỏng vì sao.
      //
      // Ranh giới đó phải giữ cho rõ. Ngày nào có người thêm cột "dữ liệu" vào
      // đây thì hệ thống có hai kho phân tích, và không ai biết kho nào đúng.

      // ─── data_type phải chứa nổi kiểu ĐẦY ĐỦ ─────────────────────────────
      //
      // Driver MySQL đổi từ `data_type` sang `column_type` cùng nhánh này, nên
      // giá trị lưu vào đây dài hơn hẳn: `decimal(18,4)` thay cho `decimal`,
      // `enum('a','b',…)` thay cho `enum`. 100 ký tự cũ đủ cho kiểu gốc nhưng
      // không đủ cho enum, và MySQL ở chế độ strict sẽ làm HỎNG cả lần đồng bộ
      // chứ không cắt bớt.
      `ALTER TABLE dataset_columns MODIFY COLUMN data_type VARCHAR(255) NOT NULL`,

      // ─── Mở đường cho khoá ngoại ghép ────────────────────────────────────
      //
      // Quy ước cách ly tổ chức của repo: bảng con trỏ tới cha bằng
      // (tenant_id, id), không phải id trần. Nhờ vậy một dòng con KHÔNG THỂ trỏ
      // sang cha của tổ chức khác — chính database từ chối, không phụ thuộc vào
      // việc mọi câu WHERE đều nhớ lọc `tenant_id`.
      //
      // `datasets` chưa có UNIQUE (tenant_id, id) nên chưa làm đích của FK ghép
      // được. `id` đã là khoá chính nên chỉ số này không thêm ràng buộc thật nào
      // — nó chỉ khai với InnoDB rằng cặp đó là duy nhất.
      `ALTER TABLE datasets ADD UNIQUE KEY uq_datasets_tenant_id (tenant_id, id)`,

      // ─── Trạng thái nạp, TÁCH khỏi `status` của §7 ───────────────────────
      //
      // Không mượn lại `status` (pending/ready/failed): cột đó nói về việc FILE
      // đã phân tích xong chưa. Một dataset hoàn toàn có thể `status='ready'` mà
      // chưa từng được nạp lên ClickHouse — và với mọi dataset nguồn
      // `connection` thì đó là trạng thái mặc định. Gộp hai vòng đời khác nhau
      // vào một cột là thứ về sau không tách ra được.
      //
      // `ch_table` lưu tên bảng ĐANG PHỤC VỤ. Suy lại từ (tenant_id, id) cũng
      // được, nhưng lưu ra thì khi đi dọn rác ta biết chắc bảng nào của ai mà
      // không phải chạy lại một hàm sinh tên có thể đã đổi.
      `ALTER TABLE datasets
         ADD COLUMN load_status ENUM('idle','queued','running','loaded','failed')
                                NOT NULL DEFAULT 'idle' AFTER truncated,
         ADD COLUMN ch_table    VARCHAR(255) NULL AFTER load_status,
         ADD COLUMN loaded_at   DATETIME(3)  NULL AFTER ch_table,
         ADD COLUMN loaded_row_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER loaded_at,
         ADD KEY idx_datasets_load_status (load_status)`,

      // ─── dataset_load_runs: vừa là LỊCH SỬ, vừa là HÀNG ĐỢI ──────────────
      //
      // Không thêm BullMQ/Redis queue cho một tác vụ chạy vài lần một ngày. Vòng
      // lặp nền trong chính tiến trình Node nhặt dòng `queued` cũ nhất bằng
      // `UPDATE … WHERE status='queued' … LIMIT 1` rồi đọc `affectedRows` —
      // chính InnoDB làm trọng tài, nên hai tiến trình (rất hay gặp ở dev vì
      // `tsx watch` restart liên tục) không thể cùng nhận một việc.
      //
      // `idx_load_runs_queue (status, id)` là chỉ mục phục vụ đúng câu nhặt việc
      // đó: lọc theo status rồi lấy id nhỏ nhất, không phải quét bảng.
      //
      // ON DELETE CASCADE theo dataset: xoá bộ dữ liệu thì lịch sử nạp của nó
      // không còn nghĩa gì. Nhưng người bấm nút thì SET NULL — xoá một nhân sự
      // không được phép xoá lịch sử vận hành.
      `CREATE TABLE IF NOT EXISTS dataset_load_runs (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id     BIGINT UNSIGNED NOT NULL,
        dataset_id    BIGINT UNSIGNED NOT NULL,
        status        ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
        rows_read     BIGINT UNSIGNED NOT NULL DEFAULT 0,
        rows_loaded   BIGINT UNSIGNED NOT NULL DEFAULT 0,
        rows_failed   INT UNSIGNED    NOT NULL DEFAULT 0,
        error_message VARCHAR(500) NULL,
        triggered_by  BIGINT UNSIGNED NULL,
        queued_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        started_at    DATETIME(3) NULL,
        finished_at   DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY idx_load_runs_queue (status, id),
        KEY idx_load_runs_dataset (dataset_id, id),
        CONSTRAINT fk_load_runs_dataset FOREIGN KEY (tenant_id, dataset_id)
          REFERENCES datasets (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_load_runs_user FOREIGN KEY (triggered_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── dataset_load_errors: dòng nào hỏng, vì sao (§9.8) ───────────────
      //
      // Có TRẦN 100 dòng mỗi lần nạp, cưỡng chế ở tầng ứng dụng. Mục tiêu là cho
      // người dùng biết KIỂU lỗi để đi sửa nguồn — mười dòng đầu đã đủ nói
      // "cột Ngày giao có định dạng d/m/Y". Không có trần thì một file sai định
      // dạng ngày ở cả 50.000 dòng sẽ chép nguyên bản sao dữ liệu hỏng vào
      // MySQL, và bảng sổ ghi chép to hơn cả thứ nó ghi chép.
      //
      // `raw_value` cắt còn 255 ký tự: đây là manh mối để đi sửa, không phải bản
      // lưu. Ô JSON dài vài KB không giúp ai thêm được gì.
      `CREATE TABLE IF NOT EXISTS dataset_load_errors (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        run_id      BIGINT UNSIGNED NOT NULL,
        row_index   BIGINT UNSIGNED NOT NULL,
        column_name VARCHAR(255) NULL,
        raw_value   VARCHAR(255) NULL,
        reason      VARCHAR(255) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_load_errors_run (run_id, id),
        CONSTRAINT fk_load_errors_run FOREIGN KEY (run_id)
          REFERENCES dataset_load_runs (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // KHÔNG có migration `casbin_rule` ở đây, và đó là kết luận sau khi kiểm
      // chứ không phải bỏ sót: nạp dữ liệu là `dataset:modify`, xem tiến độ là
      // `dataset:read`. `creator` đã có cả hai từ migration 4, `admin` có (*,*).
      // Thêm quyền mới cho một hành động dùng lại quyền cũ chỉ làm bảng chính
      // sách phình ra mà không đổi ai làm được gì.
    ],
  },

  {
    id: 10,
    name: 'datamodel_core',
    statements: [
      // ═══ §10 Mô hình dữ liệu & Quan hệ ═══════════════════════════════════
      //
      // §9 đưa MỌI bộ dữ liệu vào một bảng `raw_t{tenant}_d{dataset}` trong
      // ClickHouse. Nhưng những bảng đó là dữ liệu THÔ: cột tên `SL_BAN`, kiểu
      // `Nullable(Float64)`, và không có gì nói cho máy biết cột nào để NHÓM,
      // cột nào để ĐO, hay hai bảng nối nhau bằng khoá nào.
      //
      // Những bảng dưới đây là TẦNG NGỮ NGHĨA đó. Chúng không chứa một dòng dữ
      // liệu nghiệp vụ nào — chỉ chứa lời mô tả về dữ liệu nằm ở ClickHouse.
      // Express đọc chúng để SINH RA file cube schema cho Cube.js (ADR-08).
      //
      // Ranh giới phải giữ cho rõ, cùng tinh thần với ghi chú ở migration 9:
      // ngày nào có người thêm cột "dữ liệu" vào đây thì hệ thống có hai nguồn
      // sự thật, và không ai biết nguồn nào đúng.
      //
      // ─── Xoá mềm hay xoá cứng: KHÔNG đồng nhất, và đó là chủ ý ───────────
      //
      //   xoá mềm   datamodels, datamodel_measures, datamodel_relationships
      //   xoá cứng  datamodel_datasets, datamodel_columns
      //
      // Ranh giới là: thứ NGƯỜI DÙNG ĐẶT TÊN và có thể muốn lấy lại thì xoá
      // mềm; dòng NỐI mà cả mục đích tồn tại là để cascade thì xoá cứng. Gỡ một
      // bộ dữ liệu khỏi mô hình PHẢI kéo theo cột và thước đo của nó — xoá mềm ở
      // đó chỉ để lại rác mà bộ sinh schema vẫn đem đi sinh.
      //
      // Ghi ra đây vì đây là chỗ người đọc sẽ thấy sự khác nhau và tưởng là sơ
      // suất.

      // ─── datamodels ──────────────────────────────────────────────────────
      //
      // Thuộc về WORKSPACE chứ không phải cả tổ chức: một mô hình là cách một
      // nhóm nhìn dữ liệu của họ, và hai phòng ban nhìn cùng một bảng theo hai
      // cách khác nhau là chuyện bình thường.
      `CREATE TABLE IF NOT EXISTS datamodels (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id    BIGINT UNSIGNED NOT NULL,
        workspace_id BIGINT UNSIGNED NOT NULL,
        name         VARCHAR(255) NOT NULL,
        description  VARCHAR(500) NULL,
        created_by   BIGINT UNSIGNED NULL,
        deleted_at   DATETIME(3) NULL,
        created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_datamodels_tenant_deleted (tenant_id, deleted_at),
        KEY idx_datamodels_workspace (tenant_id, workspace_id, deleted_at),
        CONSTRAINT fk_datamodels_workspace FOREIGN KEY (tenant_id, workspace_id)
          REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_datamodels_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // Điều kiện để làm ĐÍCH của khoá ngoại ghép — cùng lý do đã ghi ở
      // migration 9 khi `datasets` phải thêm chỉ số này. `id` đã là khoá chính
      // nên đây không thêm ràng buộc thật nào, nó chỉ khai với InnoDB rằng cặp
      // (tenant_id, id) là duy nhất để cặp đó được tham chiếu.
      `ALTER TABLE datamodels ADD UNIQUE KEY uq_datamodels_tenant_id (tenant_id, id)`,

      // ─── datamodel_datasets: một mô hình gom NHIỀU bộ dữ liệu ────────────
      //
      // Nhiều chứ không phải một, và đó là điều kiện để tab Quan hệ có nghĩa:
      // JOIN cần ít nhất hai bảng.
      //
      // XOÁ CỨNG, không `deleted_at` — khác hẳn `datamodels` ngay trên. Đây là
      // dòng NỐI, không phải tài liệu người dùng đặt tên. Gỡ một bộ dữ liệu khỏi
      // mô hình PHẢI kéo theo cột, thước đo và quan hệ trỏ vào nó; xoá mềm sẽ để
      // lại những thước đo mồ côi mà bộ sinh schema vẫn đem đi sinh, trỏ vào một
      // cube không còn tồn tại.
      //
      // `canvas_x/y` nằm ngay đây chứ không ở bảng riêng: một thẻ trên canvas
      // ĐÚNG BẰNG một dòng ở đây, nên canvas lấy node và vị trí trong một truy
      // vấn. Kéo thẻ chỉ ghi hai cột INT và cố ý KHÔNG đụng `updated_at` của
      // `datamodels` — di chuyển một cái hộp không phải thay đổi ngữ nghĩa, và
      // nó không được làm Cube biên dịch lại schema.
      `CREATE TABLE IF NOT EXISTS datamodel_datasets (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id    BIGINT UNSIGNED NOT NULL,
        datamodel_id BIGINT UNSIGNED NOT NULL,
        dataset_id   BIGINT UNSIGNED NOT NULL,
        canvas_x     INT NOT NULL DEFAULT 0,
        canvas_y     INT NOT NULL DEFAULT 0,
        created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_datamodel_datasets (datamodel_id, dataset_id),
        UNIQUE KEY uq_datamodel_datasets_tenant_id (tenant_id, id),
        CONSTRAINT fk_dmd_datamodel FOREIGN KEY (tenant_id, datamodel_id)
          REFERENCES datamodels (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmd_dataset FOREIGN KEY (tenant_id, dataset_id)
          REFERENCES datasets (tenant_id, id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── datamodel_columns: ngữ nghĩa từng cột (§10.3) ───────────────────
      //
      // Vì sao KHÔNG nhét vào `dataset_columns`: bảng đó mô tả NGUỒN và dùng
      // chung cho mọi mô hình. Ngữ nghĩa thì thuộc về MÔ HÌNH — cùng một cột
      // `SL_BAN` có thể là thước đo trong mô hình bán hàng và là chiều trong mô
      // hình tồn kho. Nhét chung là bắt hai mô hình ghi đè lên nhau.
      //
      // `role` có BA giá trị, không phải hai cộng một cờ `included`:
      //   dimension  cột để nhóm
      //   measure    cột để đo
      //   hidden     không hiện ở bất kỳ bộ chọn nào
      // `hidden` phục vụ hai việc cùng lúc — `_row_index` (cột hệ thống, không
      // bao giờ được lọt vào bộ chọn) và cột người dùng chủ động bỏ. Hai việc
      // đó có cùng một hệ quả nên không đáng hai cột.
      //
      // `ch_type` là ẢNH CHỤP kiểu lúc phân loại, KHÔNG phải nguồn sự thật —
      // `system.columns` mới là nguồn. Nó tồn tại để phát hiện LỆCH: nạp lại bộ
      // dữ liệu có thể biến `Int64` thành `String`, và khi đó tab Schemas nói
      // được "kiểu cột đã đổi" thay vì lặng lẽ `sum()` trên văn bản. Tuyệt đối
      // không đọc cột này để dựng SQL.
      `CREATE TABLE IF NOT EXISTS datamodel_columns (
        id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id            BIGINT UNSIGNED NOT NULL,
        datamodel_dataset_id BIGINT UNSIGNED NOT NULL,
        column_name          VARCHAR(255) NOT NULL,
        alias                VARCHAR(255) NULL,
        role                 ENUM('dimension','measure','hidden') NOT NULL,
        ch_type              VARCHAR(255) NOT NULL,
        ordinal              INT UNSIGNED NOT NULL,
        created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_datamodel_columns (datamodel_dataset_id, column_name),
        UNIQUE KEY uq_datamodel_columns_tenant_id (tenant_id, id),
        KEY idx_datamodel_columns_order (datamodel_dataset_id, ordinal),
        CONSTRAINT fk_dmc_dataset FOREIGN KEY (tenant_id, datamodel_dataset_id)
          REFERENCES datamodel_datasets (tenant_id, id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── datamodel_measures: thước đo do NGƯỜI DÙNG định nghĩa (§10.6) ───
      //
      // Khác `datamodel_columns.role='measure'`: cái kia nói "cột này là số, đo
      // được"; cái này là một thước đo có TÊN và có PHÉP TÍNH — "Tổng doanh thu"
      // = SUM(Doanh_thu). Một cột đẻ ra được nhiều thước đo (tổng, trung bình,
      // lớn nhất) nên đây bắt buộc là bảng riêng.
      //
      // `datamodel_column_id` cho phép NULL, và nó null CHÍNH XÁC khi
      // `agg = 'count'` — đếm dòng thì không có cột nào để đếm, đúng nghĩa mà
      // `aggregateWarehouse.ts` đã dùng cho `count`. Ràng buộc này cưỡng chế ở
      // tầng service chứ không bằng CHECK: MySQL 8 có hỗ trợ CHECK nhưng thông
      // báo lỗi của nó không dịch được sang một câu tiếng Việt dùng được.
      //
      // Trỏ bằng ID CỘT chứ không phải tên cột: đổi alias không làm hỏng thước
      // đo, và không thể định nghĩa thước đo trên một cột không nằm trong mô
      // hình — chính database từ chối.
      //
      // UNIQUE (datamodel_id, name): tên thước đo trở thành ĐỊNH DANH trong file
      // cube, nên trùng tên nghĩa là thước đo sau đè thước đo trước và một cái
      // biến mất trong im lặng — đúng lỗi mà `commit.ts` đã phải xử lý với tên
      // cột trùng trong file Excel.
      //
      // Xoá MỀM (khác `datamodel_columns` ngay trên, và đây là chủ ý): thước đo
      // là thứ người dùng đặt tên và một báo cáo sẽ trỏ tới id của nó. Xoá cứng
      // để lại một id treo mà không có cách nào nói "thước đo này đã bị xoá".
      `CREATE TABLE IF NOT EXISTS datamodel_measures (
        id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id            BIGINT UNSIGNED NOT NULL,
        datamodel_id         BIGINT UNSIGNED NOT NULL,
        datamodel_dataset_id BIGINT UNSIGNED NOT NULL,
        datamodel_column_id  BIGINT UNSIGNED NULL,
        name                 VARCHAR(255) NOT NULL,
        agg                  ENUM('sum','avg','count','min','max') NOT NULL,
        created_by           BIGINT UNSIGNED NULL,
        deleted_at           DATETIME(3) NULL,
        created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_datamodel_measures (datamodel_id, name),
        KEY idx_datamodel_measures_model (datamodel_id, deleted_at),
        CONSTRAINT fk_dmm_datamodel FOREIGN KEY (tenant_id, datamodel_id)
          REFERENCES datamodels (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmm_dataset FOREIGN KEY (tenant_id, datamodel_dataset_id)
          REFERENCES datamodel_datasets (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmm_column FOREIGN KEY (tenant_id, datamodel_column_id)
          REFERENCES datamodel_columns (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmm_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── datamodel_relationships (§10.4, §10.5) ──────────────────────────
      //
      // Trỏ tới `datamodel_datasets` chứ không tới `datasets`: một quan hệ chỉ
      // có nghĩa BÊN TRONG một mô hình, và ràng buộc này khiến việc nối sang một
      // bộ dữ liệu chưa được thêm vào mô hình trở thành bất khả thi ở tầng
      // database — không phụ thuộc vào việc mọi câu kiểm ở tầng ứng dụng đều nhớ.
      //
      // Khoá nối là ID CỘT, không phải TÊN cột. Ba hệ quả, đều mong muốn: đổi
      // alias không làm mồ côi quan hệ; KHÔNG THỂ nối vào một cột không nằm
      // trong mô hình (database từ chối, không phụ thuộc vào việc tầng ứng dụng
      // nhớ kiểm); và gỡ một bộ dữ liệu khỏi mô hình tự động kéo theo quan hệ
      // của nó.
      //
      // Hướng quan hệ NẰM Ở `kind`, và nó quyết định Cube sinh JOIN kiểu gì.
      // Đặt sai thì số vẫn ra, chỉ là sai — nên giao diện phải giải thích, không
      // chỉ đưa một ô chọn.
      //
      // KHÔNG có `many_to_many`: Cube cần một bảng trung gian cho quan hệ đó, và
      // sinh join nhiều-nhiều không có bảng cầu nối cho ra tổng bị NHÂN LÊN
      // trong im lặng. ENUM nối thêm giá trị vào cuối là thao tác tức thời, nên
      // khi nào có bảng cầu nối thật thì thêm, không phải dự trữ trước.
      //
      // KHÔNG có UNIQUE trên bộ khoá: xoá mềm sẽ khiến việc tạo lại đúng quan hệ
      // vừa xoá bị chặn. Trùng lặp bắt ở tầng service kèm thông báo tiếng Việt.
      `CREATE TABLE IF NOT EXISTS datamodel_relationships (
        id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id       BIGINT UNSIGNED NOT NULL,
        datamodel_id    BIGINT UNSIGNED NOT NULL,
        left_id         BIGINT UNSIGNED NOT NULL,
        left_column_id  BIGINT UNSIGNED NOT NULL,
        right_id        BIGINT UNSIGNED NOT NULL,
        right_column_id BIGINT UNSIGNED NOT NULL,
        kind            ENUM('one_to_many','many_to_one','one_to_one') NOT NULL,
        created_by      BIGINT UNSIGNED NULL,
        deleted_at      DATETIME(3) NULL,
        created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                     ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_datamodel_rel_model (datamodel_id, deleted_at),
        CONSTRAINT fk_dmr_datamodel FOREIGN KEY (tenant_id, datamodel_id)
          REFERENCES datamodels (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmr_left FOREIGN KEY (tenant_id, left_id)
          REFERENCES datamodel_datasets (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmr_right FOREIGN KEY (tenant_id, right_id)
          REFERENCES datamodel_datasets (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmr_left_col FOREIGN KEY (tenant_id, left_column_id)
          REFERENCES datamodel_columns (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmr_right_col FOREIGN KEY (tenant_id, right_column_id)
          REFERENCES datamodel_columns (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dmr_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── Quyền xoá mô hình dữ liệu ───────────────────────────────────────
      //
      // Migration 4 cố ý KHÔNG gieo `datamodel:delete`, với lý do ghi trong
      // `DEFAULT_POLICY`: cấp một quyền trước khi có endpoint để áp dụng là cách
      // policy lệch dần khỏi thực tế. §10 tạo ra endpoint đó, nên giờ mới gieo.
      //
      // ⚠️ `shared/src/rbac.ts` phải thêm đúng một dòng tương ứng — có một bài
      // test đối chiếu `COUNT(*) WHERE ptype='p'` với `DEFAULT_POLICY.length`,
      // và nó sẽ đỏ nếu chỉ sửa một bên. Đó chính là việc của bài test đó.
      `INSERT IGNORE INTO casbin_rule (ptype, v0, v1, v2, v3) VALUES
         ('p', 'creator', '*', 'datamodel', 'delete')`,
    ],
  },

  {
    id: 11,
    name: 'schema_fields',
    statements: [
      // ═══ §8.3 Schema và Field ════════════════════════════════════════════
      //
      // Migration 10 mô hình hoá `DataModel -> Dataset -> Column`. Yêu cầu sửa
      // lại thành `DataModel -> Schema -> Field`, và khác biệt KHÔNG chỉ là tên:
      //
      //   - Một Schema có TRANG CHI TIẾT riêng, không còn là một mục trong bảng.
      //   - Field không chỉ là cột trong kho. Mỗi cột SỐ tự sinh thêm bốn field
      //     TÍNH TOÁN: `_count`, `_countDistinct`, `_sum`, `_avg`.
      //   - Mỗi field có Visibility, Description và Display Name riêng.
      //
      // `datamodel_datasets` giữ nguyên và ĐÓNG VAI Schema — một Schema sinh ra
      // từ đúng một Dataset (§8.2), nên hai khái niệm là một. Đổi tên bảng chỉ
      // để cho khớp từ ngữ là một migration rủi ro đổi lấy con số không.

      // ─── Field: thêm ba thứ người dùng sửa được ──────────────────────────
      //
      // `visible` TÁCH khỏi `role`. Migration 10 dùng `role='hidden'` cho cả hai
      // việc, nhưng chúng khác nhau: một field có thể là thước đo (role) mà vẫn
      // bị ẩn khỏi bộ chọn (visible). Gộp lại thì bật lại một field đã ẩn sẽ mất
      // thông tin nó vốn là chiều hay thước đo.
      //
      // `_row_index` vẫn mang `role='hidden'` từ migration 10 và giờ thêm
      // `visible=0` — nó là cột hệ thống, không bao giờ được lọt vào bộ chọn dù
      // người dùng có bật gì đi nữa.
      `ALTER TABLE datamodel_columns
         ADD COLUMN display_name VARCHAR(255) NULL AFTER alias,
         ADD COLUMN description  VARCHAR(500) NULL AFTER display_name,
         ADD COLUMN visible      TINYINT(1) NOT NULL DEFAULT 1 AFTER description`,

      // ─── Field TÍNH TOÁN ─────────────────────────────────────────────────
      //
      // `calc_agg` NULL = field này là một CỘT THẬT trong ClickHouse.
      // Khác NULL  = field này được SINH RA từ một cột số, và `source_column_id`
      //              trỏ về cột đó để bộ sinh cube biết viết SQL trên cột nào.
      //
      // Vì sao field tính toán nằm chung bảng với cột thật, không phải bảng
      // riêng: trang chi tiết Schema hiện MỘT danh sách field, và cả hai loại
      // đều có Visibility, Description, Display Name y hệt nhau. Hai bảng nghĩa
      // là hai câu truy vấn, hai đường cập nhật, và một phép hợp ở mọi nơi đọc.
      //
      // `column_name` của field tính toán là `<tên cột>_sum`, `<tên cột>_avg`…
      // đúng quy ước §8.3.1. Nhờ vậy `UNIQUE (datamodel_dataset_id, column_name)`
      // của migration 10 vẫn đúng mà không phải đụng tới.
      `ALTER TABLE datamodel_columns
         ADD COLUMN calc_agg ENUM('count','countDistinct','sum','avg') NULL AFTER role,
         ADD COLUMN source_column_id BIGINT UNSIGNED NULL AFTER calc_agg,
         ADD KEY idx_dmc_source (source_column_id)`,

      // Khoá ngoại TỰ TRỎ trong cùng bảng: xoá một cột thật thì bốn field tính
      // toán dựng trên nó không còn nghĩa gì.
      `ALTER TABLE datamodel_columns
         ADD CONSTRAINT fk_dmc_source FOREIGN KEY (source_column_id)
           REFERENCES datamodel_columns (id) ON DELETE CASCADE`,

      // ─── `_row_index` không bao giờ hiện ─────────────────────────────────
      `UPDATE datamodel_columns SET visible = 0 WHERE column_name = '_row_index'`,

      // ─── `datamodel_measures` từ đây KHÔNG còn được ghi ──────────────────
      //
      // Thước đo giờ CHÍNH LÀ field tính toán, và đó là một nguồn sự thật duy
      // nhất thay vì hai nơi cùng định nghĩa một thứ. Tab Measures đổi thành chỗ
      // XEM những field đó.
      //
      // Bảng vẫn giữ, KHÔNG DROP: nó đã lên remote cùng migration 10, và xoá một
      // bảng để "cho sạch" là đánh đổi dữ liệu của người đã dùng lấy vẻ gọn gàng
      // của schema. Nó sẽ rỗng với mọi mô hình tạo từ đây.
    ],
  },
];
