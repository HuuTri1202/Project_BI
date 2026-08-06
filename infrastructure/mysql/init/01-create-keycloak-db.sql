-- Tạo database riêng cho Keycloak.
-- Keycloak KHÔNG dùng chung schema với ứng dụng (bi_platform) vì nó tự quản lý
-- ~90 bảng nội bộ và chạy migration mỗi lần nâng version.
--
-- LƯU Ý: file này chỉ chạy TỰ ĐỘNG khi volume mysql_data còn rỗng (lần đầu tiên).
-- Nếu MySQL đã chạy trước đó, script start-dev.sh sẽ tự tạo lại phần này.

CREATE DATABASE IF NOT EXISTS keycloak
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'keycloak'@'%' IDENTIFIED BY 'keycloak_password';
GRANT ALL PRIVILEGES ON keycloak.* TO 'keycloak'@'%';

FLUSH PRIVILEGES;
