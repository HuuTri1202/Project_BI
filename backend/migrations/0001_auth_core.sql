-- =============================================================================
-- 0001 — Lõi xác thực và mô hình đa tổ chức: Tenant -> Workspace -> Project
--
-- KHÔNG SỬA FILE NÀY sau khi đã chạy. Migration runner lưu sha256 của nội dung;
-- sửa một dòng là mọi máy đã áp dụng sẽ báo lỗi. Cần đổi gì thì tạo file 0002.
--
-- Quy ước áp dụng cho MỌI bảng trong repo:
--
--  * Khoá chính CHAR(36) CHARACTER SET ascii, chứa UUIDv7.
--    - ascii là BẮT BUỘC: dưới utf8mb4, CHAR(36) chiếm 144 byte mỗi entry index
--      (4 byte/ký tự). UUID là hex + gạch nối, ascii theo định nghĩa.
--    - v7 chứ không phải v4: 48 bit đầu của v7 là timestamp mili-giây nên insert
--      gần như nối đuôi trong clustered index. v4 ngẫu nhiên toàn phần làm mỗi
--      insert rơi vào một trang bất kỳ -> tách trang, phân mảnh index.
--    - Không dùng BIGINT AUTO_INCREMENT: id này nằm trong URL và trong
--      securityContext gửi cho Cube; id tuần tự lộ số lượng user/tenant và biến
--      việc dò IDOR thành chuyện tầm thường.
--
--  * DATETIME(3) chứ không phải TIMESTAMP: DATETIME không bị session time_zone
--    quy đổi, nên miễn nhiễm với việc container chạy TZ=Asia/Ho_Chi_Minh, và
--    không dính trần năm 2038 (sẽ cần khi có cột expires_at).
--    Kết hợp với `SET time_zone='+00:00'` ở config/mysql.ts, CURRENT_TIMESTAMP(3)
--    là UTC thật.
--
--  * Ghi RÕ charset/collation ở mọi bảng: docker-compose khởi động MySQL với
--    --collation-server=utf8mb4_unicode_ci, khác mặc định utf8mb4_0900_ai_ci của
--    MySQL 8. Dựa vào mặc định server thì máy dùng MySQL cài sẵn sẽ ra schema
--    khác, và lỗi "Illegal mix of collations" chỉ nổ ở lần JOIN đầu tiên.
--
--  * ON DELETE: CASCADE xuôi theo chuỗi sở hữu, SET NULL cho quan hệ "người
--    tạo", RESTRICT cho bảng tra cứu. Thực tế sẽ xoá mềm bằng cột `status`;
--    cascade chỉ nổ khi xoá cứng (dọn dữ liệu test).
--
--  * ENUM: thêm giá trị mới phải NỐI VÀO CUỐI. ENUM lưu theo số thứ tự nên chèn
--    vào giữa là viết lại toàn bộ dữ liệu; nối vào cuối là thao tác INSTANT.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- roles — bảng tra cứu, khoá chính tự nhiên là `code`.
--
-- Là BẢNG chứ không phải cột ENUM vì: thêm vai trò mới không cần ALTER TABLE,
-- mang được tên hiển thị và mô tả, và sau này thêm cột tenant_id (nullable) là
-- có ngay vai trò riêng của từng tổ chức — tất cả đều là thay đổi cộng thêm.
--
-- Khoá chính tự nhiên `code` là ngoại lệ CÓ CHỦ Ý so với quy ước UUID ở trên:
-- đây là tập giá trị đóng và nhỏ, `code` chính là chuỗi mà policy Casbin và
-- claim `role` trong JWT mang theo, và nó làm `SELECT * FROM memberships` đọc
-- được ngay mà không cần JOIN lúc gỡ lỗi.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  code        VARCHAR(32)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO roles (code, name, description) VALUES
  ('tenant_admin', 'Quản trị tổ chức', 'Toàn quyền trong tenant, quản lý thành viên'),
  ('creator',      'Người tạo',        'Tạo dataset, data model, dashboard'),
  ('viewer',       'Người xem',        'Chỉ xem dashboard được chia sẻ')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);


