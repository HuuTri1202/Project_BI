import type { ConnectionDto, ConnectionKind, ConnectionVisibility, TenantRole } from '@bi/shared';
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
 *
 * ─── Từ migration 28: `tenantId` không còn đủ ───────────────────────────────
 *
 * Bảng này giờ chứa hai loại dòng — kho chung của tổ chức, và kết nối RIÊNG của
 * từng người. Nên mọi hàm đọc nhận thêm `viewer`, và mọi hàm ghi nhận thêm ràng
 * buộc sở hữu.
 *
 * ⚠️ Điều kiện nằm TRONG câu lệnh, không phải trong một lần `if` ở tầng service.
 * Đây là quyết định, không phải phong cách: một `if` đọc rồi mới ghi là hai lần
 * đi database với một khe hở ở giữa, và nó cũng là thứ người ta quên gọi. Câu
 * `UPDATE … AND created_by = ?` trả về `affectedRows = 0` khi không có quyền, và
 * service dịch số 0 đó thành 404 — cùng một đường đi với "không tìm thấy", nên
 * không có phản hồi nào xác nhận rằng một id của người khác CÓ tồn tại.
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
  visibility: ConnectionVisibility;
  created_by: number | null;
  owner_name: string | null;
}

/**
 * Ai đang hỏi — quyết định thấy dòng nào và sửa được dòng nào.
 *
 * `role` là vai trò TRONG TỔ CHỨC, và nó phải là vai trò đã được
 * `requireFreshMembership` đọc lại từ database. Vai trò trong token có thể cũ
 * tới 7 ngày (`JWT_EXPIRES_IN`), nên tin vào nó ở đây là để một người đã bị hạ
 * quyền vẫn sửa được kho chung suốt một tuần.
 */
export interface ConnectionViewer {
  userId: number;
  role: TenantRole;
}

/**
 * Phạm vi của một lời gọi — một người, hoặc chính HỆ THỐNG.
 *
 * `'system'` là lối thoát cho hai đường không có người nào đứng sau:
 *
 *   loadDataset      vòng lặp nạp chạy nền, không có phiên đăng nhập nào
 *   previewDataset   xem trước một dòng dataset ĐÃ nằm trong Kho dữ liệu
 *
 * Cả hai lấy `connectionId` từ MỘT DÒNG `datasets` vốn đã lọc theo `tenant_id`,
 * không phải từ URL. Người gọi không chọn được kết nối nào — họ chọn một bộ dữ
 * liệu, và bộ dữ liệu đó đã là tài sản chung của tổ chức: nó nằm trong Kho dữ
 * liệu và mọi creator đọc được. Chặn theo phạm vi kết nối ở đó là giấu bản xem
 * trước của một bảng mà chính danh sách bên cạnh đang hiện tên.
 *
 * Là một CHUỖI chứ không phải một `ConnectionViewer` giả với `role: 'admin'`:
 * cái giả đọc như một người thật và sẽ được sao chép sang chỗ khác "cho tiện".
 * Chuỗi này thì grep ra đúng hai chỗ, và mỗi chỗ đọc là `'system'` ngay tại lời
 * gọi.
 */
export type ConnectionScope = ConnectionViewer | 'system';

/**
 * Mệnh đề "được THẤY" — dán vào sau một `WHERE` đã có.
 *
 * ─── Người không phải admin chỉ thấy KẾT NỐI CỦA CHÍNH MÌNH ─────────────────
 *
 * Đúng một vế: `created_by = ?`. Không có ngoại lệ cho kho của tổ chức.
 *
 * Bản đầu có thêm `visibility = 'shared' OR …`, tức là creator vẫn thấy và vẫn
 * đồng bộ được từ kết nối do admin dựng. Nghe hợp lý — "kho chung thì ai cũng
 * dùng" — nhưng nó phá đúng điều mà kết nối riêng sinh ra để làm: thông tin
 * đăng nhập của admin mở được cả một CSDL nằm ngoài hệ thống này, và một
 * creator mượn được nó là mượn được toàn bộ quyền đọc đi kèm, trên những bảng
 * mà admin chưa từng chọn đồng bộ.
 *
 * Admin vẫn thấy tất — kể cả kết nối riêng của người khác. Đó là lựa chọn có
 * chủ đích: bảng đồng bộ về từ một kết nối riêng nằm trong Kho dữ liệu và cả tổ
 * chức đọc được, nên giấu kết nối mà lộ dữ liệu của nó là nửa vời. Admin cũng
 * là người phải trả lời khi một kết nối trỏ sai chỗ.
 *
 * ─── Cái giá, đã biết ───────────────────────────────────────────────────────
 *
 * Creator không đồng bộ LẠI được từ kết nối của admin nữa. Bộ dữ liệu đã đồng
 * bộ vẫn còn nguyên và vẫn NẠP được — `loadDataset` chạy dưới phạm vi
 * `'system'` (xem `ConnectionScope`), nên vòng lặp nạp không đứt. Chỉ thao tác
 * tay "đồng bộ thêm bảng / làm mới cấu trúc" là đóng, và đường ra của creator
 * là tự khai kết nối của mình.
 */
