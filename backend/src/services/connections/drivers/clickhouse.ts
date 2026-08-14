import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import { quoteIdent } from '../../ingest/typeMap';
import { toCell } from './cell';
import {
  CLICKHOUSE_TIMEOUT_MS,
  type ColumnMeta,
  type ConnectionConfig,
  type Driver,
  type TableSchema,
} from './types';

/**
 * Driver ClickHouse.
 *
 * Khác MySQL ở ba điểm:
 *
 * 1. Giao thức là **HTTP(S)**, không phải socket nhị phân riêng. Nên "kết nối" ở
 *    đây thực chất là một client HTTP không trạng thái — `close()` chỉ dọn
 *    keep-alive agent chứ không đóng phiên nào.
 *
 * 2. Metadata nằm ở `system.tables` / `system.columns`. ClickHouse CÓ hỗ trợ
 *    `information_schema` như một lớp tương thích, nhưng nó là view mỏng dựng
 *    trên `system.*` và thiếu vài cột; đọc thẳng nguồn thì đúng và nhanh hơn.
 *
 * 3. ClickHouse gọi "database" cho thứ MySQL gọi là schema. Ta ánh xạ `database`
 *    của ClickHouse sang `source_schema` để phần còn lại của hệ thống chỉ nhìn
 *    thấy một khái niệm duy nhất.
 */

const SYSTEM_DATABASES = ['system', 'INFORMATION_SCHEMA', 'information_schema'];

