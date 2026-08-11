/**
 * Cấp bù KHÔNG GIAN CÁ NHÂN cho những tài khoản đã tồn tại.
 *
 *   npm run db:backfill-personal            # xem trước, không ghi gì
 *   npm run db:backfill-personal -- --apply # thật sự ghi
 *
 * ─── Vì sao cần script này ──────────────────────────────────────────────────
 *
 * Migration 5 thêm `tenants.owner_user_id`, và từ đó `createMember` cấp kèm mỗi
 * tài khoản mới một tổ chức riêng. Nhưng migration chỉ đổi SCHEMA — mọi tài
 * khoản tạo TRƯỚC nó vẫn chỉ có đúng một membership, nên bộ chuyển tổ chức
 * (chỉ hiện khi có ≥ 2 tổ chức) không xuất hiện và người dùng cũ không có đường
 * nào tới không gian của chính mình.
 *
 * ⚠️ CHỈ những người CHƯA làm chủ tổ chức nào. Người tự đăng ký đã lập ra công
 * ty của mình và làm admin ở đó — đó ĐÃ LÀ nơi họ làm chủ, cấp thêm một không
 * gian riêng nữa chỉ tạo tổ chức rác. Xem `findCandidates`.
 *
 * ─── Vì sao là SCRIPT chứ không phải migration ──────────────────────────────
 *
 * Migration chạy TỰ ĐỘNG lúc backend khởi động. Một migration sinh ra hàng loạt
 * dòng dữ liệu — mỗi user một tenant, một workspace, một membership — là thứ
 * không nên xảy ra sau lưng người vận hành, và không có đường lùi ngoài việc
 * xoá tay. Tách ra thành script chạy tay thì người bấm nút biết mình đang bấm
 * gì, và có bước xem trước.
 *
 * ─── An toàn ────────────────────────────────────────────────────────────────
 *
 * - Mặc định là DIỄN TẬP. Phải thêm `--apply` mới ghi.
 * - Chạy lại nhiều lần vô hại: truy vấn chỉ lấy user CHƯA có tổ chức riêng, và
 *   `uq_tenants_owner` chặn ở tầng database nếu logic trên có sai.
 * - Mỗi người MỘT transaction riêng. Một người hỏng (tên sinh slug lạ, đụng
 *   ràng buộc) thì chỉ người đó bị bỏ qua, những người còn lại vẫn xong — thay
 *   vì cả mẻ bị cuộn ngược và không ai biết hỏng ở đâu.
 * - KHÔNG đụng gì tới tài khoản, mật khẩu hay membership đang có.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { closeMysql, mysqlPool } from '../config/mysql';
import { closeRedis } from '../config/redis';
import { withTransaction } from '../db/tx';
import * as membershipsRepo from '../repositories/memberships';
import { provisionTenant } from '../services/tenant/provisionTenant';

interface CandidateRow extends RowDataPacket {
  id: number;
  email: string;
  full_name: string;
}

/**
 * Những tài khoản còn sống mà CHƯA CÓ CHỖ NÀO LÀM CHỦ.
 *
 * Hai điều kiện, và điều kiện thứ hai mới là điểm mấu chốt:
 *
 * 1. Chưa có tổ chức cá nhân (`t.owner_user_id = u.id`) — để chạy lại vô hại.
 *
 * 2. Chưa là `admin` của một CÔNG TY THẬT nào. Người tự đăng ký lập ra công ty
 *    của mình và làm admin ở đó — công ty ấy ĐÃ LÀ nơi họ làm chủ. Cấp thêm một
 *    "không gian riêng" nữa cho họ là tạo tổ chức thừa: một dòng rác trong
 *    `tenants`, một workspace không ai mở, và một mục vô nghĩa trên bộ chuyển tổ
 *    chức. Chỉ người CHỈ tồn tại bên trong tổ chức của người khác (creator,
 *    viewer, hoặc admin do người khác cấp) mới thật sự chưa có chỗ nào của mình.
 *
 * `NOT EXISTS` chứ không `LEFT JOIN ... IS NULL`: đọc ra đúng ý định, và MySQL
 * dừng ngay ở dòng đầu khớp thay vì dựng cả bảng nối rồi lọc.
 *
 * Cố ý KHÔNG lọc `is_active`: một tài khoản đang bị khoá vẫn có thể được mở lại,
 * và lúc đó nó phải giống mọi tài khoản khác. Chỉ bỏ qua tài khoản đã xoá mềm.
 */
