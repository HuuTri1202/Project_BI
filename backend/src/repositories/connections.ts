import type { ConnectionDto, ConnectionKind } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Kết nối tới CSDL của khách hàng (§8.1).
 *
 * Mọi hàm nhận `tenantId` ngay sau executor và mọi câu lệnh lọc theo nó — bỏ sót
 * một chỗ là admin công ty A đọc được thông tin đăng nhập CSDL của công ty B,
 * hỏng nặng hơn mọi loại rò rỉ khác trong dự án này vì nó dẫn thẳng ra ngoài hệ
 * thống.
 *
 * ─── Cột mật khẩu KHÔNG bao giờ nằm trong SELECT dùng chung ─────────────────
 *
 * `SELECT_LIST` cố ý không lấy `password_cipher`. Chỉ đúng một hàm đọc nó
 * (`findSecret`), và nó trả về chuỗi trần chứ không phải một DTO — nên không có
 * đường nào để bản mã lọt vào một object rồi trôi ra `res.json()`.
 */

interface ConnectionRow extends RowDataPacket {
  id: number;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  use_ssl: number;
  database_name: string;
  username: string;
  last_tested_at: Date | null;
  last_test_error: string | null;
  created_at: Date;
  dataset_count: number;
}

const SELECT_LIST = `
  SELECT c.id, c.name, c.kind, c.host, c.port, c.use_ssl, c.database_name, c.username,
         c.last_tested_at, c.last_test_error, c.created_at,
         (SELECT COUNT(*) FROM datasets d
           WHERE d.connection_id = c.id AND d.deleted_at IS NULL) AS dataset_count
    FROM connections c`;

function toDto(row: ConnectionRow): ConnectionDto {
  return {
    id: Number(row.id),
    name: row.name,
    kind: row.kind,
    host: row.host,
    port: Number(row.port),
    // TINYINT(1) về tay driver là số 0/1, không phải boolean — trả thẳng ra JSON
    // thì frontend nhận `useSsl: 1` và mọi phép `=== false` đều trượt.
    useSsl: row.use_ssl === 1,
    databaseName: row.database_name,
    username: row.username,
    lastTestedAt: row.last_tested_at?.toISOString() ?? null,
    lastTestError: row.last_test_error,
    datasetCount: Number(row.dataset_count),
    createdAt: row.created_at.toISOString(),
  };
}

export async function list(db: Db, tenantId: number): Promise<ConnectionDto[]> {
  const [rows] = await db.query<ConnectionRow[]>(
    `${SELECT_LIST} WHERE c.tenant_id = ? AND c.deleted_at IS NULL ORDER BY c.name ASC`,
    [tenantId],
  );
  return rows.map(toDto);
}

export async function findOne(
  db: Db,
  tenantId: number,
  id: number,
): Promise<ConnectionDto | null> {
  const [rows] = await db.query<ConnectionRow[]>(
    `${SELECT_LIST} WHERE c.tenant_id = ? AND c.id = ? AND c.deleted_at IS NULL LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

/** Thông tin đủ để MỞ kết nối, kèm bản mã mật khẩu. Chỉ service được gọi. */
export interface ConnectionSecret {
  id: number;
  kind: ConnectionKind;
  host: string;
  port: number;
  useSsl: boolean;
  databaseName: string;
  username: string;
  passwordCipher: string;
}

/**
 * Đọc thông tin đăng nhập của một kết nối.
 *
 * Tách hẳn khỏi `findOne` chứ không thêm một cờ `includeSecret`: một tham số
 * boolean như thế sẽ được truyền `true` ở đâu đó "cho tiện", và bản mã theo đó
 * đi vào cùng một DTO mà route trả thẳng ra client.
 */
export async function findSecret(
  db: Db,
  tenantId: number,
  id: number,
): Promise<ConnectionSecret | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, kind, host, port, use_ssl, database_name, username, password_cipher
       FROM connections
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: Number(row['id']),
    kind: row['kind'] as ConnectionKind,
    host: String(row['host']),
    port: Number(row['port']),
    useSsl: Number(row['use_ssl']) === 1,
    databaseName: String(row['database_name']),
    username: String(row['username']),
    passwordCipher: String(row['password_cipher']),
  };
}

export interface CreateConnectionInput {
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  useSsl: boolean;
  databaseName: string;
  username: string;
  passwordCipher: string;
  createdBy: number;
}

export async function create(
  db: Db,
  tenantId: number,
  input: CreateConnectionInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO connections
       (tenant_id, name, kind, host, port, use_ssl, database_name, username,
        password_cipher, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.name,
      input.kind,
      input.host,
      input.port,
      input.useSsl,
      input.databaseName,
      input.username,
      input.passwordCipher,
      input.createdBy,
    ],
  );
  return result.insertId;
}

export interface UpdateConnectionInput {
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  useSsl: boolean;
  databaseName: string;
  username: string;
  /** `null` = giữ nguyên mật khẩu đang lưu. */
  passwordCipher: string | null;
}

/**
 * Sửa kết nối.
 *
 * Mật khẩu để trống thì GIỮ NGUYÊN, và đó là lý do câu lệnh phải dựng theo hai
 * nhánh thay vì luôn ghi cả tám cột. Không có nhánh này thì admin sửa mỗi cái
 * tên cũng phải gõ lại mật khẩu CSDL — thứ mà chính họ có thể không biết, vì
 * người dựng kết nối ban đầu là người khác.
 */
export async function update(
  db: Db,
  tenantId: number,
  id: number,
  input: UpdateConnectionInput,
): Promise<number> {
  const sets = [
    'name = ?',
    'kind = ?',
    'host = ?',
    'port = ?',
    'use_ssl = ?',
    'database_name = ?',
    'username = ?',
  ];
  const params: (string | number | boolean)[] = [
    input.name,
    input.kind,
    input.host,
    input.port,
    input.useSsl,
    input.databaseName,
    input.username,
  ];

  if (input.passwordCipher !== null) {
    sets.push('password_cipher = ?');
    params.push(input.passwordCipher);
  }

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE connections SET ${sets.join(', ')}
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [...params, tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Ghi lại kết quả lần kiểm tra gần nhất.
 *
 * Thành công đặt `last_test_error = NULL`, thất bại đặt `last_tested_at = NULL`.
 * Hai cột luôn ngược nhau nên danh sách chỉ có đúng một cách đọc: có mốc thời
 * gian là đang tốt, có thông báo lỗi là đang hỏng.
 */
export async function recordTest(
  db: Db,
  tenantId: number,
  id: number,
  error: string | null,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE connections
        SET last_tested_at  = ${error === null ? 'CURRENT_TIMESTAMP(3)' : 'NULL'},
            last_test_error = ?
      WHERE tenant_id = ? AND id = ?`,
    [error, tenantId, id],
  );
}

/**
 * Xoá mềm.
 *
 * Chỉ chạy khi đã kiểm không còn dataset — xem `deleteConnection.ts`. Ràng buộc
 * `ON DELETE RESTRICT` ở tầng database chỉ chặn xoá CỨNG, nên nó không tự bảo
 * vệ được thao tác này; luật ở tầng service mới là thứ chặn.
 */
export async function softDelete(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE connections SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}

/** Số dataset còn sống đang trỏ tới kết nối này. */
export async function countDatasets(db: Db, tenantId: number, id: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return Number(rows[0]?.['total'] ?? 0);
}
