import {
  CONNECTION_ERROR_CODES,
  type ConnectionKind,
  type DatabaseOptionDto,
  type SourceTableDto,
  type TestConnectionResultDto,
} from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as connectionsRepo from '../../repositories/connections';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError, notFound } from '../../utils/httpError';
import { driverFor, type ConnectionConfig } from './drivers';
import { explainConnectionError } from './explainError';
import { resolveAndGuardHost } from './guardHost';
import { open, seal } from './secretBox';

/**
 * Nghiệp vụ kết nối CSDL (§8.4).
 *
 * Đây là chỗ DUY NHẤT trong hệ thống ghép ba thứ lại: chặn SSRF, giải mã mật
 * khẩu, và gọi driver. Route không được tự làm — bỏ sót một trong ba là mở một
 * lỗ hổng, và ba lời gọi rải rác thì sớm muộn sẽ có chỗ chỉ gọi hai.
 */

export interface ConnectionInput {
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  useSsl: boolean;
  databaseName: string;
  username: string;
  password: string;
}

/**
 * Thử một kết nối CHƯA lưu — bước 3 của wizard.
 *
 * Không ném lỗi khi kết nối thất bại: thất bại ở đây là một KẾT QUẢ hợp lệ mà
 * người dùng đang chờ đọc, không phải một sự cố. Ném 500 sẽ khiến giao diện
 * hiện "đã có lỗi xảy ra" thay vì câu nói rõ phải sửa gì.
 *
 * Ngoại lệ: host bị chặn thì VẪN ném — đó là lỗi đầu vào, và `resolveAndGuardHost`
 * đã trả sẵn HttpError 400 kèm lý do.
 */
export async function testConnection(input: ConnectionInput): Promise<TestConnectionResultDto> {
  const cfg = await toConfig(input);
  try {
    const { serverVersion } = await driverFor(input.kind).test(cfg);
    return { ok: true, serverVersion };
  } catch (err) {
    return { ok: false, message: explainConnectionError(err, input.kind, input.useSsl) };
  }
}

/**
 * Thử lại một kết nối ĐÃ lưu, và ghi kết quả vào bảng.
 *
 * Ghi lại để danh sách kết nối trả lời được "cái nào đang hỏng" mà không phải
 * bấm thử từng cái — mà bấm thử từng cái thì mỗi lần lại mở một kết nối thật
 * tới máy chủ của khách hàng.
 */
export async function testSavedConnection(
  tenantId: number,
  id: number,
): Promise<TestConnectionResultDto> {
  const secret = await requireSecret(tenantId, id);
  const cfg = await toConfigFromSecret(secret);

  try {
    const { serverVersion } = await driverFor(secret.kind).test(cfg);
    await connectionsRepo.recordTest(mysqlPool, tenantId, id, null);
    return { ok: true, serverVersion };
  } catch (err) {
    const message = explainConnectionError(err, secret.kind, secret.useSsl);
    await connectionsRepo.recordTest(mysqlPool, tenantId, id, message.slice(0, 500));
    return { ok: false, message };
  }
}

export async function createConnection(
  tenantId: number,
  createdBy: number,
  input: ConnectionInput,
): Promise<number> {
  // Kiểm host TRƯỚC khi ghi bất cứ thứ gì: lưu một kết nối trỏ vào
  // 169.254.169.254 rồi mới chặn lúc dùng nghĩa là bản ghi đó nằm trong database
  // và sẽ có ngày ai đó nới cờ ra.
  await resolveAndGuardHost(input.host);

  return connectionsRepo.create(mysqlPool, tenantId, {
    name: input.name,
    kind: input.kind,
    host: input.host,
    port: input.port,
    useSsl: input.useSsl,
    databaseName: input.databaseName,
    username: input.username,
    passwordCipher: seal(input.password),
    createdBy,
  });
}

/** Mật khẩu rỗng = giữ nguyên mật khẩu đang lưu. */
export async function updateConnection(
  tenantId: number,
  id: number,
  input: Omit<ConnectionInput, 'password'> & { password: string | null },
): Promise<void> {
  await resolveAndGuardHost(input.host);

  const affected = await connectionsRepo.update(mysqlPool, tenantId, id, {
    name: input.name,
    kind: input.kind,
    host: input.host,
    port: input.port,
    useSsl: input.useSsl,
    databaseName: input.databaseName,
    username: input.username,
    passwordCipher: input.password === null ? null : seal(input.password),
  });
  if (affected === 0) throw notFound('Không tìm thấy kết nối này.');
}

/**
 * Xoá kết nối — chặn khi còn dataset.
 *
 * Cascade sẽ xoá lặng lẽ hàng trăm dataset (và ở Section 09 là cả mô hình dữ
 * liệu dựng trên chúng) vì một cú bấm nhầm. Bắt dọn trước, và nói rõ còn bao
 * nhiêu cái phải dọn.
 */
