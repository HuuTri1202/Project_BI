import { createConnection as createCallbackConnection, escapeId } from 'mysql2';
import { createConnection, type ConnectionOptions, type RowDataPacket } from 'mysql2/promise';
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

  async listDatabases(cfg) {
    // Mở KHÔNG kèm database: hàm này trả lời "có những cái nào", nên tự khoá vào
    // cái đang chọn là tự mâu thuẫn — và nếu cái đang chọn gõ sai thì đến cả
    // việc mở kết nối cũng hỏng, đúng lúc người dùng cần danh sách nhất.
    const conn = await open({ ...cfg, database: '' });
    try {
      // `LEFT JOIN` chứ không `GROUP BY` trên riêng `tables`: database KHÔNG có
      // bảng nào phải xuất hiện trong danh sách, vì đó chính là ca người dùng
      // cần nhìn thấy — chọn nhầm một database rỗng là nguyên nhân thường gặp
      // nhất của "đồng bộ không ra bảng nào".
      //
      // `information_schema.schemata` đã tự lọc theo quyền của tài khoản, nên
      // danh sách này là đúng những gì họ thật sự với tới được.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT s.schema_name AS s, COUNT(t.table_name) AS n
           FROM information_schema.schemata s
           LEFT JOIN information_schema.tables t
             ON t.table_schema = s.schema_name
            AND t.table_type IN ('BASE TABLE', 'VIEW')
          WHERE s.schema_name NOT IN (?)
          GROUP BY s.schema_name
          ORDER BY s.schema_name`,
        [SYSTEM_SCHEMAS],
      );
      return rows.map((r) => ({ name: String(r['s']), tableCount: Number(r['n']) }));
    } finally {
      await conn.end();
    }
  },

  async listTables(cfg) {
    const scoped = cfg.database !== '';
    const conn = await open(cfg);
    try {
      // BASE TABLE và VIEW đều lấy — với người phân tích, một view là một nguồn
      // dữ liệu hợp lệ y như bảng.
      //
      // `cfg.database` rỗng nghĩa là người dùng chọn "tất cả database": quét cả
      // máy chủ, trừ schema hệ thống. Sắp theo `table_schema` TRƯỚC rồi mới tới
      // tên bảng, để danh sách gộp nhóm sẵn cho giao diện.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_schema AS s, table_name AS t
           FROM information_schema.tables
          WHERE ${scoped ? 'table_schema = ?' : '1 = 1'}
            AND table_schema NOT IN (?)
            AND table_type IN ('BASE TABLE', 'VIEW')
          ORDER BY table_schema, table_name`,
        scoped ? [cfg.database, SYSTEM_SCHEMAS] : [SYSTEM_SCHEMAS],
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
      //
      // `column_type` chứ KHÔNG phải `data_type`, và khác biệt này quan trọng
      // hơn vẻ ngoài của nó. `data_type` trả kiểu GỐC (`decimal`, `tinyint`),
      // `column_type` trả kiểu ĐẦY ĐỦ (`decimal(18,4)`, `tinyint(1)`).
      //
      // Mục 8 dùng chuỗi này chỉ để hiển thị nên hai cái tương đương. Mục 9 thì
      // dựng câu `CREATE TABLE` bên ClickHouse từ chính nó, và ở đó phần trong
      // ngoặc là dữ liệu chứ không phải trang trí:
      //
      //   `decimal` trần   -> không biết mấy chữ số thập phân -> đoán bừa
      //                       `Decimal(18,2)` và ÂM THẦM làm tròn tiền.
      //   `tinyint` trần   -> không phân biệt được boolean `tinyint(1)` với số
      //                       nguyên nhỏ.
      //
      // Dataset đồng bộ trước thay đổi này giữ kiểu cũ cho tới lần đồng bộ sau;
      // không mất gì, vì mục 8 vốn chỉ giữ cấu trúc.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_schema AS s, table_name AS t, column_name AS c,
                column_type AS dt, is_nullable AS nl, ordinal_position AS ord
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

  async *readAllRows(cfg, ref, opts) {
    if (opts.columns.length === 0) {
      throw new Error('readAllRows cần ít nhất một cột.');
    }

    const conn = createCallbackConnection(
      connectionOptions(cfg, {
        // ─── Hai cờ này chống MẤT CHÍNH XÁC, không phải tối ưu ────────────
        //
        // Mặc định mysql2 đưa BIGINT qua `Number` của JS, vốn chỉ chính xác tới
        // 2^53. Một khoá chính 9007199254740993 về thành ...992 và KHÔNG có lỗi
        // nào cả. Ép về chuỗi thì ClickHouse parse thẳng vào Int64/UInt64 đúng
        // từng chữ số.
        supportBigNumbers: true,
        bigNumberStrings: true,
      }),
    );

    try {
      // ─── Bẫy lệch 7 tiếng, và nó chỉ có ở đường NẠP ─────────────────────
      //
      // Cột `TIMESTAMP` được máy chủ NGUỒN đổi sang múi giờ của phiên trước khi
      // trả về. Máy chủ MySQL đặt `TZ=Asia/Ho_Chi_Minh` — như chính `bi-mysql`
      // trong docker-compose — sẽ trả `'2026-07-01 16:15:00'` cho một mốc mà
      // UTC là `09:15`. Nạp thẳng chuỗi đó vào cột khai `'UTC'` là lệch đúng 7
      // tiếng, im lặng, và chỉ lộ ra ở báo cáo sai một ngày.
      //
      // Đúng khuôn `config/mysql.ts` đã làm cho pool nội bộ. Sau câu này,
      // `TIMESTAMP` về đúng UTC.
      //
      // `DATETIME` thì KHÔNG đổi — nó là giờ đồng hồ treo tường, không mang múi
      // giờ nào. Ta buộc phải giả định nó đã là UTC, và giả định đó được ghi ra
      // đây vì không có cách nào biết được từ metadata.
      await new Promise<void>((resolve, reject) => {
        conn.query("SET time_zone = '+00:00'", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const table = `${escapeId(ref.schema)}.${escapeId(ref.table)}`;
      const columns = opts.columns.map((c) => escapeId(c)).join(', ');

      // `.stream()` thay cho `await query()`: câu await dựng TOÀN BỘ kết quả
      // trong bộ nhớ Node trước khi trả về dòng đầu tiên, nên một bảng triệu
      // dòng là một lần hết RAM.
      const stream = conn
        .query({ sql: `SELECT ${columns} FROM ${table}`, rowsAsArray: true })
        .stream({ highWaterMark: opts.batchSize });

      let batch: unknown[][] = [];
      let total = 0;

      for await (const row of stream) {
        batch.push(row as unknown[]);
        total += 1;

        if (batch.length >= opts.batchSize) {
          yield batch;
          batch = [];
        }
        if (total >= opts.maxRows) {
          // `destroy()` chứ không `break` trần: bỏ vòng lặp mà để stream sống
          // thì mysql2 vẫn kéo nốt kết quả về qua mạng cho một thứ không ai đọc.
          stream.destroy();
          break;
        }
      }

      if (batch.length > 0) yield batch;
    } finally {
      // `destroy()` chứ không `end()`: `end()` chờ hàng đợi lệnh trôi hết, mà
      // khi người gọi bỏ vòng lặp giữa chừng (hoặc một lỗi ném ra) thì hàng đợi
      // đó có thể còn nguyên một kết quả đang chảy về — và ta sẽ treo ở đây.
      conn.destroy();
    }
  },
};

/** Trần của cột `dataset_columns.data_type` sau migration 9. */
const MAX_DATA_TYPE_CHARS = 255;

function toColumn(row: RowDataPacket): ColumnMeta {
  return {
    name: String(row['c']),
    // Cắt bớt vì `column_type` KHÔNG có giới hạn thực tế: một cột
    // `enum('a','b',…)` với vài chục giá trị dài hơn mọi VARCHAR hợp lý, và
    // MySQL ở chế độ strict sẽ làm HỎNG CẢ LẦN ĐỒNG BỘ chỉ vì một cột như vậy.
    // Phần bị cắt không mất gì thật: mọi kiểu dài đều là enum/set, và bảng ánh
    // xạ ở mục 9.2 cho chúng về `Nullable(String)` bất kể nội dung trong ngoặc.
    dataType: String(row['dt']).slice(0, MAX_DATA_TYPE_CHARS),
    // information_schema trả chuỗi 'YES' / 'NO', không phải boolean.
    isNullable: String(row['nl']).toUpperCase() === 'YES',
    ordinal: Number(row['ord']),
  };
}

/**
 * Tuỳ chọn kết nối, dùng chung cho CẢ HAI kiểu client.
 *
 * Tách ra khỏi `open()` vì đường đọc theo dòng chảy (`readAllRows`) buộc phải
 * dùng client kiểu CALLBACK: bản gói `mysql2/promise` trả Promise từ `query()`
 * nên không có `.stream()`, và không có stream thì cả kết quả bị dựng trong bộ
 * nhớ Node trước khi trả về dòng đầu tiên.
 *
 * Cùng một object cấu hình cho hai đường là điều kiện để lớp bảo vệ không bị bỏ
 * quên ở một bên: `tlsOptions` và `multipleStatements: false` phải áp cho cả hai.
 */
function connectionOptions(cfg: ConnectionConfig, extra: ConnectionOptions = {}): ConnectionOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    // Chuỗi rỗng ("mọi database") phải thành `undefined`, KHÔNG được gửi nguyên:
    // mysql2 gửi chuỗi rỗng đi như một yêu cầu `USE ''` và máy chủ từ chối bắt
    // tay. Quy đổi ở đây, một chỗ duy nhất, để mọi hàm của driver — kể cả
    // `test()` chạy trước khi kết nối được lưu — đều an toàn.
    ...(cfg.database === '' ? {} : { database: cfg.database }),
    user: cfg.username,
    password: cfg.password,
    connectTimeout: CONNECT_TIMEOUT_MS,
    ...tlsOptions(cfg),
    ...extra,
    // Cấm TUYỆT ĐỐI nhiều câu lệnh trong một query. Ta chỉ chạy truy vấn đọc
    // metadata, nên bật nó không mang lại gì; còn tắt thì mọi lỗi nối chuỗi
    // trong tương lai dừng ở một câu lệnh thay vì thành cả một kịch bản.
    multipleStatements: false,
    dateStrings: true,
  };
}

function open(cfg: ConnectionConfig, extra: ConnectionOptions = {}) {
  return createConnection(connectionOptions(cfg, extra));
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
