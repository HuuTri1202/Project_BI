import { defineConfig } from 'vitest/config';

/**
 * Test ĐƠN VỊ — không chạm database, không mở cổng.
 *
 * `env` ở đây là cách duy nhất tiêm biến môi trường: `src/config/env.ts` đọc
 * `process.env` rồi `Object.freeze` ngay lúc import, nên sửa sau khi import là
 * vô tác dụng. BCRYPT_COST=4 để suite không mất ~400ms cho mỗi lần hash.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    env: {
      NODE_ENV: 'test',
      CORS_ORIGIN: 'http://localhost:5173',
      MYSQL_HOST: 'localhost',
      MYSQL_PORT: '3310',
      MYSQL_DATABASE: 'bi_platform_test',
      MYSQL_USER: 'bi_user',
      MYSQL_PASSWORD: 'bi_password',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'redispassword',
      JWT_SECRET: 'test-secret-chi-dung-trong-vitest-dai-hon-32-ky-tu',
      JWT_ACCESS_TTL: '1h',
      AUTH_COOKIE_NAME: 'bi_session',
      BCRYPT_COST: '4',
    },
  },
});
