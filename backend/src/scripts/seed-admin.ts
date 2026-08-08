/**
 * §2.7 — Tạo tổ chức mặc định, tài khoản quản trị đầu tiên và workspace đầu tiên.
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
import { closeMysql, mysqlPool } from '../config/mysql';
import { closeRedis } from '../config/redis';
import { runMigrations } from '../db/migrate';
import * as membershipsRepo from '../repositories/memberships';
import { createTenant, findTenantBySlug } from '../repositories/tenants';
import * as usersRepo from '../repositories/users';
import * as workspacesRepo from '../repositories/workspaces';
import { hashPassword } from '../services/auth/password';

const DEFAULT_WORKSPACE_NAME = 'Không gian mặc định';
const DEFAULT_WORKSPACE_SLUG = 'mac-dinh';

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

  // --- Tài khoản ---
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  let userId: number;

  const existing = await usersRepo.findByEmailForLogin(email);
  if (existing) {
    userId = existing.user.id;
    console.log(`[seed] tài khoản '${email}' đã có — không đụng tới mật khẩu hiện tại`);
  } else {
    // Truyền `mysqlPool` làm executor: script seed chạy tuần tự, không cần
    // transaction. Xem repositories/db.ts về việc vì sao tham số này bắt buộc.
    userId = await usersRepo.createUser(mysqlPool, {
      email,
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      fullName: env.SEED_ADMIN_FULL_NAME,
      // Vai trò cấp NỀN TẢNG. Tài khoản seed là người vận hành hệ thống, nên
      // 'superadmin'. Quyền quản trị TỔ CHỨC nằm ở membership bên dưới — hai
      // trục khác nhau, xem ghi chú trong db/migrations.ts.
      platformRole: 'superadmin',
      // Tài khoản seed không bị bắt đổi mật khẩu: nó dùng để đăng nhập lần đầu
      // và tạo ra những tài khoản khác. Mật khẩu nằm trong .env nên vẫn phải
      // đổi trước khi deploy.
      mustChangePassword: false,
    });
    console.log(`[seed] đã tạo tài khoản '${email}' (id=${userId})`);
  }

  // --- Tư cách thành viên ---
  // Chạy vô điều kiện: `upsert` dựa vào UNIQUE (user_id, tenant_id) nên gọi lại
  // không sinh dòng thứ hai. Đặt ngoài nhánh if để sửa được trường hợp tài khoản
  // đã có nhưng membership bị xoá tay lúc gỡ lỗi — nếu không, seed sẽ báo "đã
  // có" rồi bỏ mặc một tài khoản không đăng nhập được vào đâu.
  await membershipsRepo.upsert(mysqlPool, tenant.id, userId, 'admin');
  console.log(`[seed] '${email}' là quản trị viên của '${tenant.slug}'`);

  // --- Workspace đầu tiên ---
  // Có sẵn một workspace thì màn hình quản trị không mở ra một danh sách rỗng.
  const workspace = await workspacesRepo.findBySlug(tenant.id, DEFAULT_WORKSPACE_SLUG);
  if (workspace) {
    console.log(`[seed] workspace '${workspace.slug}' đã có (id=${workspace.id})`);
  } else {
    const id = await workspacesRepo.createWorkspace(tenant.id, {
      name: DEFAULT_WORKSPACE_NAME,
      slug: DEFAULT_WORKSPACE_SLUG,
      createdBy: userId,
    });
    console.log(`[seed] đã tạo workspace '${DEFAULT_WORKSPACE_SLUG}' (id=${id})`);
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