-- ─────────────────────────────────────────────────────────────────────────────
-- tenants — tổ chức / khách hàng.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name       VARCHAR(150) NOT NULL,
  -- Để NULL ở bước này: URL hiện dùng id. Sinh slug từ tên tiếng Việt cần bỏ
  -- dấu + vòng lặp chống trùng, để bước làm URL riêng cho tenant lo.
  -- UNIQUE trong MySQL cho phép nhiều NULL nên không vướng gì.
  slug       VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  status     ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- users — định danh TOÀN CỤC. Cố ý KHÔNG có cột tenant_id.
--
-- Vì sao UNIQUE(email) toàn cục chứ không phải UNIQUE(tenant_id, email):
-- kiểu unique-theo-tenant biến dòng user thành chính bản ghi thành viên, nên
-- một người ở hai tổ chức là hai dòng, hai mật khẩu, hai hồ sơ. Khi đó đăng
-- nhập bằng email trở nên nhập nhằng ("tổ chức nào?") và phải có URL riêng cho
-- từng tenant hoặc màn hình chọn tổ chức — trong khi yêu cầu là load Tenant +
-- Workspace ngay khi đăng nhập, form không có ô chọn.
-- Quan trọng hơn: kiểu đó KHÓ ĐẢO NGƯỢC NHẤT. Gộp hai dòng thành một định danh
-- sau khi đã có dữ liệu thật là cả một dự án migrate.
--
-- Chi phí của lựa chọn toàn cục bằng 0, vì bảng nối `memberships` là bảng dù
-- sao cũng phải xây để gán vai trò theo tổ chức.
--
-- Phân biệt hoa/thường: collation _ci cho ta unique không phân biệt hoa thường
-- miễn phí (A@x.com đụng a@x.com — đúng, không nhà cung cấp mail thật nào phân
-- biệt hoa thường ở phần local). Ứng dụng VẪN hạ về chữ thường trước khi ghi để
-- dữ liệu lưu ở dạng chuẩn tắc, phòng khi sau này đổi sang index phân biệt hoa
-- thường hoặc chuyển sang Postgres.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  email             VARCHAR(255) NOT NULL,
  -- 255 chứ không phải 60: bcrypt ra đúng 60 ký tự, nhưng đổi sang argon2id sau
  -- này (~97 ký tự) sẽ không phải ALTER cột.
  password_hash     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name         VARCHAR(150) NOT NULL,
  -- Dạng chuẩn tắc +84XXXXXXXXX. KHÔNG unique: người nhà dùng chung số là
  -- chuyện bình thường.
  phone             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  job_title         VARCHAR(100) NULL,
  status            ENUM('active','pending_verification','suspended','deleted')
                    NOT NULL DEFAULT 'active',
  -- Xác thực email nằm ngoài phạm vi hiện tại. Cột vẫn có sẵn và để NULL, nghĩa
  -- là "chưa từng xác thực" — trung thực, chứ không phải "đã xác thực". Bật lại
  -- sau chỉ cần: đổi DEFAULT của `status` sang 'pending_verification' (thao tác
  -- chỉ đụng metadata) + thêm bảng token. Dòng cũ giữ nguyên 'active'.
  -- Cố ý KHÔNG ghi NOW() vào đây lúc đăng ký: làm thế là phá huỷ vĩnh viễn khả
  -- năng phân biệt "đã xác thực thật" với "được cấp trước khi có tính năng".
  email_verified_at DATETIME(3) NULL,
  last_login_at     DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Một index làm hai việc: tra cứu lúc đăng nhập, và là RÀNG BUỘC chống trùng
  -- email. Đây chính là "check trùng email phía server" — và là cái duy nhất
  -- thật sự bảo đảm, vì một câu SELECT kiểm tra trước luôn có khe TOCTOU.
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- workspaces — không gian làm việc, thuộc một tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  tenant_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name       VARCHAR(150) NOT NULL,
  status     ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Khoá phụ này KHÔNG thừa: nó là đích cho khoá ngoại GHÉP của bảng projects.
  -- Nhờ nó, một project không thể trỏ tới workspace của tenant khác.
  UNIQUE KEY uq_workspaces_tenant_id (tenant_id, id),
  CONSTRAINT fk_workspaces_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- projects — nơi gắn dataset/dashboard. Tạo bảng ngay, nhưng đăng ký KHÔNG chèn
