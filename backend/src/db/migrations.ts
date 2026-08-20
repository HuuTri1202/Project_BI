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
    name: 'workspace_scoped_datasets',
    statements: [
      // ═══ Kho dữ liệu về đúng phạm vi workspace ═══════════════════════════
      //
      // Mỗi workspace quản lý nội dung RIÊNG. Project, report và mô hình dữ
      // liệu đã theo luật đó từ đầu (`workspace_id NOT NULL`); riêng `datasets`
      // thì không, và nó là chỗ duy nhất còn lệch.
      //
      // Lệch ở hai mức:
      //
      //   1. Cột cho phép NULL, và `syncDatasets` CỐ Ý ghi NULL cho mọi bảng
      //      đồng bộ từ kết nối — lý lẽ cũ là "kết nối là tài sản chung của tổ
      //      chức nên bảng lấy từ nó cũng vậy". Hệ quả người dùng nhìn thấy:
      //      bảng đồng bộ ở workspace A hiện luôn trong workspace B.
      //   2. `uq_datasets_source` chỉ gồm (tenant, connection, schema, table),
      //      nên một bảng nguồn chỉ tồn tại được ở ĐÚNG MỘT workspace trong cả
      //      tổ chức. Hai nhóm làm việc trên cùng một bảng `orders` sẽ giành
      //      nhau một dòng duy nhất.
      //
      // Ba câu dưới đây sửa cả hai, THEO ĐÚNG THỨ TỰ NÀY: điền chỗ trống trước,
      // rồi mới cấm để trống, rồi mới đổi khoá.

      // Điền workspace cho những dòng đang trống — workspace CŨ NHẤT của tổ
      // chức, tức là cái được tạo lúc đăng ký. Không có bước này thì lệnh
      // NOT NULL bên dưới sẽ hỏng, và tệ hơn: bật lọc theo workspace lên là
      // mọi bảng đồng bộ biến mất khỏi mọi workspace cùng lúc.
      `UPDATE datasets d
          JOIN (
            SELECT tenant_id, MIN(id) AS ws_id
              FROM workspaces WHERE deleted_at IS NULL GROUP BY tenant_id
          ) w ON w.tenant_id = d.tenant_id
          SET d.workspace_id = w.ws_id
        WHERE d.workspace_id IS NULL`,

      // Giờ mới cấm để trống. Đây là thứ khiến "mỗi workspace một kho" là ràng
      // buộc của DATABASE chứ không phải một quy ước mà code phải nhớ.
      `ALTER TABLE datasets MODIFY COLUMN workspace_id BIGINT UNSIGNED NOT NULL`,

      // ⚠️ PHẢI cấp chỉ mục riêng cho khoá ngoại TRƯỚC khi đụng tới khoá duy
      // nhất. `fk_datasets_connection (tenant_id, connection_id)` không có chỉ
      // mục của riêng nó — nó đang mượn tiền tố của `uq_datasets_source`, và
      // MySQL từ chối bỏ một chỉ mục mà khoá ngoại đang dựa vào:
      //
      //     ER_DROP_INDEX_FK: Cannot drop index 'uq_datasets_source':
      //     needed in a foreign key constraint
      //
      // Chỉ mục này phải ở LẠI vĩnh viễn: khoá duy nhất mới xen `workspace_id`
      // vào giữa nên `(tenant_id, connection_id)` không còn là tiền tố của nó.
      `ALTER TABLE datasets ADD KEY idx_datasets_connection (tenant_id, connection_id)`,

      // Khoá duy nhất phải mang `workspace_id`, nếu không hai workspace không
      // cùng đồng bộ được một bảng nguồn.
      //
      // Thứ tự DROP rồi ADD trong CÙNG một câu là cố ý: tách thành hai câu thì
      // giữa chúng có một khoảnh khắc không còn ràng buộc nào chặn trùng.
      `ALTER TABLE datasets
         DROP INDEX uq_datasets_source,
         ADD UNIQUE KEY uq_datasets_source
           (tenant_id, workspace_id, connection_id, source_schema, source_table)`,
    ],
  },
  {
    id: 12,
    name: 'schema_primary_key',
    statements: [
      // ═══ Quản lý schema trong mô hình ════════════════════════════════════
      //
      // Ba trường cho một BẢNG trong mô hình, bổ sung cho phần cột đã có:
      //
      //   display_name       tên hiển thị. `datasets.name` là tên của bộ dữ
      //                      liệu và nó dùng chung cho mọi mô hình; đổi tên ở
      //                      đây phải chỉ ảnh hưởng mô hình này.
      //   description        mô tả nghiệp vụ do người dựng mô hình viết.
      //   primary_column_id  KHOÁ CHÍNH NGHIỆP VỤ.
      //
      // ⚠️ `primary_column_id` KHÔNG phải khoá chính mà Cube dùng.
      //
      // Cube cần một `primary_key` chắc chắn duy nhất để đếm đúng qua JOIN, và
      // vai đó do `_row_index` (§9) đảm nhiệm — nó luôn duy nhất, kể cả khi bảng
      // nguồn là một view không có khoá tự nhiên. Cột khai ở đây là khoá theo
      // NGHĨA NGHIỆP VỤ: nó nói "muốn nối tới bảng này thì nối vào cột này", và
      // giao diện dùng nó để điền sẵn ô chọn ở tab Quan hệ.
      //
      // Tách hai vai là có chủ đích: người dùng hoàn toàn có thể chọn nhầm một
      // cột có giá trị trùng, và nếu cột đó đi thẳng vào `primary_key` của Cube
      // thì mọi phép tổng sau JOIN sẽ sai mà không có lỗi nào. Hệ thống cảnh báo
      // khi phát hiện trùng, nhưng không để một lựa chọn sai làm hỏng số liệu.
      `ALTER TABLE datamodel_datasets
         ADD COLUMN display_name VARCHAR(255) NULL AFTER dataset_id,
         ADD COLUMN description VARCHAR(500) NULL AFTER display_name,
         ADD COLUMN primary_column_id BIGINT UNSIGNED NULL AFTER description`,

      // ⚠️ Khoá ngoại MỘT CỘT, lệch khỏi quy ước ghép (tenant_id, id) của repo.
      //
      // Không phải bỏ sót. `ON DELETE SET NULL` đòi MỌI cột trong khoá ngoại
      // phải cho phép NULL, mà `tenant_id` thì `NOT NULL`:
      //
      //     ER_FK_COLUMN_NOT_NULL: Column 'tenant_id' cannot be NOT NULL:
      //     needed in a foreign key constraint 'fk_dmd_primary_column' SET NULL
      //
      // Ba lựa chọn còn lại đều tệ hơn: `CASCADE` sẽ xoá cả BẢNG khỏi mô hình
      // chỉ vì một cột biến mất; `RESTRICT` chặn luôn việc gỡ một bảng khỏi mô
      // hình; bỏ hẳn khoá ngoại thì để lại id trỏ vào hư không.
      //
      // Cách ly tổ chức ở đây do TẦNG ỨNG DỤNG giữ, và nó chặt hơn một khoá
      // ngoại: endpoint đặt khoá chính chỉ nhận cột tra được qua chính bảng
      // trong chính mô hình đang mở (`findColumnInDataset`), nên một id của tổ
      // chức khác không đi qua được. Khoá ngoại này chỉ còn nhiệm vụ dọn rác.
      `ALTER TABLE datamodel_datasets
         ADD CONSTRAINT fk_dmd_primary_column
           FOREIGN KEY (primary_column_id)
           REFERENCES datamodel_columns (id) ON DELETE SET NULL`,
    ],
  },
  {
    id: 13,
    name: 'formula_measures',
    statements: [
      // ═══ Thước đo TÍNH TOÁN — §10.6 ═══════════════════════════════════════
      //
      // Trước mục này, một thước đo chỉ diễn đạt được "gộp MỘT cột":
      // `sum(Sales)`, `avg(Discount)`. Những con số mà người dùng thật sự đi
      // tìm lại là TỈ LỆ giữa hai thước đo:
      //
      //     Biên lợi nhuận      = sum(Profit) / sum(Sales)
      //     Giá trung bình      = sum(Sales)  / sum(Quantity)
      //
      // Và chúng KHÔNG thay được bằng cách tính tay trên bảng kết quả:
      // `sum(Profit)/sum(Sales)` phải tính SAU KHI GỘP NHÓM, bên trong SQL.
      // Tính từng dòng rồi lấy trung bình cho ra một con số khác — và sai. Đó
      // chính là lý do phép này thuộc về tầng ngữ nghĩa chứ không phải bảng tính.
      //
      // ─── Vì sao KHÔNG lưu một chuỗi biểu thức ─────────────────────────────
      //
      // Cách hiển nhiên là thêm một cột `expression VARCHAR` rồi cho người dùng
      // gõ `sum(Profit) / sum(Sales)`. Nó phá nguyên tắc mà cả §9 lẫn §10 dựng
      // lên: không một ký tự nào của người dùng đi vào câu lệnh SQL. Chuỗi đó
      // sẽ phải đi thẳng vào `sql:` của file cube, và từ đó xuống ClickHouse.
      //
      // Ở đây công thức lưu dạng CÓ CẤU TRÚC — hai ID và một phép trong ENUM —
      // nên câu lệnh sinh ra hoàn toàn từ dữ liệu của ta. Cái giá: không viết
      // được `CASE WHEN`. Cái được: không có đường nào cho một chuỗi lạ.
      //
      // ─── Vì sao không có khoá ngoại cho hai vế ────────────────────────────
      //
      // `expr_left_id`/`expr_right_id` trỏ vào CHÍNH bảng này. Khoá ngoại tự
      // trỏ kèm `ON DELETE CASCADE` trên cùng một bảng là thứ MySQL xử lý được
      // nhưng thứ tự xoá không đảm bảo khi dòng cha bị xoá dây chuyền từ
      // `datamodels`. Đổi lại, tầng ứng dụng kiểm chặt hơn một khoá ngoại: hai
      // vế phải là thước đo CÒN SỐNG, thuộc CÙNG mô hình và CÙNG bảng — xem
      // `createFormulaMeasure`. Và xoá một thước đo đang bị công thức khác dùng
      // thì bị TỪ CHỐI, chứ không âm thầm để lại một công thức gãy.
      `ALTER TABLE datamodel_measures
         ADD COLUMN expr_kind ENUM('column','formula') NOT NULL DEFAULT 'column' AFTER agg,
         ADD COLUMN expr_op ENUM('add','sub','mul','div') NULL AFTER expr_kind,
         ADD COLUMN expr_left_id BIGINT UNSIGNED NULL AFTER expr_op,
         ADD COLUMN expr_right_id BIGINT UNSIGNED NULL AFTER expr_left_id,
         ADD COLUMN display_format ENUM('number','percent') NOT NULL DEFAULT 'number'
           AFTER expr_right_id`,

      // Tra ngược "thước đo này có ai dùng làm vế không" — chạy mỗi lần xoá một
      // thước đo, nên không để nó quét cả bảng.
      `ALTER TABLE datamodel_measures
         ADD KEY idx_dmm_expr_left (datamodel_id, expr_left_id),
         ADD KEY idx_dmm_expr_right (datamodel_id, expr_right_id)`,
    ],
  },
  {
    id: 14,
    name: 'seed_row_count_measures',
    statements: [
      // ═══ Thước đo ĐẾM DÒNG cho các mô hình đã tạo trước ════════════════════
      //
      // Migration DỮ LIỆU, không đổi cấu trúc — hiếm trong repo này, nên phải
      // nói rõ vì sao nó không thể là một đoạn mã chạy lúc khởi động.
      //
      // Từ nay `seedMeasures` gieo cho mỗi bảng một thước đo `count`, vì câu hỏi
      // "mỗi vùng có bao nhiêu đơn" không gộp cột nào nên KHÔNG có đường nào tạo
      // được nó từ giao diện: chỗ chọn phép gộp nằm trên dòng cột ở tab Schemas.
      //
      // Mô hình tạo trước bản này thì không có, và cũng không tự có: quyết định
      // về ngữ nghĩa được LƯU chứ không tính lại mỗi lần đọc — đúng nguyên tắc
      // khiến `dataset_columns` và `datamodel_columns` là hai bảng khác nhau.
      // Nên hoặc vá một lần ở đây, hoặc bắt người dùng dựng lại mô hình.
      //
      // ─── Ba chỗ dễ sai, và cách né ────────────────────────────────────────
      //
      // 1. `UNIQUE (datamodel_id, name)` là phạm vi MÔ HÌNH, không phải bảng.
      //    Mô hình bốn bảng cần bốn tên khác nhau, nên `ROW_NUMBER()` đánh số
      //    trong từng `datamodel_id` — ra "Số dòng", "Số dòng (2)", … đúng quy
      //    ước hậu tố mà `uniqueName` dùng.
      //
      // 2. Ràng buộc UNIQUE đó KHÔNG tính `deleted_at`. Nên câu `NOT EXISTS`
      //    dưới đây cố ý không lọc `deleted_at`: một thước đo đã xoá mềm vẫn
      //    giữ chỗ tên của nó, và bỏ qua điều đó là một lỗi trùng khoá.
      //
      // 3. Một mô hình có thể đã có sẵn thước đo tên "Số dòng" — cột tên như vậy
      //    hoàn toàn có thật trong dữ liệu tiếng Việt. Khi đó bảng đó bị BỎ QUA
      //    thay vì làm hỏng cả migration; người dùng đã có một thước đo tên đó
      //    rồi, và mất một phép đếm còn hơn mất khả năng nâng cấp.
      //
      // `created_by` để NULL: không có người nào thực hiện việc này.
      `INSERT INTO datamodel_measures
         (tenant_id, datamodel_id, datamodel_dataset_id, datamodel_column_id, name, agg, created_by)
       SELECT t.tenant_id, t.datamodel_id, t.id, NULL, t.candidate, 'count', NULL
         FROM (
           SELECT dd.tenant_id,
                  dd.datamodel_id,
                  dd.id,
                  IF(ROW_NUMBER() OVER (PARTITION BY dd.datamodel_id ORDER BY dd.id) = 1,
                     'Số dòng',
                     CONCAT('Số dòng (',
                            ROW_NUMBER() OVER (PARTITION BY dd.datamodel_id ORDER BY dd.id),
                            ')')) AS candidate
             FROM datamodel_datasets dd
         ) AS t
        WHERE NOT EXISTS (
                SELECT 1 FROM datamodel_measures m
                 WHERE m.datamodel_id = t.datamodel_id AND m.name = t.candidate
              )`,
    ],
  },
  {
    id: 15,
    name: 'reports_on_datamodel',
    statements: [
      // ═══ Báo cáo dựng trên MÔ HÌNH — §10.8 ════════════════════════════════
      //
      // Tới đây `reports.dataset_id` là NOT NULL, tức là mỗi báo cáo bám chặt
      // vào MỘT bộ dữ liệu. Điều đó khoá báo cáo lại ở đúng những thứ một bảng
      // đơn lẻ trả lời được: không phép nối, không thước đo tính toán, không
      // ngữ nghĩa nào của §10.
      //
      // ─── Vì sao KHÔNG chuyển hết báo cáo sang mô hình ─────────────────────
      //
      // Cách gọn hơn là bắt mọi báo cáo đi qua một mô hình, rồi bỏ hẳn nhánh
      // dataset. Nhưng một file vừa tải lên chưa thuộc mô hình nào, nên làm vậy
      // là dựng một bức tường ngay trước biểu đồ đầu tiên của người dùng: tải
      // file → tạo mô hình → khai quan hệ → mới được xem. Hai nhánh cùng tồn
      // tại là có chủ đích.
      //
      // ─── Vì sao `dataset_id` thành NULL được, chứ không thêm bảng mới ─────
      //
      // Hai loại báo cáo giống nhau ở gần như mọi thứ — tên, workspace, loại
      // biểu đồ, người tạo, xoá mềm, phân quyền. Tách bảng nghĩa là nhân đôi
      // toàn bộ phần đó, và mọi chỗ liệt kê báo cáo phải UNION hai bảng rồi tự
      // sắp xếp lại. Khác nhau chỉ ở hai cột và ở cách đọc `config`.
      `ALTER TABLE reports
         MODIFY COLUMN dataset_id BIGINT UNSIGNED NULL,
         ADD COLUMN datamodel_id BIGINT UNSIGNED NULL AFTER dataset_id,
         ADD KEY idx_reports_datamodel (datamodel_id)`,

      // Khoá ngoại GHÉP theo đúng quy ước cách ly tổ chức của repo — khác khoá
      // ngoại một cột của `dataset_id` (có từ §7, giữ nguyên để không phải viết
      // lại một ràng buộc đang chạy tốt).
      //
      // `RESTRICT` chứ không `CASCADE`: xoá mô hình mà kéo theo báo cáo là xoá
      // thứ người dùng không nhắc tới. Thực tế nó không bao giờ nổ, vì mô hình
      // chỉ bị xoá MỀM — ràng buộc này là lưới an toàn cho đường xoá cứng.
      `ALTER TABLE reports
         ADD CONSTRAINT fk_reports_datamodel
           FOREIGN KEY (tenant_id, datamodel_id)
           REFERENCES datamodels (tenant_id, id) ON DELETE RESTRICT`,

      // ⚠️ Ràng buộc QUAN TRỌNG NHẤT của migration này.
      //
      // Đúng một trong hai nguồn được đặt. Không có nó, hai trạng thái vô nghĩa
      // lọt vào được: báo cáo không nguồn (trang xem không biết hỏi ai lấy số),
      // và báo cáo hai nguồn (hai đường tổng hợp cho hai con số khác nhau, và
      // thứ tự `if` trong code quyết định con số nào thắng — một cái bẫy im
      // lặng đúng kiểu tệ nhất).
      //
      // Đặt ở DATABASE chứ không chỉ ở zod: `createReport` và
      // `createModelReport` là hai hàm khác nhau, và ràng buộc "loại trừ nhau"
      // nằm giữa chúng thì không hàm nào một mình giữ được.
      `ALTER TABLE reports
         ADD CONSTRAINT ck_reports_one_source
           CHECK ((dataset_id IS NULL) <> (datamodel_id IS NULL))`,
    ],
  },
  {
    id: 16,
    name: 'projects_hold_reports',
    statements: [
      // ═══ Project rốt cuộc CHỨA được thứ gì đó ═════════════════════════════
      //
      // Tới trước bản này, `projects` là một cái vỏ rỗng theo đúng nghĩa đen:
      // có bảng, có bốn route CRUD, có ba quyền trong RBAC, có thẻ trên trang
      // chủ — nhưng KHÔNG bảng nào trỏ vào nó. Màn hình trống thì viết "Project
      // là nơi chứa dataset và báo cáo", một lời hứa hệ thống không giữ được.
      //
      // Lý do nó thành ra thế: `workspace_id` đã chiếm mất vai trò gom nhóm.
      // Dataset, báo cáo, mô hình, kết nối đều gắn workspace, và bộ chuyển ở
      // sidebar lọc theo workspace. Project ra đời ở §4 rồi §7–§10 dựng lên
      // trên workspace và không cần tới nó.
      //
      // ─── Vì sao CHỈ báo cáo, không phải dataset và mô hình ────────────────
      //
      // Dataset và mô hình là NGUYÊN LIỆU dùng chung: một bảng Orders phục vụ
      // mảng bán hàng lẫn mảng kho, và ép nó thuộc về một project là buộc người
      // ta phải nhân đôi nó. Báo cáo thì ngược lại — nó là SẢN PHẨM của đúng
      // một mảng công việc, và "mảng bán hàng có 5 báo cáo này" chính là câu
      // người dùng muốn nói khi họ tạo một project.
      //
      // ⚠️ Khoá ngoại MỘT CỘT, lệch khỏi quy ước ghép (tenant_id, id) của repo —
      // cùng lý do đã ghi ở `fk_dmd_primary_column` (migration 12):
      //
      //     ER_FK_COLUMN_NOT_NULL: Column 'tenant_id' cannot be NOT NULL:
      //     needed in a foreign key constraint ... SET NULL
      //
      // `ON DELETE SET NULL` đòi mọi cột trong khoá ngoại phải NULL được, mà
      // `reports.tenant_id` thì `NOT NULL`. Ba lựa chọn còn lại đều tệ hơn:
      // `CASCADE` biến việc xoá một project thành xoá sạch báo cáo bên trong —
      // đúng thứ người dùng KHÔNG lường được khi họ chỉ định dọn một thư mục;
      // `RESTRICT` khoá cứng, không xoá được project cho tới khi dời từng báo
      // cáo; bỏ hẳn khoá ngoại thì để lại id trỏ vào hư không.
      //
      // Cách ly tổ chức ở đây do TẦNG ỨNG DỤNG giữ, và nó chặt hơn: endpoint
      // chỉ nhận project tra được trong chính tổ chức VÀ chính workspace của
      // báo cáo. Khoá ngoại này chỉ còn nhiệm vụ dọn rác.
      `ALTER TABLE reports
         ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER workspace_id,
         ADD KEY idx_reports_project (project_id),
         ADD CONSTRAINT fk_reports_project
           FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL`,

      // ─── Dọn cột chết ────────────────────────────────────────────────────
      //
      // `datasets.project_id` được thêm ở migration 7 cùng lô với `s3_key`,
      // `sheet_name`, `truncated` — rồi không ai quay lại. Nó KHÔNG có khoá
      // ngoại, KHÔNG có chỉ mục, và không một dòng mã nào trong repo đọc hay
      // ghi nó (kiểm bằng grep trên cả ba workspace: 0 kết quả).
      //
      // Xoá thay vì để lại: một cột không ràng buộc, không ai đọc, mang đúng
      // cái tên của một quan hệ đang tồn tại ở chỗ khác là thứ lần sau sẽ có
      // người tưởng là đang chạy — rồi ghi vào đó và không hiểu vì sao không có
      // gì xảy ra. Quyết định "project chứa báo cáo, không chứa dataset" nằm
      // ngay phía trên; cột này nói ngược lại.
      `ALTER TABLE datasets DROP COLUMN project_id`,
    ],
  },
  {
    id: 17,
    name: 'drop_projects',
    statements: [
      // ═══ Bỏ hẳn PROJECT khỏi hệ thống ═════════════════════════════════════
      //
      // Migration 16 vừa cho project chứa được báo cáo. Bản này gỡ cả tầng đó
      // đi, và việc hai migration liền nhau đi ngược chiều nhau là có thật —
      // ghi ra đây thay vì để người đọc sau tự đoán.
      //
      // Lý do: `workspace_id` đã làm đúng việc gom nhóm mà project sinh ra để
      // làm. Dataset, mô hình, báo cáo, kết nối đều gắn workspace; bộ chuyển ở
      // sidebar lọc theo workspace; phân quyền chạy theo workspace. Project
      // thành tầng thứ hai không mang thêm thông tin nào, chỉ thêm một chỗ để
      // người dùng phải quyết định.
      //
      // Hai tầng gom nhóm chỉ đáng giá khi tầng trong CẮT NGANG tầng ngoài theo
      // một trục khác. Ở đây chúng cùng một trục, nên tầng trong chỉ là thư mục
      // lồng thư mục.
      //
      // ⚠️ THỨ TỰ BẮT BUỘC: gỡ khoá ngoại trên `reports` TRƯỚC khi bỏ bảng.
      // `DROP TABLE projects` khi còn `fk_reports_project` trỏ vào sẽ ném
      // ER_ROW_IS_REFERENCED và migration dừng giữa chừng.
      `ALTER TABLE reports
         DROP FOREIGN KEY fk_reports_project`,
      `ALTER TABLE reports
         DROP KEY idx_reports_project,
         DROP COLUMN project_id`,

      // `DROP TABLE` chứ không xoá mềm: đây là bỏ một KHÁI NIỆM khỏi hệ thống,
      // không phải xoá dữ liệu của một người dùng. Giữ lại bảng nghĩa là giữ
      // một bảng không mã nào đọc — đúng thứ `datasets.project_id` vừa dạy ở
      // migration 16, chỉ khác quy mô.
      `DROP TABLE IF EXISTS projects`,
    ],
  },
  {
    id: 18,
    name: 'drop_project_policy',
    statements: [
      // ═══ Gỡ nốt quyền `project` khỏi bảng policy ══════════════════════════
      //
      // Đáng lẽ nằm chung migration 17, nhưng 17 đã chạy trên máy dev trước khi
      // thiếu sót này lộ ra. Sửa một migration ĐÃ ÁP DỤNG là cách để máy đã
      // chạy và máy cài mới cho ra hai schema khác nhau mà không ai biết — luật
      // ghi ở đầu file này. Nên nó thành một migration riêng.
      //
      // Vì sao quan trọng: `casbin_rule` là nơi engine phân quyền THẬT SỰ đọc.
      // `DEFAULT_POLICY` trong `shared/src/rbac.ts` chỉ là bản chép tay dùng để
      // gieo lúc khởi tạo. Bỏ tài nguyên `project` ở một bên mà quên bên kia thì
      // database vẫn cấp `project:read/modify/delete` cho creator và viewer —
      // vô hại hôm nay vì không còn endpoint nào nhận nó, nhưng đó là bốn dòng
      // policy nói về một thứ không tồn tại.
      //
      // `v2` là cột TÀI NGUYÊN khi `ptype = 'p'`: thứ tự là (vai trò, tổ chức,
      // tài nguyên, hành động). Nhắm nhầm cột sẽ xoá sạch policy của một vai trò.
      `DELETE FROM casbin_rule WHERE ptype = 'p' AND v2 = 'project'`,
    ],
  },
  {
    id: 19,
    name: 'datamodel_auto_batch_key',
    statements: [
      // ═══ Mô hình tự sinh gom theo LẦN TẢI, không theo từng bảng ═══════════
      //
      // Trước bản này `ensureAutoDataModel` chạy ở đuôi MỖI lần nạp, mà mỗi lần
      // nạp là một bộ dữ liệu — nên một workbook ba sheet đẻ ra ba mô hình một
      // bảng, rời nhau, không nối được gì. Đo trên dữ liệu thật của tổ chức 4:
      // 15 mô hình tự sinh, KHÔNG cái nào quá một bảng, 12 cái bị xoá; song
      // song đó người dùng tự dựng tay 9 mô hình nhiều bảng — tức là tính năng
      // này chưa từng tạo ra thứ ai dùng được.
      //
      // Cột này làm ĐÚNG HAI việc, và đó là lý do nó là một cột chứ không phải
      // hai:
      //
      //   1. Đánh dấu "do máy tạo". Trước đây điều đó được suy ra từ chuỗi
      //      `description`, và cách đó hỏng ngay khi giao diện cho người dùng
      //      sửa mô tả — một mô hình tự sinh bị đổi mô tả sẽ thành "của người
      //      dùng" trong mắt máy, rồi lần nạp sau lại đẻ thêm một cái nữa.
      //   2. Mang khoá gom nhóm, để bảng thứ hai của cùng một lần tải tìm được
      //      mô hình mà bảng thứ nhất vừa tạo.
      //
      // Dạng khoá — cả hai đều dựng từ ID và tên do HỆ THỐNG giữ:
      //   file  ->  `file:<s3_key>`            (ba sheet chung một object MinIO)
      //   CSDL  ->  `conn:<connectionId>:<schema>`
      //
      // KHÔNG đặt UNIQUE. Xoá mềm vẫn giữ nguyên khoá, nên một ràng buộc duy
      // nhất sẽ chặn vĩnh viễn việc dựng lại mô hình cho đúng cái schema mà
      // người dùng vừa xoá — biến một thao tác xoá bình thường thành cụt đường.
      // Việc tìm luôn lọc `deleted_at IS NULL`, đó mới là chỗ đảm bảo.
      `ALTER TABLE datamodels
         ADD COLUMN auto_batch_key VARCHAR(255) NULL AFTER description,
         ADD KEY idx_datamodels_auto_batch (tenant_id, workspace_id, auto_batch_key)`,
    ],
  },
  {
    id: 20,
    name: 'drop_auto_datamodel',
    statements: [
      // ═══ Bỏ hẳn việc tự sinh mô hình dữ liệu ═══════════════════════
      //
      // Từ §10, mỗi lần nạp xong một bộ dữ liệu là hệ thống tự dựng cho người
      // dùng một mô hình. Lý lẽ khi đó: đừng đặt thêm một cánh cửa giữa "dữ liệu
      // đã sẵn sàng" và "hỏi được nó". Migration 19 vá thêm một lần nữa — gom theo
      // LẦN TẢI thay vì theo từng bảng — vì mỗi workbook ba sheet đang đẻ ra ba mô
      // hình một bảng, rời nhau.
      //
      // Cả hai bản đều trả lời hộ một câu chỉ người dùng biết: NHỮNG BẢNG NÀO
      // ĐÁNG HỎI CÙNG NHAU. Máy chỉ đoán được bằng chuyện chúng đi chung một file
      // hay chung một schema, mà đó là trùng hợp về xuất xứ chứ không phải quan hệ
      // về nghĩa. Nên mô hình giờ chỉ ra đời qua §10.2: người dùng tích đúng những
      // bộ dữ liệu họ muốn nối.
      //
      // ⚠️ Mô hình ĐÃ được tự sinh trước đây KHÔNG bị đụng tới. Chúng trở thành
      // mô hình bình thường — sửa được, xoá được, không khác gì mô hình tự dựng.
      // Xoá hộ dữ liệu người dùng đang dùng chỉ vì bỏ một tính năng là việc khác hẳn
      // với bỏ tính năng.
      //
      // Cột thì phải đi: không còn dòng mã nào ghi hay đọc nó. Giữ lại một cột
      // chết là để người đọc schema sau này tin rằng có một cơ chế tự sinh đâu đó
      // trong hệ thống. Cùng lý lẽ với `DROP TABLE projects` ở migration 17.
      //
      // Phải gỡ KHOÁ trước: cột nằm trong `idx_datamodels_auto_batch`, và MySQL
      // tự thu hẹp chỉ mục thay vì báo lỗi, để lại một chỉ mục hai cột không ai dùng.
      `ALTER TABLE datamodels
         DROP KEY idx_datamodels_auto_batch,
         DROP COLUMN auto_batch_key`,
    ],
  },
  {
    id: 21,
    name: 'measure_count_distinct',
    statements: [
      // ═══ Thêm `countDistinct` vào từ vựng phép gộp ═════════════════════════
      //
      // Trước bản này bảng chỉ có sum/avg/count/min/max, nên KHÔNG có cách nào
      // hỏi "bao nhiêu khách hàng", "bao nhiêu mã đơn khác nhau" — đếm giá trị
      // khác nhau là thước đo hay dùng thứ nhì trong BI sau phép cộng, và nó
      // thiếu hẳn chứ không phải bị đặt mặc định sai.
      //
      // Hệ quả kéo theo ở tầng trên: cột CHỮ và cột NGÀY lần đầu tiên trở thành
      // thước đo được. `min`/`max` trên cột ngày là "đơn đầu tiên" và "đơn gần
      // nhất"; hai câu đó backend vốn thừa sức trả lời, chỉ là giao diện chưa
      // bao giờ cho chọn.
      //
      // ⚠️ Tên viết HOA-thường theo đúng chuỗi trong `MEASURE_AGGS` của
      // @bi/shared. MySQL so khớp ENUM có phân biệt hoa thường khi ghi, nên
      // `countdistinct` ở đây mà `countDistinct` ở kia là một lỗi ghi im lặng
      // rơi vào chuỗi rỗng. Cube nhận `count_distinct` — phép đổi tên đó nằm ở
      // `buildCubeSchema.ts`, cố ý KHÔNG để tên của Cube rò vào database.
      //
      // Chỉ NỚI RA, không bỏ giá trị nào, nên mọi dòng đang có vẫn hợp lệ.
      `ALTER TABLE datamodel_measures
         MODIFY COLUMN agg ENUM('sum','avg','count','countDistinct','min','max') NOT NULL`,
    ],
  },
  {
    id: 22,
    name: 'measure_quantiles',
    statements: [
      // ═══ Trung vị và phân vị 90 ═══════════════════════════════════════════
      //
      // Thêm sau khi đo trên dữ liệu thật (Global-Superstore, 51.290 dòng của
      // tổ chức 4). Lợi nhuận trung bình một đơn là 28,61 nhưng TRUNG VỊ chỉ
      // 9,24 — lệch hơn ba lần, vì vài đơn cỡ 8.399,98 kéo cả cột lên. Theo
      // nhóm hàng: Technology 65,45 so 29,94; Office Supplies 16,58 so 6,55.
      //
      // Nghĩa là mọi báo cáo dùng `avg` trên dữ liệu này đang nói một điều sai
      // về hoạt động thật, và không có phép nào trong bảng cũ nói đúng được.
      // Đây là thống kê THIẾU, không phải thống kê thêm cho dài danh sách.
      //
      // ⚠️ Cube KHÔNG có kiểu `median`. Hai phép này phát ra dưới dạng
      // `type: "number"` kèm `sql: quantile(...)` — xem `buildCubeSchema.ts`.
      // Đó cũng là lý do chúng chỉ mở cho cột SỐ: `quantile` chạy được trên cả
      // cột ngày nhưng "trung vị của ngày đặt hàng" không phải câu ai đi hỏi.
      //
      // Chỉ NỚI RA, mọi dòng đang có vẫn hợp lệ.
      `ALTER TABLE datamodel_measures
         MODIFY COLUMN agg
         ENUM('sum','avg','count','countDistinct','min','max','median','p90') NOT NULL`,
    ],
  },
  {
    id: 23,
    name: 'measure_row_expression',
    statements: [
      // ═══ Gộp trên BIỂU THỨC DÒNG ══════════════════════════════════════════
      //
      // `expr_kind = 'formula'` ghép hai thước đo ĐÃ GỘP: `sum(a) × avg(b)`.
      // Với phép chia thì đó đúng là thứ người ta muốn — tỷ suất lợi nhuận là
      // `sum(lợi nhuận) / sum(doanh thu)`. Với phép NHÂN thì gần như không bao
      // giờ đúng, và nó sai theo kiểu nguy hiểm nhất: ra một con số hợp lý.
      //
      // Đo trên `Orders_detail` của tổ chức 4, 22.463 dòng:
      //
      //     sum(Quantity × Unit price)      39.379.467.000   <- đúng
      //     sum(Quantity) × avg(Unit price) 39.398.064.742   <- lệch 0,047%
      //
      // Lệch 0,047% thì không ai phát hiện. Chia theo sản phẩm thì lệch 1,4–1,9%
      // — vẫn không ai phát hiện. Đây là cả một lớp câu hỏi mà mô hình cũ KHÔNG
      // trả lời đúng được, chứ không phải một tiện ích thêm vào cho đủ.
      //
      // Phép này không thuộc ngành nào: bán lẻ là `số lượng × đơn giá`, y tế là
      // `số ngày × chi phí ngày`, giáo dục là `số tín chỉ × điểm`.
      //
      // ─── Vì sao dùng lại `datamodel_column_id` cho vế trái ────────────────
      //
      // Nó vốn đã mang đúng nghĩa "một cột của mô hình này", và `agg` vốn đã là
      // phép gộp áp lên nó. Một thước đo `rowExpr` chỉ khác `column` ở chỗ có
      // thêm một vế phải. Thêm cả cặp cột mới sẽ tạo ra hai đường biểu diễn cho
      // cùng một thứ, và mã đọc phải nhớ dùng đường nào theo `expr_kind`.
      //
      // ⚠️ `expr_right_id` (trỏ THƯỚC ĐO) và `expr_right_column_id` (trỏ CỘT)
      // là hai trường khác nhau, dùng cho hai `expr_kind` khác nhau. Đọc nhầm
      // một cái sang cái kia sẽ tra id trong sai bảng.
      //
      // Chỉ NỚI RA, mọi dòng đang có vẫn hợp lệ.
      `ALTER TABLE datamodel_measures
         MODIFY COLUMN expr_kind ENUM('column','formula','rowExpr')
         NOT NULL DEFAULT 'column'`,
      `ALTER TABLE datamodel_measures
         ADD COLUMN expr_right_column_id BIGINT UNSIGNED NULL AFTER expr_right_id`,
      // Khoá ngoại GHÉP theo `tenant_id`, cùng quy ước với `fk_dmm_column`:
      // mọi đường đi tới dữ liệu đều phải mang theo tổ chức.
      `ALTER TABLE datamodel_measures
         ADD CONSTRAINT fk_dmm_right_column
         FOREIGN KEY (tenant_id, expr_right_column_id)
         REFERENCES datamodel_columns (tenant_id, id) ON DELETE CASCADE`,
    ],
  },
  {
    id: 24,
    name: 'measure_name_unique_alive_only',
    statements: [
      // ═══ Thước đo đã XOÁ vẫn giữ chỗ tên của nó ═══════════════════════════
      //
      // `uq_datamodel_measures (datamodel_id, name)` KHÔNG có `deleted_at`, còn
      // mọi câu kiểm trùng tên trong mã đều lọc `deleted_at IS NULL`. Hai bên
      // hiểu khác nhau về cùng một luật, và khoảng chênh đó nổ ra như sau:
      //
      //   1. Người dùng tạo thước đo "doanh thu"
      //   2. Xoá nó đi  ->  chỉ đặt `deleted_at`, dòng vẫn nằm trong bảng
      //   3. Tạo lại "doanh thu"
      //        · mã tra danh sách CÒN SỐNG  -> không thấy trùng, cho qua
      //        · MySQL tra CẢ dòng đã xoá   -> ER_DUP_ENTRY
      //
      // Người dùng nhận HTTP 500 "Có lỗi xảy ra phía máy chủ" cho một thao tác
      // hoàn toàn hợp lệ, và không có đường nào ra: cái tên bị một dòng vô hình
      // chiếm mất, xoá lần nữa cũng không trả lại được.
      //
      // ─── Vì sao là cột SINH RA, không phải sửa mã ────────────────────────
      //
      // Sửa mã kiểm cả dòng đã xoá thì đúng luật của database nhưng SAI với
      // người dùng: một cái tên đã xoá phải dùng lại được. Nên phải đổi luật ở
      // database cho khớp với điều mã vẫn tin.
      //
      // Ba cách, chọn cách thứ ba:
      //
      //   `(datamodel_id, name, deleted_at)` — HỎNG. MySQL coi mỗi NULL là một
      //       giá trị riêng, nên mọi dòng còn sống (`deleted_at` NULL) trở nên
      //       khác nhau hết: hai thước đo trùng tên sẽ lọt qua. Ràng buộc thật
      //       sự cần thì mất, đúng chiều nguy hiểm.
      //   cột `deleted_seq` do mã tự điền — cần mọi đường xoá đều nhớ điền.
      //       Một đường quên là lỗi cũ quay lại, âm thầm.
      //   cột SINH RA `name_alive` — database tự tính, không đường nào quên
      //       được. Dòng sống mang chính tên nó; dòng đã xoá mang NULL, mà NULL
      //       thì lọt qua khoá duy nhất bao nhiêu lần cũng được. Đây chính là
      //       thứ Postgres gọi là partial unique index, viết bằng đồ nghề MySQL.
      //
      // ⚠️ KHÔNG dùng được `id` trong biểu thức: MySQL cấm cột sinh ra tham
      // chiếu tới cột AUTO_INCREMENT.
      `ALTER TABLE datamodel_measures
         ADD COLUMN name_alive VARCHAR(255)
         COLLATE utf8mb4_unicode_ci
         GENERATED ALWAYS AS (IF(deleted_at IS NULL, name, NULL)) STORED
         AFTER name`,
      // Bỏ khoá cũ TRƯỚC khi thêm khoá mới. Không có dòng nào đang vi phạm luật
      // mới: luật cũ chặt hơn (bao cả dòng đã xoá) nên mọi thứ nó cho qua thì
      // luật mới cũng cho qua.
      `ALTER TABLE datamodel_measures DROP INDEX uq_datamodel_measures`,
      `ALTER TABLE datamodel_measures
         ADD UNIQUE KEY uq_datamodel_measures_alive (datamodel_id, name_alive)`,
    ],
  },
  {
    id: 25,
    name: 'column_description',
    statements: [
      // ═══ Mô tả cho TỪNG CỘT của mô hình (§8.3.1) ═══════════════════════════
      //
      // Mô hình đã có ba thứ nói về một cột: tên trong kho (`column_name`), tên
      // hiển thị (`alias`) và vai trò (`role`). Cả ba đều ngắn, và không cái nào
      // trả lời được câu hỏi hay gặp nhất khi người thứ hai mở mô hình lên:
      // `SL_BAN` là số lượng bán trong kỳ hay số lượng bán luỹ kế?
      //
      // Đó là kiến thức chỉ người dựng mô hình có, và nếu không có chỗ để viết
      // ra thì nó nằm trong đầu họ hoặc trong một file Excel nào đó — nghĩa là
      // người dùng sau tự đoán, và một phép cộng trên cột đoán sai vẫn ra số.
      //
      // ─── Vì sao ở `datamodel_columns` chứ không ở `dataset_columns` ───────
      //
      // Cùng lập luận đã ghi cho chính bảng này ở migration 10: `dataset_columns`
      // mô tả NGUỒN và dùng chung cho mọi mô hình, còn nghĩa thì thuộc về MÔ
      // HÌNH. Cùng một cột `SL_BAN` là "số lượng bán" trong mô hình bán hàng và
      // là "số lượng xuất kho" trong mô hình kho — hai câu đúng, và nhét vào
      // bảng nguồn là bắt chúng đè lên nhau.
      //
      // 500 ký tự, khớp `description` của `datamodels` và của
      // `datamodel_datasets`. NULL = chưa ai viết, khác chuỗi rỗng chỉ ở chỗ
      // giao diện không phải phân biệt — nó hiện ô trống trong cả hai trường
      // hợp, và `saveSchema` quy chuỗi rỗng về NULL trước khi ghi.
      `ALTER TABLE datamodel_columns
         ADD COLUMN description VARCHAR(500) NULL AFTER alias`,
    ],
  },
];