async function findCandidates(): Promise<CandidateRow[]> {
  const [rows] = await mysqlPool.query<CandidateRow[]>(
    `SELECT u.id, u.email, u.full_name
       FROM users u
      WHERE u.deleted_at IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM tenants t WHERE t.owner_user_id = u.id
            )
        AND NOT EXISTS (
              SELECT 1
                FROM memberships m
                JOIN tenants t ON t.id = m.tenant_id
               WHERE m.user_id = u.id
                 AND m.role = 'admin'
                 AND m.removed_at IS NULL
                 AND t.owner_user_id IS NULL
                 AND t.deleted_at IS NULL
            )
      ORDER BY u.id ASC`,
  );
  return rows;
}

/**
 * Cấp không gian riêng cho một người.
 *
 * Membership `admin` đặt ở CUỐI, sau khi tenant đã có: `listActiveByUser` sắp
 * theo `m.id ASC` và màn đăng nhập lấy phần tử đầu. Dòng mới luôn mang id lớn
 * nhất, nên tổ chức người ta vẫn đang làm việc giữ nguyên vị trí mặc định —
 * back-fill KHÔNG được đổi chỗ đăng nhập của bất kỳ ai.
 */
async function provisionFor(user: CandidateRow): Promise<number> {
  return withTransaction(async (conn) => {
    const personal = await provisionTenant(conn, {
      name: `Không gian của ${user.full_name}`,
      createdBy: user.id,
      ownerUserId: user.id,
    });
    await membershipsRepo.upsert(conn, personal.tenantId, user.id, 'admin');
    return personal.tenantId;
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const candidates = await findCandidates();

  if (candidates.length === 0) {
    console.log('[backfill] không tài khoản nào cần cấp bù — mọi người đều đã có chỗ làm chủ.');
    return;
  }

  console.log(`[backfill] ${candidates.length} tài khoản chưa làm chủ tổ chức nào:`);
  for (const u of candidates) {
    console.log(`  - #${u.id} ${u.email} -> "Không gian của ${u.full_name}"`);
  }
  console.log('');

  if (!apply) {
    console.log('[backfill] DIỄN TẬP — chưa ghi gì. Chạy lại với `-- --apply` để thực hiện.');
    return;
  }

  let done = 0;
  const failed: { email: string; reason: string }[] = [];

  for (const user of candidates) {
    try {
      const tenantId = await provisionFor(user);
      done += 1;
      console.log(`[backfill] ✓ ${user.email} -> tenant #${tenantId}`);
    } catch (err) {
      // Ghi ra rồi đi tiếp. Dừng cả mẻ vì một người là bắt người vận hành phải
      // tự đoán xem đã tới đâu và chạy lại từ chỗ nào.
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ email: user.email, reason });
      console.error(`[backfill] ✗ ${user.email}: ${reason}`);
    }
  }

  console.log('');
  console.log(`[backfill] xong: ${done} thành công, ${failed.length} thất bại.`);
  if (failed.length > 0) {
    console.log('[backfill] chạy lại script để thử tiếp những người còn thiếu.');
  }
}

main()
  .then(async () => {
    await Promise.allSettled([closeMysql(), closeRedis()]);
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[backfill] thất bại:', err);
    await Promise.allSettled([closeMysql(), closeRedis()]);
    process.exit(1);
  });
