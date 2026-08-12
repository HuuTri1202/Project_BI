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
    name: 'dataset_core',
    statements: [
      // ─── datasets: một file đã tải lên + schema của nó ───────────────────
      //
      // Khoá ngoại GHÉP (tenant_id, workspace_id) theo đúng khuôn của bảng
      // `projects` ở migration 1: gắn dataset vào workspace của tổ chức khác trở
      // thành BẤT KHẢ THI ở tầng database, bất kể code phía trên làm gì.
      //
      // `s3_key` do SERVER sinh, không bao giờ lấy từ client. Presigned URL là
      // một tấm vé ghi vào đúng key đó trong 15 phút mà không cần token nào nữa,
      // nên nhận key từ client nghĩa là cho người ta ghi đè file của tổ chức
      // khác. UNIQUE để một key không bao giờ thuộc về hai bản ghi.
      //
      // `status` là VÒNG ĐỜI, không phải cờ trang trí:
      //   pending  đã cấp presigned URL, chưa biết file có lên tới nơi không
      //   ready    đã parse, đã nạp dòng, dùng được
      //   failed   parse hỏng — giữ lại kèm error_message để người dùng hiểu
      //
      // Bản ghi `pending` KHÔNG hiện ở danh sách §7.8. Người dùng đóng wizard
      // giữa chừng sẽ để lại một dòng và một file trên S3; dọn định kỳ những
      // dòng pending quá 24 giờ là việc còn NỢ, chưa làm.
      //
      // `truncated` tồn tại vì `row_count` một mình nói dối: 50000 dòng có thể là
      // "file có đúng 50000 dòng" hoặc "file có 500000 dòng và ta cắt". Trong sản
      // phẩm BI, để người ta tin vào một biểu đồ thiếu chín phần mười dữ liệu là
      // kiểu sai tệ nhất, nên sự thật đó phải nằm trong schema chứ không phải
      // trong trí nhớ của người viết code.
      `CREATE TABLE IF NOT EXISTS datasets (
        id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id         BIGINT UNSIGNED NOT NULL,
        workspace_id      BIGINT UNSIGNED NOT NULL,
        project_id        BIGINT UNSIGNED NULL,
        name              VARCHAR(255) NOT NULL,
        source_type       ENUM('device','gdrive','onedrive','sharepoint')
                          NOT NULL DEFAULT 'device',
        original_filename VARCHAR(255) NOT NULL,
        file_ext          ENUM('csv','xlsx') NOT NULL,
        file_size_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0,
        s3_key            VARCHAR(512) NOT NULL,
        sheet_name        VARCHAR(255) NULL,
        status            ENUM('pending','ready','failed') NOT NULL DEFAULT 'pending',
        error_message     VARCHAR(500) NULL,
        row_count         INT UNSIGNED NOT NULL DEFAULT 0,
        truncated         TINYINT(1)   NOT NULL DEFAULT 0,
        created_by        BIGINT UNSIGNED NULL,
        deleted_at        DATETIME(3)  NULL,
        created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                       ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_datasets_s3_key (s3_key),
        UNIQUE KEY uq_datasets_tenant_id (tenant_id, id),
        KEY idx_datasets_workspace_live (workspace_id, deleted_at, status),
        KEY idx_datasets_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_datasets_workspace FOREIGN KEY (tenant_id, workspace_id)
          REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_datasets_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── dataset_columns: schema của file VÀ tầng ngữ nghĩa ───────────────
      //
      // Bảng này giữ luôn phần mà §7.6 gọi là DataModel. Một bảng `data_models`
      // riêng chỉ để trỏ tới dataset sẽ là một tầng RỖNG — hai bảng cùng trả lời
      // một câu hỏi, và bảng thứ hai không thêm được sự thật nào.
      //
      // Thứ DataModel thật sự đóng góp là khoảng cách giữa hai cột dưới đây:
      //
      //   source_name  'SL_BAN'          tên nguyên văn trong file
      //   field_name   'Số lượng bán'    tên người dùng đặt lại  (§7.5 mapping)
      //   field_role   'measure'         đo được hay dùng để nhóm  ← DataModel
      //
      // Tài nguyên `datamodel` trong Casbin GIỮ NGUYÊN và vẫn có nghĩa; nó chỉ
      // được thực thi trên chính bản ghi dataset. Ghi ở đây để người sau không đi
      // tìm một bảng không tồn tại.
      //
      // `included` cho người dùng bỏ cột không cần (§7.5). Giữ lại dòng thay vì
      // xoá: bỏ chọn rồi đổi ý là chuyện thường, và giữ dòng thì kiểu dữ liệu đã
      // suy luận không phải tính lại.
      //
      // KHÔNG có tenant_id: bảng này luôn được truy vấn qua `dataset_id`, mà
      // `datasets` đã bị chặn theo tenant. Thêm cột ở đây là thêm một chỗ có thể
      // lệch mà không mua thêm được lớp bảo vệ nào.
      `CREATE TABLE IF NOT EXISTS dataset_columns (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        dataset_id   BIGINT UNSIGNED NOT NULL,
        column_index INT UNSIGNED NOT NULL,
        source_name  VARCHAR(255) NOT NULL,
        field_name   VARCHAR(255) NOT NULL,
        data_type    ENUM('text','number','date','boolean') NOT NULL DEFAULT 'text',
        field_role   ENUM('dimension','measure') NOT NULL DEFAULT 'dimension',
        included     TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dataset_columns_index (dataset_id, column_index),
        CONSTRAINT fk_dataset_columns_dataset FOREIGN KEY (dataset_id)
          REFERENCES datasets (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── dataset_rows: dữ liệu thật, mỗi dòng một document JSON ───────────
      //
      // Phản xạ đầu tiên là sinh một bảng riêng cho mỗi dataset
      // (CREATE TABLE ds_17 ...). KHÔNG làm thế. DDL lúc chạy nghĩa là: xoá mềm
      // một dataset để lại một bảng mồ côi mà không migration nào mô tả, schema
      // thật của database không đọc được từ mã nguồn, và một tên cột do người
      // dùng đặt trong Excel đi thẳng vào câu CREATE TABLE.
      //
      // MySQL 8 lưu JSON ở dạng nhị phân ĐÃ PHÂN TÍCH SẴN, nên đọc một khoá
      // không phải parse lại cả chuỗi. Với quy mô một biểu đồ đọc vài nghìn dòng
      // thì đây là lựa chọn đúng. Khi nào cần quét hàng triệu dòng mới tới lượt
      // ClickHouse, và lúc đó chính bảng này là nguồn để nạp sang.
      //
      // Khoá chính GHÉP (dataset_id, row_index), không có cột id tự tăng: dòng
      // dữ liệu không có danh tính riêng ngoài vị trí của nó trong file. Khoá
      // ghép cũng là khoá gom cụm của InnoDB, nên đọc toàn bộ một dataset là đọc
      // tuần tự trên đĩa thay vì nhảy theo secondary index.
      `CREATE TABLE IF NOT EXISTS dataset_rows (
        dataset_id BIGINT UNSIGNED NOT NULL,
        row_index  INT UNSIGNED NOT NULL,
        data       JSON NOT NULL,
        PRIMARY KEY (dataset_id, row_index),
        CONSTRAINT fk_dataset_rows_dataset FOREIGN KEY (dataset_id)
          REFERENCES datasets (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // ─── reports: một biểu đồ dựng trên một dataset ───────────────────────
      //
      // `config` là JSON chứ không phải một loạt cột (x_field, y_field,
      // aggregate...): mỗi loại biểu đồ cần một bộ tham số khác nhau, và biểu đồ
      // tròn không có trục X. Trải chúng thành cột nghĩa là phần lớn cột luôn
      // NULL, và thêm một loại biểu đồ là một migration.
      //
      // Đổi lại, database không kiểm được nội dung `config`. Việc đó do zod ở
      // `api/v1/schemas.ts` lo — chấp nhận được, vì config chỉ được đọc bởi đúng
      // một nơi là trình vẽ biểu đồ.
      //
      // ON DELETE RESTRICT với dataset, KHÔNG cascade: xoá dataset mà cuốn theo
      // báo cáo của người khác là mất dữ liệu ngoài ý muốn. Cả hai đều xoá mềm
      // nên nhánh này gần như không chạy; khi nó chạy, nó phải dừng lại.
      `CREATE TABLE IF NOT EXISTS reports (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id    BIGINT UNSIGNED NOT NULL,
        workspace_id BIGINT UNSIGNED NOT NULL,
        dataset_id   BIGINT UNSIGNED NOT NULL,
        name         VARCHAR(255) NOT NULL,
        chart_type   ENUM('bar','line','area','pie','table') NOT NULL DEFAULT 'bar',
        config       JSON NOT NULL,
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
      // Migration 4 chỉ cho Creator read + modify trên hai tài nguyên này, theo
      // đúng §6.3. §7.8 nói "Creator trở lên mới tạo/xoá", nên thiếu hai dòng.
      //
      // Vì sao mở ra là đúng chứ không phải nới lỏng ẩu: người tạo một bộ dữ liệu
      // từ file của chính mình mà không xoá được nó thì mỗi lần tải nhầm file là
      // một bản ghi rác nằm lại vĩnh viễn và phải đi nhờ Admin. Đó cũng chính là
      // lý do migration 4 đã cho Creator xoá `project`.
      //
      // `datamodel` và `chart` CỐ Ý không được thêm: chúng chưa có endpoint nào,
      // và cấp một quyền trước khi có thứ để áp dụng là cách policy lệch dần khỏi
      // thực tế mà không ai nhận ra.
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
    id: 7,
    name: 'dataset_shared_file',
    statements: [
      // ─── Một file, NHIỀU bộ dữ liệu ──────────────────────────────────────
      //
      // §7.5 đổi: người dùng tích nhiều sheet trong cùng một file Excel, và MỖI
      // SHEET thành một Dataset riêng. Nghĩa là N bản ghi `datasets` cùng trỏ
      // vào một object trên S3.
      //
      // `uq_datasets_s3_key` của migration 6 cấm đúng điều đó — nó được đặt khi
      // mô hình còn là một file một dataset. Đổi thành khoá thường: vẫn tra cứu
      // nhanh theo file (dùng khi dọn object mồ côi), nhưng không còn cấm dùng
      // chung.
      //
      // Hệ quả phải nhớ: XOÁ một dataset KHÔNG được xoá object trên S3 nữa, vì
      // những dataset anh em vẫn cần nó. Việc dọn file phải kiểm "còn dataset
      // nào trỏ vào key này không" — ghi trong `softDeleteDataset`.
      `ALTER TABLE datasets DROP INDEX uq_datasets_s3_key`,
      `ALTER TABLE datasets ADD KEY idx_datasets_s3_key (s3_key)`,
    ],
  },

  {
    id: 8,
    name: 'report_created_empty',
    statements: [
      // ─── Báo cáo được tạo RỖNG ───────────────────────────────────────────
      //
      // §7.6 (bản cập nhật): wizard tạo "bản ghi Report rỗng, gắn với DataModel,
      // CHƯA CÓ BIỂU ĐỒ". Người dùng dựng biểu đồ trên trang Report.
      //
      // Migration 6 khai `chart_type NOT NULL DEFAULT 'bar'` và `config NOT NULL`
      // vì lúc đó wizard tự chọn hộ. Giữ nguyên hai ràng buộc đó nghĩa là mọi
      // báo cáo mới sinh ra đều đã mang sẵn một biểu đồ cột mà không ai yêu cầu,
      // và "chưa cấu hình" trở thành trạng thái KHÔNG BIỂU DIỄN ĐƯỢC.
      //
      // NULL ở đây là dữ liệu thật, không phải chỗ trống: nó phân biệt "người
      // dùng chưa dựng biểu đồ" với "đã dựng và chọn biểu đồ cột". Một cột
      // `is_configured` song song sẽ là nguồn sự thật thứ hai và sớm muộn lệch.
      //
      // Dòng đã có giữ nguyên giá trị cũ — chúng thật sự đã được cấu hình.
      `ALTER TABLE reports
         MODIFY chart_type ENUM('bar','line','area','pie','table') NULL,
         MODIFY config JSON NULL`,
    ],
  },
];
