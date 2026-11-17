import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { mysqlPool } from '../config/mysql';

/**
 * Liên kết giữa một tài khoản trong hệ thống và một tài khoản Google.
 *
 * Bảng `user_identities` (migration 41). Lý do khoá duy nhất đặt trên
 * `provider_user_id` chứ không trên email nằm ở khối chú thích của chính
 * migration ấy — đọc nó trước khi sửa bất cứ câu nào ở đây.
 */

type Provider = 'google';

interface IdentityRow extends RowDataPacket {
  user_id: number;
}

/**
 * Tìm người dùng theo `sub` của Google.
 *
 * ⚠️ `JOIN users` và lọc `deleted_at IS NULL` ngay tại đây, không để nơi gọi
 * tự nhớ. Xoá mềm một tài khoản mà liên kết vẫn trỏ tới nó thì người đó vẫn
 * đăng nhập được bằng Google — một đường vòng quanh nút "xoá người dùng" mà
 * trang quản trị tưởng là đã đóng.
 */
export async function findUserIdByProviderSubject(
  provider: Provider,
  subject: string,
): Promise<number | null> {
  const [rows] = await mysqlPool.query<IdentityRow[]>(
    `SELECT i.user_id
       FROM user_identities i
       JOIN users u ON u.id = i.user_id
      WHERE i.provider = ? AND i.provider_user_id = ? AND u.deleted_at IS NULL
      LIMIT 1`,
    [provider, subject],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Lập liên kết, và trả về `false` khi KHÔNG lập được.
 *
 * `INSERT IGNORE` chứ không `INSERT`: hai khoá duy nhất của bảng đều có thể
 * đụng, và cả hai lần đụng đều là tình huống thật chứ không phải lỗi lập trình.
 *
 *   uq_identity_subject  tài khoản Google này đã trỏ tới một người dùng KHÁC
 *   uq_identity_user     người dùng này đã liên kết một tài khoản Google khác
 *
 * Trả về cờ thay vì ném lỗi để nơi gọi nói được câu đúng với từng trường hợp —
 * và để hai request đồng thời của cùng một người không biến thành một lỗi 500.
 */
export async function linkIdentity(input: {
  userId: number;
  provider: Provider;
  subject: string;
  email: string;
}): Promise<boolean> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT IGNORE INTO user_identities (user_id, provider, provider_user_id, email_at_link)
     VALUES (?, ?, ?, ?)`,
    [input.userId, input.provider, input.subject, input.email],
  );
  return result.affectedRows > 0;
}

/** Mốc đăng nhập gần nhất QUA LIÊN KẾT NÀY — khác `users.last_login_at`. */
export async function touchIdentityLogin(provider: Provider, subject: string): Promise<void> {
  await mysqlPool.query(
    `UPDATE user_identities SET last_login_at = CURRENT_TIMESTAMP(3)
      WHERE provider = ? AND provider_user_id = ?`,
    [provider, subject],
  );
}
