import 'dotenv/config';
import { z } from 'zod';

/**
 * Nguồn chân lý duy nhất cho cấu hình môi trường.
 *
 * Toàn bộ code còn lại import `env` từ đây, KHÔNG đọc `process.env` trực tiếp.
 * Lý do: `noUncheckedIndexedAccess` làm `process.env['X']` luôn có kiểu
 * `string | undefined`, nên nếu đọc rải rác thì mỗi chỗ lại phải tự kiểm tra.
 *
 * Thiếu biến -> process thoát ngay lúc boot kèm danh sách cụ thể, thay vì chạy
 * được rồi chết giữa chừng lúc gọi database.
 */
/**
 * Cổng đọc từ biến môi trường.
 *
 * Bắt buộc qua `z.string()` TRƯỚC rồi mới ép kiểu: nếu dùng thẳng
 * `z.coerce.number()`, biến thiếu sẽ bị ép thành NaN và báo lỗi khó hiểu
 * "Expected number, received nan" thay vì "Required".
 */
const portFromEnv = z.string().min(1).pipe(z.coerce.number().int().positive().max(65535));

/**
 * Thời hạn token, dạng chuỗi của gói `ms` ('900s', '15m', '1h', '7d').
 *
 * Phải là template literal union chứ không phải `z.string()`: từ v9.0.7,
 * `@types/jsonwebtoken` khai `expiresIn` đúng bằng kiểu union đó, nên truyền
 * một `string` thường vào `jwt.sign` sẽ fail `tsc`. Ràng buộc kiểu ngay tại đây
 * thì không phải ép kiểu ở chỗ gọi.
 */
type Duration = `${number}${'s' | 'm' | 'h' | 'd'}`;