function whereVisible(viewer: ConnectionScope): { sql: string; params: number[] } {
  if (viewer === 'system' || viewer.role === 'admin') return { sql: '', params: [] };
  return { sql: ` AND c.created_by = ?`, params: [viewer.userId] };
}

/**
 * Mệnh đề "được SỬA/XOÁ" — chặt hơn hẳn mệnh đề thấy.
 *
 * Người không phải admin chỉ đụng được kết nối RIÊNG do chính họ tạo. Hai vế,
 * và vế `visibility = 'private'` không thừa: một người từng là admin, dựng kết
 * nối cho kho chung, rồi bị hạ xuống creator vẫn còn `created_by` trỏ vào mình.
 * Thiếu vế đó thì kho chung của tổ chức có một người ngoài admin sửa được, và
 * không ai nhìn ra vì trên màn hình nó vẫn là một dòng "Dùng chung" bình thường.
 *
 * Nói gọn: creator KHÔNG BAO GIỜ chạm được vào kho chung.
 */
function whereOwned(viewer: ConnectionScope): { sql: string; params: number[] } {
  if (viewer === 'system' || viewer.role === 'admin') return { sql: '', params: [] };
  return {
    sql: ` AND created_by = ? AND visibility = 'private'`,
    params: [viewer.userId],
  };
}

const SELECT_LIST = `
  SELECT c.id, c.name, c.kind, c.host, c.port, c.use_ssl, c.database_name, c.username,
         c.last_tested_at, c.last_test_error, c.created_at,
         c.visibility, c.created_by, u.full_name AS owner_name,
         (SELECT COUNT(*) FROM datasets d
           WHERE d.connection_id = c.id AND d.deleted_at IS NULL) AS dataset_count
    FROM connections c
    LEFT JOIN users u ON u.id = c.created_by`;

/*
 * `LEFT JOIN`, không `JOIN`. `fk_connections_creator` là ON DELETE SET NULL, nên
 * một kết nối có thể sống lâu hơn tài khoản người tạo ra nó. Phép nối trong sẽ
 * làm chính những dòng đó BIẾN MẤT khỏi danh sách — kiểu hỏng tệ nhất, vì nó
 * trông y hệt "không có kết nối nào" chứ không giống một lỗi.
 */

function toDto(row: ConnectionRow, viewer: ConnectionViewer): ConnectionDto {
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
    visibility: row.visibility,
    ownerName: row.owner_name,
    // Đúng cùng một luật với `whereOwned`. Hai chỗ chép tay một điều là chỗ
    // chúng sẽ lệch nhau, nhưng SQL không gọi lại được hàm TypeScript — nên
    // luật viết ở `whereOwned` là bản THẬT, còn dòng này chỉ để ẩn/hiện nút.
    // Lệch nhau thì triệu chứng là một nút bấm vào ra 404, không phải một lỗ
    // hổng.
    canManage:
      viewer.role === 'admin' ||
      (row.created_by !== null &&
        Number(row.created_by) === viewer.userId &&
        row.visibility === 'private'),
  };
}

export async function list(
  db: Db,
  tenantId: number,
  viewer: ConnectionViewer,
): Promise<ConnectionDto[]> {
  const scope = whereVisible(viewer);
  const [rows] = await db.query<ConnectionRow[]>(
    `${SELECT_LIST}
      WHERE c.tenant_id = ? AND c.deleted_at IS NULL${scope.sql}
      ORDER BY c.visibility ASC, c.name ASC`,
    [tenantId, ...scope.params],
  );
  return rows.map((row) => toDto(row, viewer));
}

/*
 * `ORDER BY visibility ASC` — ENUM sắp theo THỨ TỰ KHAI BÁO, không theo bảng
 * chữ cái: `ENUM('shared','private')` cho shared = 1, private = 2. Nên kho chung
 * lên trước, kết nối riêng xuống sau, và danh sách đọc ra là "của tổ chức, rồi
 * tới của tôi". Đảo thứ tự khai báo trong migration sẽ lặng lẽ đảo thứ tự ở đây.
 */