export async function deleteConnection(tenantId: number, id: number): Promise<void> {
  const datasets = await connectionsRepo.countDatasets(mysqlPool, tenantId, id);
  if (datasets > 0) {
    throw new HttpError(
      409,
      CONNECTION_ERROR_CODES.CONNECTION_IN_USE,
      `Kết nối này còn ${datasets} tập dữ liệu. Xoá chúng trước rồi mới xoá được kết nối.`,
    );
  }

  const affected = await connectionsRepo.softDelete(mysqlPool, tenantId, id);
  if (affected === 0) throw notFound('Không tìm thấy kết nối này.');
}

/**
 * Bảng trong CSDL nguồn, đánh dấu cái nào đã nằm trong kho (§8.6).
 *
 * Cờ `imported` chính là cơ chế "nhớ lựa chọn giữa các lần đồng bộ": hộp thoại
 * tích sẵn những bảng đã nhập, nên lần đồng bộ thứ hai chỉ cần bấm xác nhận.
 * Không cần cột nào lưu lựa chọn — kho dữ liệu TỰ NÓ là bản ghi nhớ.
 */
/**
 * Database mà một bộ thông tin CHƯA lưu nhìn thấy — nuôi bộ chọn ở bước 2.
 *
 * Ném 502 khi không nối được, KHÁC hẳn `testConnection` vốn trả
 * `{ ok: false }` với mã 200. Lý do: `testConnection` là một câu hỏi mà "không"
 * là câu trả lời hợp lệ người dùng đang chờ đọc; còn hàm này là một thao tác lấy
 * dữ liệu, và một danh sách rỗng vì lỗi mạng trông y hệt một máy chủ thật sự
 * không có database nào. Trộn hai thứ đó lại là dạy người dùng tin vào một danh
 * sách rỗng.
 */
export async function listDatabases(input: ConnectionInput): Promise<DatabaseOptionDto[]> {
  const cfg = await toConfig(input);
  try {
    return await driverFor(input.kind).listDatabases(cfg);
  } catch (err) {
    throw new HttpError(
      502,
      CONNECTION_ERROR_CODES.CONNECTION_FAILED,
      explainConnectionError(err, input.kind, input.useSsl),
    );
  }
}

/**
 * Như trên nhưng cho kết nối ĐÃ lưu.
 *
 * Cần bản riêng vì form sửa để trống ô mật khẩu (nghĩa là "giữ nguyên"), nên
 * đường dùng thông tin chưa lưu không có mật khẩu để mà thử.
 */
export async function listSavedDatabases(
  tenantId: number,
  id: number,
): Promise<DatabaseOptionDto[]> {
  const secret = await requireSecret(tenantId, id);
  const cfg = await toConfigFromSecret(secret);

  try {
    return await driverFor(secret.kind).listDatabases(cfg);
  } catch (err) {
    throw new HttpError(
      502,
      CONNECTION_ERROR_CODES.CONNECTION_FAILED,
      explainConnectionError(err, secret.kind, secret.useSsl),
    );
  }
}

export async function listSourceTables(
  tenantId: number,
  connectionId: number,
): Promise<SourceTableDto[]> {
  const secret = await requireSecret(tenantId, connectionId);
  const cfg = await toConfigFromSecret(secret);

  let tables;
  try {
    tables = await driverFor(secret.kind).listTables(cfg);
  } catch (err) {
    throw new HttpError(
      502,
      CONNECTION_ERROR_CODES.CONNECTION_FAILED,
      explainConnectionError(err, secret.kind, secret.useSsl),
    );
  }

  const imported = new Set(
    (await datasetsRepo.listImportedTables(mysqlPool, tenantId, connectionId)).map(
      (t) => `${t.schema}.${t.table}`,
    ),
  );

  return tables.map((t) => ({
    schema: t.schema,
    table: t.table,
    imported: imported.has(`${t.schema}.${t.table}`),
  }));
}

// ─── Dùng chung ──────────────────────────────────────────────────────────────

async function requireSecret(
  tenantId: number,
  id: number,
): Promise<connectionsRepo.ConnectionSecret> {
  const secret = await connectionsRepo.findSecret(mysqlPool, tenantId, id);
  // 404 chứ không 403 cho id của tổ chức khác: 403 là xác nhận id đó có tồn tại.
  if (!secret) throw notFound('Không tìm thấy kết nối này.');
  return secret;
}

async function toConfig(input: ConnectionInput): Promise<ConnectionConfig> {
  const resolved = await resolveAndGuardHost(input.host);
  return {
    // IP đã kiểm, KHÔNG phải hostname người dùng gõ — xem ghi chú DNS rebinding
    // trong guardHost.ts.
    host: resolved.address,
    port: input.port,
    database: input.databaseName,
    username: input.username,
    password: input.password,
    ssl: input.useSsl,
    serverName: input.host,
  };
}

export async function toConfigFromSecret(
  secret: connectionsRepo.ConnectionSecret,
): Promise<ConnectionConfig> {
  return toConfig({
    name: '',
    kind: secret.kind,
    host: secret.host,
    port: secret.port,
    useSsl: secret.useSsl,
    databaseName: secret.databaseName,
    username: secret.username,
    password: open(secret.passwordCipher),
  });
}

export { requireSecret };
