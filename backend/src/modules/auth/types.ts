import type { RoleCode, UserDto, UserStatus } from '@bi/shared';
import type { RowDataPacket } from 'mysql2/promise';

/**
 * Hình dạng dòng dữ liệu trả về từ mysql2.
 *
 * Phải giao với `RowDataPacket` vì đó là ràng buộc generic của `conn.execute<T>`.
 * Khai kiểu tường minh thay vì `any` — `any` bị ESLint cấm, và ở đây nó cũng
 * xoá luôn tác dụng của `noUncheckedIndexedAccess` khi truy cập `rows[0]`.
 */

export interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  status: UserStatus;
  created_at: Date;
}

export interface MembershipRow extends RowDataPacket {
  tenant_id: string;
  tenant_name: string;
  role_code: RoleCode;
  created_at: Date;
}

export interface WorkspaceRow extends RowDataPacket {
  id: string;
  name: string;
}

/** Ánh xạ dòng DB sang DTO gửi ra ngoài. Là nơi DUY NHẤT làm việc này, nên cũng
 *  là nơi duy nhất phải nhớ rằng `password_hash` không bao giờ được đi kèm. */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}
