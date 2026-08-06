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

  // Keycloak: chỉ dùng để verify token bằng RS256 + JWKS.
  // KHÔNG có JWT_SECRET ở đây — backend không tự ký token, chỉ xác thực token
  // do Keycloak ký. Có secret đối xứng nằm sẵn là mời gọi ký sai thuật toán.
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
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
