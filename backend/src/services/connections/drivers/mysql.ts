import { escapeId } from 'mysql2';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { isIP } from 'node:net';
import { toCell } from './cell';
import {
  CONNECT_TIMEOUT_MS,
  type ColumnMeta,
  type ConnectionConfig,
  type Driver,
  type TableRef,
  type TableSchema,
} from './types';

/**
 * Driver MySQL.
 *
 * Dùng `createConnection` chứ KHÔNG phải pool: kết nối tới CSDL của khách hàng
 * là thao tác thưa (vài lần một ngày), còn pool thì giữ socket mở vô thời hạn
 * tới máy chủ của người khác. Mở — dùng — đóng là đúng hình dạng của việc này.
 *
 * Mọi hàm đóng kết nối trong `finally`. Thiếu một chỗ là rò một socket mỗi lần
 * chạy, và triệu chứng chỉ lộ ra sau vài ngày dưới dạng "too many connections"
 * ở phía KHÁCH HÀNG — nơi ta không nhìn thấy log.
 */

/**
 * Schema hệ thống của MySQL.
 *
 * Không lọc thì lần đồng bộ đầu tiên đổ vào kho vài trăm bảng `performance_schema`
 * mà không ai muốn, và người dùng sẽ phải tự tìm bảng của mình giữa đống đó.
 */
const SYSTEM_SCHEMAS = ['mysql', 'sys', 'performance_schema', 'information_schema'];

export const mysqlDriver: Driver = {
  async test(cfg) {
    const conn = await open(cfg);
    try {
      const [rows] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS v');
      return { serverVersion: String(rows[0]?.['v'] ?? 'không rõ') };
    } finally {
      await conn.end();
    }
  },

  async listTables(cfg) {
    const conn = await open(cfg);
    try {
      // Giới hạn trong ĐÚNG database đã khai, không quét cả máy chủ: tài khoản
      // kết nối có thể thấy nhiều database, nhưng người dùng đã chỉ định họ
      // muốn database nào.
      //
      // BASE TABLE và VIEW đều lấy — với người phân tích, một view là một nguồn
      // dữ liệu hợp lệ y như bảng.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_schema AS s, table_name AS t
           FROM information_schema.tables
          WHERE table_schema = ?
            AND table_schema NOT IN (?)
            AND table_type IN ('BASE TABLE', 'VIEW')
          ORDER BY table_name`,
        [cfg.database, SYSTEM_SCHEMAS],
      );
      return rows.map((r) => ({ schema: String(r['s']), table: String(r['t']) }));
    } finally {
      await conn.end();
    }
  },

  async describeTables(cfg, refs) {
    if (refs.length === 0) return [];

    const conn = await open(cfg);
    try {
      // MỘT truy vấn cho tất cả bảng được chọn, không phải một truy vấn mỗi
      // bảng: chọn 50 bảng thì cách kia là 50 vòng đi về qua mạng, và với một
      // CSDL ở xa thì đó là vài chục giây thuần độ trễ.
      //
      // `(table_schema, table_name) IN ((?,?),(?,?)…)` — mysql2 trải mảng lồng
      // thành đúng danh sách bộ giá trị đó, và mọi giá trị vẫn đi qua tham số
      // hoá nên tên bảng do người dùng gửi lên không thể thoát ra thành SQL.
      // Bí danh viết thường cho MỌI cột, không phải cho đẹp: MySQL 8 trả tên
      // cột của `information_schema` viết HOA (`TABLE_SCHEMA`), còn MySQL 5.7
      // và MariaDB trả viết thường. Đọc `row['table_schema']` thì trên MySQL 8
      // ra `undefined` — và `String(undefined)` cho chuỗi "undefined", nên lỗi
      // không nổ ở đâu cả, chỉ lặng lẽ tạo ra dataset tên "undefined".
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_schema AS s, table_name AS t, column_name AS c,
                data_type AS dt, is_nullable AS nl, ordinal_position AS ord
           FROM information_schema.columns
          WHERE (table_schema, table_name) IN (?)
          ORDER BY table_schema, table_name, ordinal_position`,
        [refs.map((r) => [r.schema, r.table])],
      );

      const byTable = new Map<string, TableSchema>();
      for (const row of rows) {
        const schema = String(row['s']);
        const table = String(row['t']);
        const key = `${schema}.${table}`;

        let entry = byTable.get(key);
        if (!entry) {
          entry = { schema, table, columns: [] };
          byTable.set(key, entry);
        }
        entry.columns.push(toColumn(row));
      }
      return [...byTable.values()];
    } finally {
      await conn.end();
    }
  },

  async previewRows(cfg, ref, limit) {
    const conn = await open(cfg);
    try {
      // ─── Chỗ nguy hiểm nhất của cả file, nên nói cho rõ ─────────────────
      //
      // Tên bảng KHÔNG tham số hoá được: `SELECT * FROM ?` là lỗi cú pháp trong
      // MySQL, vì `?` chỉ thay được GIÁ TRỊ chứ không thay được ĐỊNH DANH. Nên
      // đây là câu lệnh duy nhất trong dự án phải ghép chuỗi vào SQL.
      //
      // Hai lớp chặn, và cần cả hai:
      //
      //   1. `ref` đọc từ bảng `datasets` của CHÍNH TA, mà giá trị trong đó do
      //      `describeTables` ghi vào từ `information_schema`. Client không có
      //      đường nào gửi tên bảng tuỳ ý tới đây — nó chỉ gửi được một id.
      //   2. `escapeId` bọc backtick và nhân đôi mọi backtick bên trong. Kể cả
      //      khi lớp 1 bị phá vỡ ở một thay đổi tương lai, tên bảng vẫn không
      //      thoát ra thành mã.
      //
      // Bỏ lớp 2 vì "dữ liệu đằng nào cũng của mình" là đúng ở hôm nay và sai ở
      // ngày có người thêm một endpoint nhận tên bảng từ ngoài.
      const table = `${escapeId(ref.schema)}.${escapeId(ref.table)}`;

      // `LIMIT ?` chỉ chạy với prepared statement, còn `query` thì bọc số thành
      // chuỗi và cho ra lỗi cú pháp. Nội suy trực tiếp là an toàn vì `limit` là
      // hằng số của backend, nhưng vẫn kiểm lại — một số âm hay `NaN` lọt vào
      // đây sẽ thành SQL hỏng, và ta muốn biết điều đó ở đây chứ không phải từ
      // một thông báo lỗi của MySQL.
      const rowLimit = Math.trunc(limit);
      if (!Number.isInteger(rowLimit) || rowLimit <= 0) {
        throw new Error(`Số dòng xem trước không hợp lệ: ${limit}`);
      }

      // `rowsAsArray` để giữ ĐÚNG thứ tự cột của bảng nguồn và không mất cột
      // trùng tên. Dạng object mặc định thì hai cột cùng tên (hay gặp sau một
      // câu JOIN) sẽ đè lên nhau, và thứ tự khoá của object là thứ tự chèn chứ
      // không phải thứ tự cột.
      const [result, fields] = await conn.query<RowDataPacket[][]>({
        sql: `SELECT * FROM ${table} LIMIT ${rowLimit}`,
        rowsAsArray: true,
      });

      const rows = result as unknown as unknown[][];
      return {
        columns: fields.map((f) => f.name),
        rows: rows.map((row) => row.map(toCell)),
      };
    } finally {
      await conn.end();
    }
  },
};

