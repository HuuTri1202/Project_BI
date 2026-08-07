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
  // KHÔNG có giá trị mặc định, và đó là chủ ý: một secret ký mặc định là đúng
  // loại thứ sẽ theo chân code lên production. Thà chết lúc boot kèm tên biến.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET phải dài tối thiểu 32 ký tự'),
  JWT_ACCESS_TTL: durationFromEnv.default('1h'),
  AUTH_COOKIE_NAME: z.string().min(1).default('bi_session'),
  // 12 ≈ 250–400ms mỗi lần hash trên laptop hiện nay — mức "chậm nhất mà UX còn
  // chịu được". Mỗi đơn vị tăng là gấp đôi thời gian. Test hạ về 4 để suite
  // không mất vài giây cho mỗi user được tạo.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
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
