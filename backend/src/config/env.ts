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
  // 32 ký tự là mức tối thiểu để secret không bị dò bằng từ điển.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET phải dài ít nhất 32 ký tự'),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  JWT_ISSUER: z.string().min(1).default('bi-platform'),
  JWT_AUDIENCE: z.string().min(1).default('bi-platform-api'),

  // Đã đo trên máy dev: cost 12 ≈ 291 ms. Đủ chậm để chống dò, đủ nhanh để
  // đăng nhập không thấy đơ.
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  // Chống dò mật khẩu (đếm trên Redis)
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

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
        'Khắc phục: cp .env.example .env  rồi điền giá trị (xem README.md).',
      ].join('\n'),
    );
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