export const clickhouseDriver: Driver = {
  async test(cfg) {
    const client = open(cfg);
    try {
      const rs = await client.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' });
      const rows = await rs.json<{ v: string }>();
      return { serverVersion: rows[0]?.v ?? 'không rõ' };
    } finally {
      await client.close();
    }
  },

  async listDatabases(cfg) {
    // Mở KHÔNG kèm database — xem ghi chú cùng tên ở driver MySQL.
    const client = open({ ...cfg, database: '' });
    try {
      // ⚠️ `countIf(t.name != '')`, KHÔNG phải `count(t.name)`.
      //
      // ClickHouse để `join_use_nulls = 0` mặc định, nên `LEFT JOIN` không khớp
      // sẽ điền GIÁ TRỊ MẶC ĐỊNH (chuỗi rỗng) chứ không phải `NULL` — khác hẳn
      // SQL chuẩn. `count(t.name)` đếm luôn chuỗi rỗng đó, và mọi database rỗng
      // hiện ra là "1 bảng". Đã kiểm trên máy: `default` trả 1 trước khi sửa, 0
      // sau khi sửa. Con số sai ở đây còn tệ hơn không có con số, vì nó nói với
      // người dùng rằng database rỗng có dữ liệu.
      const rs = await client.query({
        query: `SELECT d.name AS name, countIf(t.name != '') AS n
                  FROM system.databases AS d
                  LEFT JOIN system.tables AS t ON t.database = d.name
                 WHERE d.name NOT IN ({sys:Array(String)})
                 GROUP BY d.name
                 ORDER BY d.name`,
        query_params: { sys: SYSTEM_DATABASES },
        format: 'JSONEachRow',
      });
      const rows = await rs.json<{ name: string; n: string }>();
      return rows.map((r) => ({ name: r.name, tableCount: Number(r.n) }));
    } finally {
      await client.close();
    }
  },

  async listTables(cfg) {
    const client = open(cfg);
    try {
      // `cfg.database` rỗng = người dùng chọn "tất cả database". Dùng một tham số
      // cờ thay vì ghép hai câu SQL: điều kiện vẫn tham số hoá hoàn toàn, và chỉ
      // có MỘT câu truy vấn để đọc khi đi tìm lỗi.
      const rs = await client.query({
        query: `SELECT database, name
                  FROM system.tables
                 WHERE ({all:UInt8} = 1 OR database = {db:String})
                   AND database NOT IN ({sys:Array(String)})
                   AND NOT is_temporary
                 ORDER BY database, name`,
        query_params: {
          all: cfg.database === '' ? 1 : 0,
          db: cfg.database,
          sys: SYSTEM_DATABASES,
        },
        format: 'JSONEachRow',
      });
      const rows = await rs.json<{ database: string; name: string }>();
      return rows.map((r) => ({ schema: r.database, table: r.name }));
    } finally {
      await client.close();
    }
  },

  async describeTables(cfg, refs) {
    if (refs.length === 0) return [];

    const client = open(cfg);
    try {
      // ClickHouse không có `unnest` hai mảng như PostgreSQL. Ghép mỗi cặp
      // thành chuỗi "db.bảng" rồi lọc bằng một mảng tham số — vẫn tham số hoá
      // hoàn toàn, tên bảng do người dùng gửi lên không đi vào SQL dưới dạng
      // mã. Dùng `{...:Array(String)}` chứ không nối chuỗi.
      const keys = refs.map((r) => `${r.schema}.${r.table}`);

      const rs = await client.query({
        query: `SELECT database, table, name, type, position
                  FROM system.columns
                 WHERE concat(database, '.', table) IN ({keys:Array(String)})
                 ORDER BY database, table, position`,
        query_params: { keys },
        format: 'JSONEachRow',
      });
      const rows = await rs.json<{
        database: string;
        table: string;
        name: string;
        type: string;
        position: number;
      }>();

      const byTable = new Map<string, TableSchema>();
      for (const row of rows) {
        const key = `${row.database}.${row.table}`;
        let entry = byTable.get(key);
        if (!entry) {
          entry = { schema: row.database, table: row.table, columns: [] };
          byTable.set(key, entry);
        }
        entry.columns.push(toColumn(row));
      }
      return [...byTable.values()];
    } finally {
      await client.close();
    }
  },

  async previewRows(cfg, ref, limit) {
    const client = open(cfg);
    try {
      // Nhẹ hơn MySQL đúng một bậc: ClickHouse tham số hoá được cả ĐỊNH DANH
      // bằng `{x:Identifier}`, nên không phải ghép chuỗi nào vào SQL cả.
      //
      // `JSONCompactEachRowWithNames` trả dòng đầu là mảng TÊN CỘT, các dòng
      // sau là mảng GIÁ TRỊ. Chọn định dạng này thay vì `JSONEachRow` vì nó giữ
      // đúng thứ tự cột và không nhân tên cột lên 100 lần trong response.
      const rs = await client.query({
        query: `SELECT * FROM {db:Identifier}.{tbl:Identifier} LIMIT {n:UInt32}`,
        query_params: { db: ref.schema, tbl: ref.table, n: limit },
        format: 'JSONCompactEachRowWithNames',
      });

      const lines = await rs.json<unknown[]>();
      const [names, ...data] = lines;

      return {
        columns: Array.isArray(names) ? names.map(String) : [],
        rows: data.map((row) => (Array.isArray(row) ? row.map(toCell) : [])),
      };
    } finally {
      await client.close();
    }
  },

  async *readAllRows(cfg, ref, opts) {
    if (opts.columns.length === 0) {
      throw new Error('readAllRows cần ít nhất một cột.');
    }

    const client = open(cfg);
    try {
      // Danh sách cột KHÔNG tham số hoá được ({x:Identifier} chỉ thay được MỘT
      // định danh, không thay được cả một danh sách), nên đây là chỗ duy nhất
      // của driver này phải nối chuỗi. Tên cột đến từ `dataset_columns` — do
      // `describeTables` ghi vào từ `system.columns` — và vẫn được bọc bằng
      // `quoteIdent` để một thay đổi tương lai không biến nó thành lỗ hổng.
      const columns = opts.columns.map(quoteIdent).join(', ');

      const rs = await client.query({
        query: `SELECT ${columns} FROM {db:Identifier}.{tbl:Identifier} LIMIT {n:UInt64}`,
        query_params: { db: ref.schema, tbl: ref.table, n: opts.maxRows },
        format: 'JSONCompactEachRow',
      });

      // `rs.stream()` phát ra từng KHỐI dòng theo nhịp mạng, không phải từng
      // dòng — nên phải tự gom lại cho đúng cỡ lô mà tầng nạp yêu cầu.
      let batch: unknown[][] = [];
      for await (const chunk of rs.stream<unknown[]>()) {
        for (const row of chunk) {
          batch.push(row.json());
          if (batch.length >= opts.batchSize) {
            yield batch;
            batch = [];
          }
        }
      }
      if (batch.length > 0) yield batch;
    } finally {
      await client.close();
    }
  },
};

