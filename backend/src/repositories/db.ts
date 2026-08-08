import type { Pool, PoolConnection } from 'mysql2/promise';

/**
 * Thứ chạy được một câu SQL: pool dùng chung, hoặc một connection đang giữ
 * transaction.
 *
 * Vì sao mọi hàm repository mới nhận tham số này ở VỊ TRÍ ĐẦU TIÊN, và vì sao nó
 * KHÔNG có giá trị mặc định `db: Db = mysqlPool`:
 *
 * Nếu một hàm repository tự gọi `mysqlPool.query(...)`, nó lấy một connection
 * KHÁC với connection đang giữ BEGIN của caller. Câu lệnh đó chạy NGOÀI
 * transaction — ROLLBACK không xoá nó, dữ liệu mồ côi nằm lại im lặng, và lỗi
 * chỉ lộ ra ở nhánh thất bại mà thường không ai test.
 *
 * Đặt giá trị mặc định sẽ dựng lại đúng cái bẫy đó dưới dạng khó thấy hơn: người
 * viết code bên trong `withTransaction` quên truyền `conn`, TypeScript im lặng
 * vì đã có default, và câu lệnh lặng lẽ thoát khỏi transaction. Bắt buộc truyền
 * thì `tsc` bắt được ngay.
 *
 * Đây cũng là lý do `countActiveAdmins` phiên bản cũ (đọc thẳng từ pool) KHÔNG
 * dùng được để chặn "hạ quyền admin cuối cùng": hai request đồng thời đọc trên
 * hai connection ngoài transaction đều thấy "còn 2 admin", đều thành công, tổ
 * chức còn 0 admin.
 *
 * Ghi chú về thứ tự tham số: `repositories/workspaces.ts` quy định `tenantId`
 * đứng đầu để chống IDOR ngay từ chữ ký hàm. Hai luật hoà giải thành
 * `(db, tenantId, ...)` — executor trước, phạm vi tổ chức ngay sau.
 */
export type Db = Pool | PoolConnection;
