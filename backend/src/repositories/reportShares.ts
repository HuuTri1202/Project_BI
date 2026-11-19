import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Liên kết xem báo cáo công khai — mong muốn D5.
 *
 * Mọi câu ở đây đều lọc `tenant_id` TRỪ `timTheoBam`, và đó là chủ đích:
 * `timTheoBam` là đường của người KHÔNG đăng nhập, nên nó không có tổ chức nào
 * để lọc theo — chính nó là thứ TRẢ VỀ tổ chức. Mọi nơi gọi phải dùng tổ chức
 * đọc được từ dòng đó, không được nhận tổ chức từ client.
 */

export interface ShareRow {
  id: number;
  tenantId: number;
  reportId: number;
  createdBy: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

function toRow(r: RowDataPacket): ShareRow {
  return {
    id: Number(r['id']),
    tenantId: Number(r['tenant_id']),
    reportId: Number(r['report_id']),
    createdBy: Number(r['created_by']),
    expiresAt: (r['expires_at'] as Date | null) ?? null,
    revokedAt: (r['revoked_at'] as Date | null) ?? null,
    lastViewedAt: (r['last_viewed_at'] as Date | null) ?? null,
    viewCount: Number(r['view_count'] ?? 0),
    createdAt: r['created_at'] as Date,
  };
}

const CHON = `SELECT id, tenant_id, report_id, created_by, expires_at, revoked_at,
                     last_viewed_at, view_count, created_at
                FROM report_shares`;

export async function tao(
  db: Db,
  input: {
    tenantId: number;
    reportId: number;
    tokenHash: string;
    createdBy: number;
    expiresAt: Date | null;
  },
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO report_shares (tenant_id, report_id, token_hash, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [input.tenantId, input.reportId, input.tokenHash, input.createdBy, input.expiresAt],
  );
  return res.insertId;
}

/** Mọi liên kết của một báo cáo, mới nhất trước — kể cả đã thu hồi. */
export async function theoBaoCao(
  db: Db,
  tenantId: number,
  reportId: number,
): Promise<ShareRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `${CHON} WHERE tenant_id = ? AND report_id = ? ORDER BY id DESC`,
    [tenantId, reportId],
  );
  return rows.map(toRow);
}

/**
 * Tra một liên kết theo BĂM của chuỗi — đường của người không đăng nhập.
 *
 * Không lọc `revoked_at`/`expires_at` ở đây: nơi gọi phân biệt được "không có
 * liên kết nào" với "liên kết đã thu hồi" và nói câu khác nhau cho hai chuyện
 * đó. Lọc ngay trong SQL thì cả hai thành cùng một câu 404.
 */
export async function timTheoBam(db: Db, tokenHash: string): Promise<ShareRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`${CHON} WHERE token_hash = ? LIMIT 1`, [
    tokenHash,
  ]);
  const row = rows[0];
  return row ? toRow(row) : null;
}

/** Thu hồi. Trả về số dòng đổi — 0 nghĩa là id không thuộc tổ chức này. */
export async function thuHoi(
  db: Db,
  tenantId: number,
  reportId: number,
  id: number,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE report_shares SET revoked_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND tenant_id = ? AND report_id = ? AND revoked_at IS NULL`,
    [id, tenantId, reportId],
  );
  return res.affectedRows;
}

/**
 * Ghi lại một lần mở.
 *
 * KHÔNG `await` ở nơi gọi: người xem không cần chờ một câu UPDATE đếm lượt, và
 * một lần ghi hỏng không được phép làm trang không mở được. Xem nơi gọi.
 */
export async function ghiLanMo(db: Db, id: number): Promise<void> {
  await db.query(
    `UPDATE report_shares
        SET view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    [id],
  );
}