const durationFromEnv = z
  .string()
  .regex(/^\d+[smhd]$/, "Phải có dạng số + đơn vị s/m/h/d, ví dụ '15m'")
  .transform((v) => v as Duration);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  CORS_ORIGIN: z.string().url(),

  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: portFromEnv,
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().min(1),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: portFromEnv,
  REDIS_PASSWORD: z.string().min(1),

  // --- Xác thực ---
  // Backend TỰ KÝ token bằng HS256 nên cần secret đối xứng. (Ở giai đoạn dùng
  // Keycloak thì ngược lại: chỉ verify RS256 bằng khoá công khai, và khi đó có
  // một secret nằm sẵn mới là nguy hiểm.)
  //
  // KHÔNG có giá trị mặc định, và đó là chủ ý: một secret ký mặc định là đúng
  // loại thứ sẽ theo chân code lên production. Thà chết lúc boot kèm tên biến.
  // 32 ký tự là mức tối thiểu để secret không bị dò bằng từ điển.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET phải dài ít nhất 32 ký tự'),
  JWT_EXPIRES_IN: durationFromEnv.default('7d'),
  JWT_ISSUER: z.string().min(1).default('bi-platform'),
  JWT_AUDIENCE: z.string().min(1).default('bi-platform-api'),

  // Đã đo trên máy dev: cost 12 ≈ 291 ms. Đủ chậm để chống dò, đủ nhanh để
  // đăng nhập không thấy đơ. Mỗi đơn vị tăng là gấp đôi thời gian.
  //
  // Cận dưới là 4 chứ không phải 10: bộ test hạ về 4 để suite không mất vài
  // giây cho mỗi tài khoản được tạo. Chặn ở 10 sẽ khiến file test không chạy
  // được, và người ta sẽ đi vòng bằng cách khác tệ hơn.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  // Hạn mức gọi các endpoint xác thực, đếm trên Redis theo IP.
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Object storage cho file người dùng tải lên (§7.4) ---
  //
  // Dev dùng MinIO trong docker-compose (profile `data`), production dùng AWS S3
  // thật. Code GIỐNG HỆT nhau — `@aws-sdk/client-s3` nói cùng một giao thức với
  // cả hai — nên chuyển sang AWS chỉ là đổi bốn biến dưới đây, không sửa dòng
  // code nào.
  //
  // KHÔNG có giá trị mặc định cho khoá: một cặp khoá mặc định là đúng loại thứ
  // sẽ theo chân code lên production, y như lý do JWT_SECRET không có mặc định.
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  // MinIO phân biệt bucket bằng ĐƯỜNG DẪN (localhost:9000/bi-datasets), còn AWS
  // dùng TÊN MIỀN CON (bi-datasets.s3.amazonaws.com). Đặt sai thì SDK ký URL cho
  // một host không tồn tại và lỗi hiện ra dưới dạng DNS chứ không phải S3.
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Trần dung lượng file, mặc định 50MB theo §7.3. Giá trị này đi vào ĐIỀU KIỆN
  // của presigned URL, nên chính S3 từ chối file quá cỡ — không phải Express,
  // vốn không nhìn thấy file nào cả khi upload đi thẳng.
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),

  // Số dòng tối đa NẠP VÀO CLICKHOUSE từ một file. Chạm trần phải hiện ra trên
  // giao diện chứ không im lặng — xem `truncated` trong `parseFile.ts`.
  //
  // Từng là 50.000, và con số đó KHÔNG đến từ ClickHouse: 50.000 dòng chỉ tốn
  // 4,57 MiB và nạp xong dưới 5 giây. Nó đến từ chỗ dữ liệu đọng lại trên đường
  // đi — cache phân tích trong một khoá Redis, rồi một bản sao JSON đầy đủ trong
  // `dataset_rows`, cả hai đều lớn tuyến tính theo số dòng.
  //
  // Sau khi §9 đọc thẳng file để nạp (`readFileRows`) và `dataset_rows` co về
  // đúng `RETAINED_ROWS` dòng mẫu, chi phí lưu trữ KHÔNG còn tăng theo con số
  // này nữa. Thứ còn giới hạn là `UPLOAD_MAX_BYTES` và thời gian nạp — hai thứ
  // người dùng nhìn thấy và hiểu được.
  DATASET_MAX_ROWS: z.coerce.number().int().positive().default(1_000_000),

  // --- Kết nối tới CSDL của khách hàng (§8) ---
  //
  // Khoá AES-256-GCM mã hoá mật khẩu CSDL. KHÔNG có mặc định, cùng lý do với
  // JWT_SECRET: một khoá mã hoá mặc định là đúng loại thứ theo chân code lên
  // production và biến cả lớp mã hoá thành trang trí.
  //
  // 44 ký tự là độ dài base64 của đúng 32 byte. `secretBox.ts` kiểm lại độ dài
  // SAU khi giải base64 — đó mới là ràng buộc thật; ở đây chỉ chặn sớm cho lỗi
  // dễ đọc. Sinh khoá:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  //
  // ⚠️ Đổi khoá này = MỌI kết nối đã lưu ngừng giải mã được và phải nhập lại
  // mật khẩu. Không có đường khôi phục.
  CONNECTION_ENCRYPTION_KEY: z
    .string()
    .min(44, 'CONNECTION_ENCRYPTION_KEY phải là 32 byte mã hoá base64 (44 ký tự)'),

  // Cho phép kết nối tới host trong mạng nội bộ / loopback.
  //
  // Endpoint kết nối nhận host:port DO NGƯỜI DÙNG KHAI rồi bắt server tự đi kết
  // nối — đó là SSRF. Bật cờ này nghĩa là một admin tổ chức bất kỳ trỏ được vào
  // 169.254.169.254 (metadata của cloud) hay bất kỳ máy nào trong mạng nội bộ,
  // và dùng chính server này làm bàn đạp.
  //
  // Mặc định theo môi trường: dev BẬT (để demo kết nối tới container MySQL trên
  // localhost), production TẮT. Muốn bật ở production thì phải khai tường minh,
  // và đó là điều nên phải suy nghĩ một lần.
  ALLOW_PRIVATE_DB_HOSTS: z.enum(['true', 'false']).optional(),

  // Địa chỉ mà CSDL của khách hàng NHÌN THẤY khi hệ thống này kết nối tới. Hiện
  // ở bước 1 của wizard để họ thêm vào danh sách cho phép của tường lửa.
  //
  // Là biến cấu hình chứ không tự dò: server không biết IP công khai của chính
  // mình sau NAT/load balancer, và cách duy nhất để "tự biết" là gọi ra một
  // dịch vụ bên ngoài — thêm một phụ thuộc mạng cho một chuỗi tĩnh mà người vận
  // hành hoàn toàn biết trước.
  EGRESS_IP: z.string().min(1).default('chưa cấu hình — đặt EGRESS_IP trong .env'),

  // --- Kho phân tích ClickHouse (§9) ---
  //
  // ĐỪNG NHẦM với `connections` của §8. Đó là CSDL CỦA KHÁCH HÀNG: địa chỉ do
  // người dùng gõ lên form, ta chỉ ĐỌC, và phải chống SSRF. Đây là kho của
  // CHÍNH TA: địa chỉ do người vận hành đặt ở đây, và ta GHI vào nó (CREATE
  // TABLE + INSERT). Hai thứ đối lập nhau về mọi mặt an toàn, nên chúng có hai
  // đường cấu hình riêng và hai client riêng — xem `config/clickhouse.ts`.
  //
  // Không có giá trị mặc định, cùng khuôn với MYSQL_*: một mặc định thầm lặng
  // nghĩa là máy thiếu cấu hình vẫn boot rồi ghi dữ liệu vào một ClickHouse
  // không ai ngờ tới. `npm run setup` tự bổ sung bốn biến này vào `.env` đã có.
  CLICKHOUSE_HOST: z.string().min(1),
  CLICKHOUSE_PORT: portFromEnv,
  CLICKHOUSE_DATABASE: z.string().min(1),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),

  // --- Seed tài khoản quản trị đầu tiên (§2.7) ---
  // Đều có giá trị mặc định nên KHÔNG bắt buộc khai trong .env; chỉ script
  // seed đọc tới.
  SEED_TENANT_NAME: z.string().min(1).default('BI Platform'),
  SEED_TENANT_SLUG: z.string().min(1).default('bi-platform'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@bi-platform.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).max(72).default('Admin@12345'),
  SEED_ADMIN_FULL_NAME: z.string().min(1).default('Quản trị viên'),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(
      [
        '[env] Cấu hình môi trường không hợp lệ:',
        details,
        '',
        // TUYỆT ĐỐI không khuyên `cp .env.example .env` ở đây. Nguyên nhân phổ
        // biến nhất của thông báo này là `.env` ĐÃ CÓ nhưng thiếu biến mà một
        // nhánh vừa merge thêm vào — và chép đè lên nó sẽ xoá mất
        // CONNECTION_ENCRYPTION_KEY, khiến mọi mật khẩu kết nối đã lưu vĩnh viễn
        // không giải mã được. `npm run setup` chỉ BỔ SUNG biến còn thiếu.
        'Khắc phục: chạy  npm run setup  ở thư mục gốc — lệnh này bổ sung biến',
        'còn thiếu vào .env và KHÔNG đụng tới giá trị bạn đã đặt.',
      ].join('\n'),
    );
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Có cho phép kết nối tới host nội bộ / loopback không.
 *
 * Suy ra ở ĐÂY chứ không bằng `.default()` trong schema, vì mặc định phụ thuộc
 * một trường khác (`NODE_ENV`) — zod không diễn tả được quan hệ đó mà không
 * biến cả object thành một phép transform khó đọc.
 *
 * Chưa khai -> theo môi trường: dev cho phép, production chặn. Khai tường minh
 * thì lời khai thắng, kể cả ở production — nhưng khi đó nó là một quyết định có
 * chữ ký, không phải một mặc định trôi theo.
 */
export const allowPrivateDbHosts =
  env.ALLOW_PRIVATE_DB_HOSTS === undefined ? !isProduction : env.ALLOW_PRIVATE_DB_HOSTS === 'true';