function toColumn(row: { name: string; type: string; position: number }): ColumnMeta {
  return {
    name: row.name,
    // ClickHouse trả kiểu đầy đủ, ví dụ `Nullable(String)` hay
    // `LowCardinality(Nullable(DateTime64(3)))`. Giữ NGUYÊN chuỗi đó: nó là
    // thông tin thật mà người dựng mô hình dữ liệu cần đọc, và cắt gọt nó ở đây
    // là làm mất dữ liệu để đổi lấy vẻ gọn gàng.
    dataType: row.type,
    // Không có cột `is_nullable` riêng — tính nullable nằm trong chính tên kiểu.
    isNullable: /\bNullable\(/.test(row.type),
    ordinal: Number(row.position),
  };
}

/**
 * Mở client, giữ được CẢ HAI thứ vốn xung khắc: chứng chỉ TLS và ghim IP.
 *
 * ─── Vấn đề ─────────────────────────────────────────────────────────────────
 *
 * `guardHost` phân giải tên miền rồi bắt driver kết nối tới đúng IP đã kiểm, để
 * DNS không kịp đổi sang địa chỉ nội bộ giữa lúc kiểm và lúc nối. Với HTTP thô
 * thì chỉ cần đặt IP vào URL là xong.
 *
 * Bật TLS lên thì cách đó gãy: chứng chỉ của ClickHouse Cloud ký cho
 * `*.clickhouse.cloud`, nên gọi `https://<IP>:8443` sẽ trượt xác thực với
 * `ERR_TLS_CERT_ALTNAME_INVALID` dù đang nối đúng máy chủ. Hai lối thoát tầm
 * thường đều tồi: đưa hostname vào URL là vứt luôn lớp ghim IP, còn tắt
 * `rejectUnauthorized` là vứt luôn ý nghĩa của TLS — kẻ chen giữa đường truyền
 * sẽ đọc được mật khẩu CSDL của khách hàng.
 *
 * ─── Cách làm ───────────────────────────────────────────────────────────────
 *
 * Tách hai vai trò vốn bị gộp làm một trong chữ "host":
 *
 *   URL mang TÊN MIỀN  -> SNI và phần kiểm chứng chỉ đều đúng tên
 *   `lookup` của agent -> trả thẳng IP đã kiểm, không hỏi DNS lần nữa
 *
 * Node gọi `lookup` ngay trước khi mở socket, nên trả sẵn IP ở đó khiến tầng
 * phân giải tên bị bỏ qua hoàn toàn. Bắt tay TLS vẫn diễn ra với tên miền, còn
 * gói tin thì đi tới đúng địa chỉ `guardHost` đã duyệt — và tiện thể khép luôn
 * khe DNS rebinding mà `guardHost.ts` ghi là còn hở.
 */
function open(cfg: ConnectionConfig): ClickHouseClient {
  const hostname = cfg.serverName?.trim() || cfg.host;
  // IPv6 trong URL phải nằm trong ngoặc vuông, nếu không `new URL()` đọc dấu hai
  // chấm đầu tiên thành ranh giới cổng.
  const authority = isIP(hostname) === 6 ? `[${hostname}]` : hostname;

  const family = isIP(cfg.host) === 6 ? 6 : 4;
  const Agent = cfg.ssl ? HttpsAgent : HttpAgent;
  const agent = new Agent({
    // Tắt keep-alive: client này sống đúng một thao tác rồi bị đóng, nên giữ
    // socket lại chỉ để lát nữa vứt đi là lãng phí — và với host của khách hàng
    // thì đó còn là một socket ta để mở trên máy của người khác.
    keepAlive: false,
    // Node gọi hàm này theo HAI kiểu và phải trả lời đúng kiểu nó hỏi. Từ Node
    // 20, `autoSelectFamily` bật mặc định nên đường đi thường dùng là
    // `lookupAndConnectMultiple`, và nó truyền `all: true` rồi chờ một MẢNG
    // địa chỉ. Trả về chuỗi ở nhánh đó thì Node đọc `undefined` làm địa chỉ và
    // ném `ERR_INVALID_IP_ADDRESS` — lỗi không dính gì tới CSDL, hiện ra ở giao
    // diện thành "không kết nối được" chung chung.
    lookup: (_hostname, options, callback) => {
      if (options.all === true) callback(null, [{ address: cfg.host, family }]);
      else callback(null, cfg.host, family);
    },
  });

  return createClient({
    url: `${cfg.ssl ? 'https' : 'http'}://${authority}:${cfg.port}`,
    // Bỏ hẳn khoá khi rỗng ("mọi database") thay vì gửi chuỗi rỗng: client sẽ
    // đính `database=` vào mọi request, và ClickHouse hiểu đó là tên database
    // rỗng chứ không phải "không chọn". Mọi truy vấn của driver này đều ghi rõ
    // tiền tố database nên không có gì phụ thuộc vào ngữ cảnh mặc định.
    ...(cfg.database === '' ? {} : { database: cfg.database }),
    username: cfg.username,
    password: cfg.password,
    request_timeout: CLICKHOUSE_TIMEOUT_MS,
    // Đặt `http_agent` làm mọi tuỳ chọn `keep_alive`/`tls` của client mất tác
    // dụng — chúng thuộc về agent mặc định mà ta vừa thay. Nên cấu hình
    // keep-alive nằm trên chính agent ở trên, không phải ở đây.
    http_agent: agent,
  });
}