-- dòng nào: đăng ký chỉ tạo đúng những gì yêu cầu nói (1 tenant, 1 workspace).
-- Thêm bản ghi mặc định về sau là hai dòng code; bỏ nó đi về sau là phải viết
-- script dọn dữ liệu người dùng thật. Rủi ro lệch hẳn về một phía.
--
-- Hệ quả chấp nhận: ngay sau khi đăng ký, projectIds rỗng nên Cube query proxy
-- không cho phép truy vấn gì cả. Đó là hành vi ĐÚNG, không phải lỗi.
--
-- tenant_id ở đây là dữ liệu lặp (suy ra được qua workspace_id) và nó xứng đáng:
-- (1) mọi truy vấn phân quyền thành `WHERE tenant_id = ? AND id = ?`, nên truy
--     cập nhầm tenant biến thành "không có dòng nào" thay vì "thiếu một câu if";
-- (2) nó cho phép khoá ngoại GHÉP bên dưới, khiến việc gắn project vào workspace
--     của tenant khác là bất khả thi ở tầng database, bất kể code làm gì.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  tenant_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  name         VARCHAR(150) NOT NULL,
  status       ENUM('active','archived','deleted') NOT NULL DEFAULT 'active',
  created_by   CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_projects_workspace (workspace_id),
  KEY idx_projects_tenant (tenant_id),
  CONSTRAINT fk_projects_workspace FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES workspaces (tenant_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
  -- SET NULL chứ không CASCADE: project sống lâu hơn người tạo ra nó.
  CONSTRAINT fk_projects_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- memberships — user thuộc tenant nào, với vai trò gì.
--
-- ĐÂY CHÍNH LÀ bảng gán vai trò. Không tách thêm bảng `user_roles`: vai trò vốn
-- gắn với tổ chức (quản trị ở Acme nhưng chỉ xem ở Beta), nên bảng thành viên và
-- bảng phân vai là cùng một thứ. Tách ra chỉ để lặp lại cột tenant_id.
--
-- Một dòng ở đây ánh xạ đúng 1:1 sang dòng `g, <user>, <role>, <domain>` của
-- Casbin với domain = tenant. Khi Casbin được thêm vào, bảng `casbin_rule` chỉ
-- chứa các dòng `p` (ma trận quyền); các dòng `g` sinh từ bảng này. Schema này
-- không phải đổi gì.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  user_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  tenant_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  role_code  VARCHAR(32) NOT NULL,
  status     ENUM('active','invited','suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Một user chỉ có MỘT vai trò trong một tenant. Muốn đa vai trò thì bỏ UNIQUE
  -- này và đưa role_code vào khoá — đổi được sau, chưa cần bây giờ.
  -- Tiền tố trái (user_id) cũng phục vụ luôn truy vấn của GET /auth/me.
  UNIQUE KEY uq_memberships_user_tenant (user_id, tenant_id),
  KEY idx_memberships_tenant (tenant_id, status),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id)
    REFERENCES tenants (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  -- RESTRICT: xoá nhầm một vai trò đang có người giữ phải báo lỗi, không im lặng.
  CONSTRAINT fk_memberships_role FOREIGN KEY (role_code)
    REFERENCES roles (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
