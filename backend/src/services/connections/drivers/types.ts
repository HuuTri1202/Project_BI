/**
 * Hợp đồng chung của mọi loại CSDL nguồn.
 *
 * Hai loại (MySQL, ClickHouse) khác nhau ở thư viện, ở phương ngữ SQL và ở nơi
 * cất metadata. Chúng KHÔNG được khác nhau ở chỗ nào khác: phần còn lại của hệ
 * thống chỉ nhìn thấy interface này, nên thêm loại thứ ba là viết thêm một file
 * rồi khai một dòng trong bảng tra — không phải đi sửa service, route và giao
 * diện.
 */

export type ConnectionKind = 'mysql' | 'clickhouse';

/**
 * Đủ để mở một kết nối.
 *
 * `host` ở đây là **IP đã qua `resolveAndGuardHost`**, không phải hostname người
 * dùng gõ. Driver KHÔNG được tự phân giải lại — xem ghi chú DNS rebinding trong
 * `guardHost.ts`.
 */
export interface ConnectionConfig {
  host: string;
  port: number;
  /**
   * Database để giới hạn phạm vi liệt kê bảng. **Chuỗi rỗng = mọi database.**
   *
   * Chỉ `listTables` đọc trường này. `describeTables`, `previewRows` và
   * `readAllRows` đều lấy database từ `ref.schema` của TỪNG bảng — đã lưu trong
   * `datasets.source_schema` — nên chúng chạy đúng dù trường này rỗng.
   *
   * Cả MySQL lẫn ClickHouse đều nối được mà không cần khai database (đã kiểm:
   * `SELECT DATABASE()` trả `NULL` và truy vấn `db`.`bảng` vẫn chạy), nên rỗng
   * không phải trạng thái hỏng — nó là "chưa chọn thu hẹp".
   */
  database: string;
  username: string;
  password: string;
  /** Bọc kết nối trong TLS. Bắt buộc với mọi CSDL trên Internet công cộng. */
  ssl: boolean;
  /**
   * Tên miền gốc người dùng đã gõ.
   *
   * KHÔNG dùng để mở socket — socket luôn đi tới `host` (IP đã kiểm). Nó tồn tại
   * cho đúng một việc: TLS. Chứng chỉ của máy chủ được ký cho TÊN MIỀN, nên bắt
   * tay TLS thẳng tới một địa chỉ IP sẽ trượt xác thực với
   * `ERR_TLS_CERT_ALTNAME_INVALID` dù kết nối hoàn toàn đúng đích. Driver đưa
   * tên này vào SNI và vào phần kiểm chứng chỉ, còn socket vẫn ghim ở IP đã
   * kiểm — giữ được cả hai thứ thay vì phải bỏ một.
   */
  serverName?: string | undefined;
}

export interface TableRef {
  schema: string;
  table: string;
}

/** Một database ứng viên trong bộ chọn ở wizard kết nối. */
export interface DatabaseOption {
  name: string;
  tableCount: number;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinal: number;
}

export interface TableSchema extends TableRef {
  columns: ColumnMeta[];
}

/** Giá trị một ô sau khi đã ép về dạng gửi được qua JSON. */
export type PreviewCell = string | number | boolean | null;

export interface TablePreview {
  columns: string[];
  rows: PreviewCell[][];
}

/** Tham số cho `readAllRows`. Mọi giá trị do backend quyết, không nhận từ client. */
export interface ReadAllOptions {
  /** Tên cột nguồn cần lấy, đúng thứ tự sẽ ghi sang kho. Rỗng là lỗi lập trình. */
  columns: readonly string[];
  /** Số dòng mỗi lô đẩy ra cho người gọi. */
  batchSize: number;
  /** Dừng sau chừng này dòng. Trần an toàn, không phải một tính năng. */
  maxRows: number;
}

export interface Driver {
  /** Mở kết nối, chạy một truy vấn rẻ nhất có thể, trả phiên bản server. */
  test(cfg: ConnectionConfig): Promise<{ serverVersion: string }>;
  /**
   * Database mà tài khoản này nhìn thấy, kèm SỐ BẢNG mỗi cái.
   *
   * `cfg.database` bị BỎ QUA ở đây — hàm này tồn tại để trả lời "có những cái
   * nào", nên tự giới hạn theo cái đang chọn thì thành vô nghĩa.
   *
   * Số bảng không phải trang trí: nó biến lỗi chọn nhầm database từ "danh sách
   * bảng rỗng, không rõ vì sao" thành một dòng đọc được ngay tại chỗ chọn —
   * `default · 0 bảng`. Database rỗng vẫn phải xuất hiện trong danh sách, đúng vì
   * lý do đó.
   */
  listDatabases(cfg: ConnectionConfig): Promise<DatabaseOption[]>;
  /** Mọi bảng người dùng thấy được, đã loại các schema hệ thống. */
  listTables(cfg: ConnectionConfig): Promise<TableRef[]>;
  /** Schema của đúng những bảng được chọn. */
  describeTables(cfg: ConnectionConfig, refs: TableRef[]): Promise<TableSchema[]>;
  /**
   * Vài dòng đầu của một bảng, để người dùng NHÌN được dữ liệu.
   *
   * `limit` do backend quyết, không nhận từ client — xem `PREVIEW_ROW_LIMIT`.
   */
  previewRows(cfg: ConnectionConfig, ref: TableRef, limit: number): Promise<TablePreview>;
  /**
   * Đọc TOÀN BỘ bảng nguồn theo lô, để nạp vào kho phân tích (§9.4).
   *
   * ─── Vì sao là async generator, không phải `readRowsPaged(offset, limit)` ──
   *
   * Phân trang bằng `LIMIT/OFFSET` là cách hiển nhiên và nó SAI hai lần:
   *
   *   1. Chậm dần đều. MySQL phải quét rồi vứt bỏ `OFFSET` dòng ở mỗi trang, nên
   *      tổng công là O(n²) — tới dòng 900.000 thì mỗi trang quét gần một triệu
   *      dòng chỉ để lấy 5.000.
   *   2. KHÔNG NHẤT QUÁN. Giữa hai trang, bảng nguồn có thể được ghi thêm hoặc
   *      xoá bớt, và khi đó có dòng bị đọc hai lần, có dòng bị bỏ sót — hoàn
   *      toàn im lặng. Với một kho phân tích thì đó là dữ liệu sai chứ không
   *      phải chậm.
   *
   * Một câu SELECT duy nhất đọc theo dòng chảy giải quyết cả hai: InnoDB ở
   * REPEATABLE READ giữ nguyên một ảnh chụp suốt câu lệnh, và vòng `for await`
   * của người gọi tự ĐIỀU TIẾT tốc độ — nó chỉ xin lô sau khi lô trước đã ghi
   * xong sang ClickHouse, nên MySQL tự chậm lại thay vì bơm đầy RAM của Node.
   *
   * Vẫn THUẦN ĐỌC: `REQUIRED_GRANTS` không đổi, chỉ cần `SELECT`.
   *
   * Trả `unknown[][]` chứ không `PreviewCell[][]`: `toCell` cắt ô ở 300 ký tự
   * cho bảng xem trước, mà cắt dữ liệu đang NẠP là mất dữ liệu thật. Việc chuyển
   * đổi thuộc về tầng nạp, nơi biết kiểu đích của từng cột.
   */
  readAllRows(
    cfg: ConnectionConfig,
    ref: TableRef,
    opts: ReadAllOptions,
  ): AsyncGenerator<unknown[][], void, undefined>;
}

