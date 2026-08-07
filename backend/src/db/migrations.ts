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
 * QUY TẮC: migration đã commit thì KHÔNG sửa nữa. Cần đổi gì thì thêm migration
 * mới — máy người khác đã chạy bản cũ rồi.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  /** Mỗi phần tử là một câu lệnh: mysql2 không cho nhiều câu trong một query. */
  readonly statements: readonly string[];
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'create_tenants_users_workspaces',
    statements: [
      // --- tenants: tổ chức/công ty, gốc của mọi thứ ---
      `CREATE TABLE IF NOT EXISTS tenants (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name       VARCHAR(255) NOT NULL,
        slug       VARCHAR(100) NOT NULL,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenants_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // --- users ---
      // email UNIQUE TOÀN CỤC, không phải theo tenant: form đăng nhập chỉ có
      // email + mật khẩu, không có ô chọn tổ chức, nên nếu hai tenant dùng
      // chung một email thì hệ thống không biết đăng nhập vào đâu.
      // Hệ quả đã biết: một email chỉ thuộc một tổ chức.
      //
      // Collation utf8mb4_unicode_ci không phân biệt hoa thường nên
      // 'A@b.com' và 'a@b.com' bị coi là trùng — đúng ý.
      //
      // Ràng buộc UNIQUE mới là thứ THẬT SỰ chặn trùng email; câu SELECT kiểm
      // tra trước chỉ để trả thông báo đẹp, giữa SELECT và INSERT vẫn có khe hở
      // cho hai request đồng thời.
      `CREATE TABLE IF NOT EXISTS users (
        id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id            BIGINT UNSIGNED NOT NULL,
        full_name            VARCHAR(255) NOT NULL,
        email                VARCHAR(255) NOT NULL,
        password_hash        VARCHAR(255) NOT NULL,
        role                 ENUM('admin','creator','viewer') NOT NULL DEFAULT 'viewer',
        is_active            TINYINT(1)   NOT NULL DEFAULT 1,
        must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
        last_login_at        DATETIME(3)  NULL,
        deleted_at           DATETIME(3)  NULL,
        created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                          ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email),
        KEY idx_users_tenant_role (tenant_id, role),
        KEY idx_users_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

      // --- workspaces: cấp trên Project trong phân cấp
      //     tenant -> workspace -> project -> dataset/chart ---
      // slug chỉ duy nhất TRONG tenant: hai công ty đều có quyền đặt workspace
      // tên "Kinh doanh".
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
        KEY idx_workspaces_tenant_deleted (tenant_id, deleted_at),
        CONSTRAINT fk_workspaces_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        -- SET NULL chứ không RESTRICT: xoá cứng người tạo không nên chặn
        -- workspace tồn tại.
        CONSTRAINT fk_workspaces_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
  },
];