export async function findOne(
  db: Db,
  tenantId: number,
  id: number,
  viewer: ConnectionViewer,
): Promise<ConnectionDto | null> {
  const scope = whereVisible(viewer);
  const [rows] = await db.query<ConnectionRow[]>(
    `${SELECT_LIST}
      WHERE c.tenant_id = ? AND c.id = ? AND c.deleted_at IS NULL${scope.sql}
      LIMIT 1`,
    [tenantId, id, ...scope.params],
  );
  const row = rows[0];
  return row ? toDto(row, viewer) : null;
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
/*
 * ⚠️ CHỐT CHẶN của cả nhóm §8. Bốn thao tác nặng nhất đều đi qua đúng hàm này —
 * `testSavedConnection`, `listSavedDatabases`, `listSourceTables`,
 * `syncDatasets` — vì cả bốn đều cần mở kết nối thật ra ngoài, và mở thì phải có
 * mật khẩu.
 *
 * Nên `viewer` ở đây không phải để lịch sự. Không có nó, một creator biết id là
 * đồng bộ được dữ liệu từ kết nối RIÊNG của người khác: `/tables` và `/sync` gác
 * bằng `dataset:modify` (mà creator có), rồi nhận `:id` thẳng từ URL. Lọc ở
 * `list` mà quên chỗ này là giấu kết nối trên màn hình trong khi vẫn để ngỏ
 * đường rút dữ liệu qua nó.
 */
export async function findSecret(
  db: Db,
  tenantId: number,
  id: number,
  viewer: ConnectionScope,
): Promise<ConnectionSecret | null> {
  const scope = whereVisible(viewer);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.kind, c.host, c.port, c.use_ssl, c.database_name, c.username,
            c.password_cipher
       FROM connections c
      WHERE c.tenant_id = ? AND c.id = ? AND c.deleted_at IS NULL${scope.sql}
      LIMIT 1`,
    [tenantId, id, ...scope.params],
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
  /**
   * Vào kho chung hay thành của riêng người tạo.
   *
   * Bắt buộc, KHÔNG có giá trị mặc định ở tầng TypeScript. Cột dưới database mặc
   * định `'private'` để hướng quên là hướng giấu; nhưng ở đây thì mọi nơi gọi
   * phải nói ra ý định của mình, vì đây đúng là quyết định "ai thấy được thông
   * tin đăng nhập CSDL này" và nó không nên rơi vào một mặc định im lặng.
   */
  visibility: ConnectionVisibility;
}

export async function create(
  db: Db,
  tenantId: number,
  input: CreateConnectionInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO connections
       (tenant_id, name, kind, host, port, use_ssl, database_name, username,
        password_cipher, created_by, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.visibility,
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
  viewer: ConnectionViewer,
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

  // Ràng buộc sở hữu đi TRONG câu lệnh. Không quyền -> 0 dòng -> service ném
  // 404, cùng lối ra với "không tìm thấy". Xem ghi chú đầu file.
  const owned = whereOwned(viewer);
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE connections SET ${sets.join(', ')}
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL${owned.sql}`,
    [...params, tenantId, id, ...owned.params],
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
export async function softDelete(
  db: Db,
  tenantId: number,
  id: number,
  viewer: ConnectionViewer,
): Promise<number> {
  const owned = whereOwned(viewer);
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE connections SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL${owned.sql}`,
    [tenantId, id, ...owned.params],
  );
  return result.affectedRows;
}

/**
 * Người gọi có SỬA/XOÁ được dòng này không — hỏi TRƯỚC khi làm gì khác.
 *
 * Sinh ra vì một rò rỉ có thật trong `deleteConnection`: nó đếm dataset trước
 * rồi mới xoá, nên một creator bấm xoá kết nối riêng của người khác sẽ nhận
 * `409 — Kết nối này còn 12 tập dữ liệu`. Câu đó XÁC NHẬN id kia có thật và nói
 * luôn quy mô của nó, trong khi câu trả lời đúng phải là 404 y như mọi id không
 * tồn tại. Cùng lập luận đã dùng khắp nơi cho "id của tổ chức khác -> 404".
 *
 * Dùng `whereOwned`, KHÔNG phải `whereVisible`: creator nhìn thấy kho chung
 * nhưng không được xoá nó.
 */
export async function canManage(
  db: Db,
  tenantId: number,
  id: number,
  viewer: ConnectionViewer,
): Promise<boolean> {
  const owned = whereOwned(viewer);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM connections
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL${owned.sql}
      LIMIT 1`,
    [tenantId, id, ...owned.params],
  );
  return rows.length > 0;
}

/**
 * Số dataset còn sống đang trỏ tới kết nối này.
 *
 * KHÔNG nhận `viewer`, và đó không phải sót: hàm này chỉ đếm, và nó luôn chạy
 * sau khi `softDelete` đã trả lời câu hỏi quyền. Thêm phạm vi vào đây sẽ cho ra
 * một con số nhỏ hơn sự thật khi dataset thuộc workspace người gọi không mở —
 * mà con số này dùng để CHẶN xoá, nên đếm hụt là nới lỏng đúng cái lưới an
 * toàn nó sinh ra để giăng.
 */
export async function countDatasets(db: Db, tenantId: number, id: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return Number(rows[0]?.['total'] ?? 0);
}