/**
 * Số dòng tối đa của một lần xem trước.
 *
 * Hằng số ở BACKEND, cố ý không cho client chỉnh. Cho phép truyền `limit` lên
 * nghĩa là ai đó gửi `limit=10000000` và ta kéo cả bảng của khách hàng qua mạng
 * vào bộ nhớ Node — một endpoint đọc vô hại biến thành cách làm sập chính mình.
 *
 * 100 vừa đủ để thấy dữ liệu trông thế nào, mà vẫn nhẹ với cả hai đầu.
 */
export const PREVIEW_ROW_LIMIT = 100;

/**
 * Thời gian chờ tối đa cho mọi thao tác chạm CSDL nguồn.
 *
 * Nó nằm trong một request HTTP mà người dùng đang ngồi nhìn, và một host không
 * tồn tại sẽ để TCP tự treo tới hàng chục giây theo mặc định của hệ điều hành.
 * 10 giây đủ rộng cho một CSDL ở xa, đủ ngắn để người dùng không tưởng trang bị
 * đơ.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Thời gian chờ cho ClickHouse, rộng hơn hẳn.
 *
 * ClickHouse Cloud TỰ NGỦ khi không ai dùng, và request đầu tiên phải chờ nó
 * thức dậy — quãng đó thường 10–20 giây. Dùng chung 10 giây với MySQL nghĩa là
 * lần bấm "Kiểm tra kết nối" đầu tiên gần như luôn báo hết giờ, người dùng sửa
 * lung tung thông tin đăng nhập đang đúng, rồi bấm lại và tự nhiên thành công —
 * kiểu lỗi dạy người ta rằng hệ thống không đáng tin.
 */
export const CLICKHOUSE_TIMEOUT_MS = 30_000;

/** Cổng mặc định, dùng để tự điền ô port ở wizard bước 2. */
export const DEFAULT_PORTS: Record<ConnectionKind, number> = {
  mysql: 3306,
  // 8443 (HTTPS) chứ không phải 8123 (HTTP thô): ClickHouse gặp trong thực tế
  // gần như luôn là ClickHouse Cloud, và ở đó 8123 đơn giản là không mở. Người
  // chạy ClickHouse tự dựng trong mạng nhà đổi lại 8123 và bỏ tick SSL.
  clickhouse: 8443,
};

/**
 * Giá trị gợi ý cho ô SSL, đi cặp với `DEFAULT_PORTS`.
 *
 * MySQL mặc định TẮT vì máy chủ MySQL tự dựng thường chưa bật TLS, và bật nhầm
 * cho ra lỗi bắt tay khó đọc hơn hẳn. ClickHouse mặc định BẬT theo đúng lý do
 * cổng 8443 ở trên.
 */
export const DEFAULT_SSL: Record<ConnectionKind, boolean> = {
  mysql: false,
  clickhouse: true,
};

/**
 * Quyền tối thiểu cần cấp cho tài khoản kết nối, hiện ở wizard bước 1.
 *
 * CHỈ QUYỀN ĐỌC. Nền tảng này không bao giờ ghi vào CSDL nguồn, và nói rõ điều
 * đó ngay lúc khách hàng chuẩn bị cấp quyền là cách rẻ nhất để họ không cấp
 * thừa — quyền thừa thì không ai thu lại.
 */
export const REQUIRED_GRANTS: Record<ConnectionKind, string[]> = {
  mysql: [
    'SELECT trên các bảng cần lấy dữ liệu',
    'SHOW VIEW nếu muốn đồng bộ cả view',
    'Quyền đọc information_schema (mặc định mọi tài khoản đều có)',
  ],
  clickhouse: [
    'SELECT trên các bảng cần lấy dữ liệu',
    'SHOW TABLES trên database',
    'Quyền đọc system.tables và system.columns',
  ],
};
