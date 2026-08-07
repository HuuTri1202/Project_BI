/**
 * §2.7 — Tạo tổ chức mặc định và tài khoản quản trị đầu tiên.
 *
 *   npm run seed:admin
 *
 * Idempotent: chạy lại nhiều lần không tạo trùng, không ghi đè mật khẩu của
 * tài khoản đã có. Cần đặt lại mật khẩu thì dùng chức năng của Admin trên giao
 * diện, hoặc xoá user rồi seed lại.
 *
 * Đây là lối vào DUY NHẤT để có tài khoản đầu tiên: hệ thống chưa có form đăng
 * ký, và mọi tài khoản sau đều do Admin tạo (§3.4).
 */
import { env } from '../config/env';
import { closeMysql } from '../config/mysql';
import { closeRedis } from '../config/redis';
import { runMigrations } from '../db/migrate';
import { createTenant, findTenantBySlug } from '../repositories/tenants';
import * as usersRepo from '../repositories/users';
import { hashPassword } from '../services/auth/password';

async function main(): Promise<void> {
  await runMigrations();

  // --- Tổ chức ---
  let tenant = await findTenantBySlug(env.SEED_TENANT_SLUG);
  if (tenant) {
    console.log(`[seed] tổ chức '${tenant.slug}' đã có (id=${tenant.id})`);
  } else {
    const id = await createTenant(env.SEED_TENANT_NAME, env.SEED_TENANT_SLUG);
    tenant = { id, name: env.SEED_TENANT_NAME, slug: env.SEED_TENANT_SLUG };
    console.log(`[seed] đã tạo tổ chức '${tenant.slug}' (id=${id})`);
  }

  // --- Tài khoản quản trị ---
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  if (await usersRepo.emailExists(email)) {
    console.log(`[seed] tài khoản '${email}' đã có — không đụng tới mật khẩu hiện tại`);
  } else {
    const id = await usersRepo.createUser(tenant.id, {
      fullName: env.SEED_ADMIN_FULL_NAME,
      email,
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'admin',
      // Tài khoản seed không bị bắt đổi mật khẩu: nó dùng để đăng nhập lần đầu
      // và tạo ra những tài khoản khác. Mật khẩu nằm trong .env nên vẫn phải
      // đổi trước khi deploy.
      mustChangePassword: false,
    });
    console.log(`[seed] đã tạo quản trị viên '${email}' (id=${id})`);
  }

  console.log('');
  console.log('  Đăng nhập bằng:');
  console.log(`    Email    : ${email}`);
  console.log(`    Mật khẩu : ${env.SEED_ADMIN_PASSWORD}`);
  console.log('');
  console.log('  Đổi mật khẩu này trước khi deploy.');
}

main()
  .then(async () => {
    await Promise.allSettled([closeMysql(), closeRedis()]);
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[seed] thất bại:', err);
    await Promise.allSettled([closeMysql(), closeRedis()]);
    process.exit(1);
  });
