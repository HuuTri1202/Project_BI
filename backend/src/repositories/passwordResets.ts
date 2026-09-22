import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { mysqlPool } from '../config/mysql';

/**
 * Bảng `password_reset_tokens` — migration 36.
 *
 * Mọi hàm ở đây nhận và trả BĂM của vé, không bao giờ nhận vé nguyên văn. Vé
 * nguyên văn chỉ tồn tại ở hai nơi: trong lá thư gửi đi, và trong request mà
 * người dùng gửi lên. Giữ ranh giới đó ngay ở chữ ký hàm thì không ai lỡ tay
 * ghi nó xuống đĩa.
 */

export interface VeDatLai {
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
 * Vô hiệu mọi vé CHƯA DÙNG của một người.
 *
 * Gọi ngay trước khi phát vé mới, nên mỗi tài khoản chỉ có tối đa một vé sống.
 * Không làm vậy thì người bấm "gửi lại" ba lần sẽ có ba vé cùng mở, và cái cũ
 * nhất — thứ có khả năng cao nhất đã lọt ra ngoài — vẫn dùng được.
 *
 * Đánh dấu `used_at` chứ không xoá: xem ghi chú ở migration 36.
 */
export async function vohieuVeCu(userId: number): Promise<void> {
  await mysqlPool.query<ResultSetHeader>(
    `UPDATE password_reset_tokens
        SET used_at = NOW(3)
      WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
}

export async function taoVe(userId: number, tokenHash: string, expiresAt: Date): Promise<number> {
  const [res] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt],
  );
  return res.insertId;
}

/** Tìm theo băm. Trả về cả vé đã dùng / đã hết hạn — người gọi tự phân loại. */
export async function timTheoBam(tokenHash: string): Promise<VeDatLai | null> {
  const [rows] = await mysqlPool.query<VeRow[]>(
    `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
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
 * Đánh dấu đã dùng, và CHỈ khi nó còn chưa dùng.
 *
 * `AND used_at IS NULL` trong câu UPDATE là chỗ chặn dùng-hai-lần thật sự, chứ
 * không phải phép kiểm `if (ve.usedAt !== null)` ở tầng trên: hai request tới
 * cùng lúc đều đọc ra `used_at = NULL` rồi đều đi tiếp. Ở đây database là trọng
 * tài — chỉ một câu UPDATE chạm được vào dòng đó, câu kia trả `affectedRows: 0`.
 *
 * Trả về `true` nếu chính lần gọi này là lần chiếm được vé.
 */
export async function danhDauDaDung(id: number): Promise<boolean> {
  const [res] = await mysqlPool.query<ResultSetHeader>(
    `UPDATE password_reset_tokens
        SET used_at = NOW(3)
      WHERE id = ? AND used_at IS NULL`,
    [id],
  );
  return res.affectedRows === 1;
}

/**
 * Dọn vé đã hết hạn từ lâu.
 *
 * Giữ lại 30 ngày sau khi hết hạn để còn trả lời được câu "liên kết này đã dùng
 * rồi" cho người bấm lại một email cũ, rồi mới xoá hẳn.
 */
export async function donVeCu(): Promise<number> {
  const [res] = await mysqlPool.query<ResultSetHeader>(
    `DELETE FROM password_reset_tokens
      WHERE expires_at < NOW(3) - INTERVAL 30 DAY`,
  );
  return res.affectedRows;
}