function toColumn(row: RowDataPacket): ColumnMeta {
  return {
    name: String(row['c']),
    dataType: String(row['dt']),
    // information_schema trả chuỗi 'YES' / 'NO', không phải boolean.
    isNullable: String(row['nl']).toUpperCase() === 'YES',
    ordinal: Number(row['ord']),
  };
}

function open(cfg: ConnectionConfig) {
  return createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    connectTimeout: CONNECT_TIMEOUT_MS,
    ...tlsOptions(cfg),
    // Cấm TUYỆT ĐỐI nhiều câu lệnh trong một query. Ta chỉ chạy truy vấn đọc
    // metadata, nên bật nó không mang lại gì; còn tắt thì mọi lỗi nối chuỗi
    // trong tương lai dừng ở một câu lệnh thay vì thành cả một kịch bản.
    multipleStatements: false,
    dateStrings: true,
  });
}

/**
 * Tuỳ chọn TLS, và lý do `servername` là bắt buộc chứ không phải trang trí.
 *
 * `host` truyền vào mysql2 là IP đã qua `guardHost`, không phải tên miền người
 * dùng gõ. Chứng chỉ của máy chủ thì ký cho TÊN MIỀN, nên nếu không nói riêng
 * cho tầng TLS biết tên đó là gì, bắt tay sẽ trượt với
 * `ERR_TLS_CERT_ALTNAME_INVALID` — kết nối đúng đích, đúng mật khẩu, mà vẫn
 * hỏng. `servername` tách phần "kiểm danh tính" khỏi phần "nối tới đâu": socket
 * vẫn ghim ở IP đã duyệt, còn SNI và phần đối chiếu chứng chỉ dùng tên miền.
 *
 * Bỏ `servername` khi người dùng gõ thẳng IP: SNI theo chuẩn KHÔNG nhận địa chỉ
 * IP, và gửi vào đó sẽ bị nhiều máy chủ từ chối bắt tay.
 *
 * Cố ý KHÔNG có cửa tắt `rejectUnauthorized`. Một cờ như vậy sẽ được tick vào
 * lúc 11 giờ đêm để "cho chạy đã", và từ đó mật khẩu CSDL của khách hàng đi qua
 * một đường ống mà bất kỳ ai chen giữa cũng đọc được — đúng thứ mà TLS sinh ra
 * để chặn.
 */
function tlsOptions(cfg: ConnectionConfig): { ssl?: { minVersion: 'TLSv1.2'; servername?: string } } {
  if (!cfg.ssl) return {};

  const name = cfg.serverName?.trim();
  const usableAsSni = name !== undefined && name !== '' && isIP(name) === 0;

  return { ssl: { minVersion: 'TLSv1.2', ...(usableAsSni ? { servername: name } : {}) } };
}

export type { TableRef };
