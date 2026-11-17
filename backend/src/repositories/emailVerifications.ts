import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

/**
 * Vé xác minh email — §1.10, bảng `email_verification_tokens` (migration 42).
 *
 * ═══ Vì sao file này gần như trùng `passwordResets.ts` ══════════════════════
 *
 * Vì nó NÊN trùng. Cả hai là cùng một cơ chế: một vé dùng-một-lần gửi qua thư,
 * chỉ lưu băm, có hạn. Gom chúng vào một bảng với thêm cột `purpose` thì tiết
 * kiệm được chừng ba mươi dòng và đổi lại một luật mới mà mọi câu truy vấn phải
 * nhớ: lọc đúng `purpose`. Quên một lần là một vé xác minh email đổi được mật
 * khẩu — hoặc `vohieuVeCu` của bên này xoá sạch vé của bên kia.
 *
 * Ba mươi dòng trùng lặp mà đọc là hiểu thì rẻ hơn một điều kiện phải nhớ ở
 * năm chỗ.
 */

export interface VeXacMinh {
  id: number;
  userId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

interface VeRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * Vô hiệu hoá mọi vé còn sống của một người trước khi phát vé mới.
 *
 * Bấm "gửi lại thư" ba lần thì chỉ vé cuối dùng được. Không có bước này, ba lá
 * thư đều mở được tài khoản và người dùng không biết nên tin lá nào — mà lá cũ
 * nhất lại là lá dễ còn nằm trong một hộp thư đã bị đọc trộm.
 */
export async function vohieuVeCu(userId: number): Promise<void> {
  await mysqlPool.query<ResultSetHeader>(
    `UPDATE email_verification_tokens
        SET used_at = NOW(3)
      WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
}

export async function taoVe(userId: number, tokenHash: string, expiresAt: Date): Promise<number> {
  const [res] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt],
  );
  return res.insertId;
}

export async function timTheoBam(tokenHash: string): Promise<VeXacMinh | null> {
  const [rows] = await mysqlPool.query<VeRow[]>(
    `SELECT id, user_id, expires_at, used_at
       FROM email_verification_tokens
      WHERE token_hash = ?`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

/**
 * Chiếm vé. `true` cho ĐÚNG MỘT trong các request đồng thời.
 *
 * `WHERE used_at IS NULL` nằm trong chính câu UPDATE nên MySQL giữ khoá dòng
 * suốt thao tác. Đọc trước rồi ghi sau sẽ để hai request cùng thấy `NULL` rồi
 * cùng đi tiếp.
 */
export async function danhDauDaDung(id: number): Promise<boolean> {
  const [res] = await mysqlPool.query<ResultSetHeader>(
    `UPDATE email_verification_tokens
        SET used_at = NOW(3)
      WHERE id = ? AND used_at IS NULL`,
    [id],
  );
  return res.affectedRows === 1;
}
