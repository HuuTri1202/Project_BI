/**
 * Cấu hình gốc của Cube.js.
 *
 * Hiện để trống có chủ đích — mọi thứ cần thiết đang truyền qua biến môi trường
 * trong docker-compose.yml (CUBEJS_DB_*).
 *
 * F7 sẽ thêm vào đây:
 *   - checkAuth      : xác thực JWT ngắn hạn do Express ký bằng CUBEJS_API_SECRET
 *   - queryRewrite   : chèn filter theo projectId từ securityContext
 *                      -> đây chính là chỗ hiện thực Row-level security (§1.2)
 *
 * Schema (file .js định nghĩa cube) nằm ở model/cubes/ và do Express SINH RA
 * lúc chạy, không viết tay. Xem ADR-08.
 */
module.exports = {};
